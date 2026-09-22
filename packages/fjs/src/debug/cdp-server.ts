// The spec 088/089 CDP relay: one process, two sockets.
//
//   ┌─────────┐   TCP, app dials OUT, newline-framed CDP   ┌─────────────┐
//   │ app VM   │ ─────────────────────────────────────────► │ this relay  │
//   │ (PrimJS) │ ◄───────────────────────────────────────── │ (fjs debug) │
//   └─────────┘                                             └──────┬──────┘
//     vmHost:vmPort      a phone is unreachable from the           │ WebSocket
//     (LAN-reachable —   dev machine, so the VM must be the        │ CDP, one
//     same direction as  TCP client; the reverse would need        │ line per
//     the dev socket)    a listener on the device                  ▼ message
//                                                   127.0.0.1:cdpPort
//                                                   (Chrome DevTools. CDP can
//                                                   evaluate arbitrary code, so
//                                                   this side stays loopback-only
//                                                   even though the dev server
//                                                   itself binds wider.)
//
// Two kinds of traffic share the DevTools WebSocket:
//
//  - Debugger.* / Runtime.*: the engine (vendored PrimJS, spec 088) speaks
//    these natively — bytes pass through untouched.
//  - The browser-only domains (DOM / CSS / Network / Page / Overlay /
//    Emulation / Console / Log / Performance): the engine has no idea what a
//    DOM even is. The relay intercepts them BEFORE the engine and serves them
//    by evaluating `__fjsDevtools.cmd(...)` in the VM (spec 089) — the debug
//    channel works while paused, needs no new protocol, and covers fjsrun
//    desktop VMs for free. Internal evaluate ids start at 1e9 so they can
//    never collide with DevTools ids.
//
// A DevTools session that connects LATER still sees every script: the
// engine replays `Debugger.scriptParsed` for every registered script when
// `Debugger.enable` arrives. On disconnect the relay sends
// `Debugger.disable` so a reconnecting session gets the replay again and an
// app frozen at a breakpoint unfreezes.
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';

export interface CdpRelayOptions {
  /** Chrome DevTools side: HTTP discovery + WebSocket. Loopback only. */
  cdpPort: number;
  /** App VM side: the VM dials OUT to this listener. */
  vmPort: number;
  /** Listen address for the VM listener. Default 0.0.0.0 (a phone reaches
   * the dev machine over the LAN; 127.0.0.1 only works for `fjsrun`). */
  vmHost?: string;
  log?: (line: string) => void;
}

export interface CdpRelay {
  /** What to print so a human can connect Chrome. */
  banner(vmCount: number): string;
  /** One line of the app's own log stream (the same `fjs log` sees), handed
   * over by `fjs debug`'s tool link and synthesized into
   * Runtime.consoleAPICalled for the attached DevTools (spec 092). Dropped
   * while no DevTools session is attached. */
  consoleLine(level: number, text: string): void;
  close(): Promise<void>;
}

/** Browser-only CDP domains this relay serves through the evaluate bridge;
 * everything else (Debugger, Runtime, …) is the engine's and passes through. */
const BRIDGED = new Set([
  'DOM',
  'CSS',
  'Overlay',
  'Emulation',
  'Page',
  'Network',
  'Console',
  'Log',
  'Performance',
]);

export function startCdpRelay(opts: CdpRelayOptions): Promise<CdpRelay> {
  const log = opts.log ?? (() => {});
  const vmHost = opts.vmHost ?? '0.0.0.0';
  let vm: Socket | null = null;
  let vmBuf = '';
  let devtools: WebSocket | null = null;
  let devBuf = '';
  let vmCount = 0;

  // ---- VM → DevTools (engine events + bridge replies, line-framed) -------

  const feedDevtools = (chunk: string) => {
    vmBuf += chunk;
    let pos;
    while ((pos = vmBuf.indexOf('\n')) !== -1) {
      const line = vmBuf.slice(0, pos);
      vmBuf = vmBuf.slice(pos + 1);
      if (!line) continue;
      // bridge evaluates resolve by their reserved id space (≥1e9); parse
      // instead of prefix-matching — ids increment past the boundary value
      let msg: { id?: number; result?: { result?: { value?: string } } } | undefined;
      try {
        msg = JSON.parse(line);
      } catch {
        // not JSON: forward it like any other line
      }
      // The app signals a reload through the session it kept open (the VM
      // was rebuilt, the socket was not): its fetch-id space restarts from
      // 1, so the Network rows of the previous VM must stop suppressing the
      // new ones. Session stays up, so the poll keeps running if it ran.
      if (msg && (msg as { fjs?: string }).fjs === 'debug-reload') {
        netSent.clear();
        netDone.clear();
        bodyCache.clear();
        // the VM was rebuilt: every nodeId DevTools holds belongs to the old
        // element universe — this is a world reset, the one shape of tree
        // change that is always worth a full re-pull
        domInvalidated();
        continue; // internal traffic — never reaches DevTools
      }
      if (msg && typeof msg.id === 'number' && msg.id >= 1e9) {
        const pending = bridgePending.get(msg.id);
        if (pending) {
          bridgePending.delete(msg.id);
          clearTimeout(pending.timer);
          pending.resolve(msg.result?.result?.value ?? '{}');
          continue; // internal traffic — never reaches DevTools
        }
      }
      if (devtools?.readyState === WebSocket.OPEN) devtools.send(line);
    }
  };

  // ---- DevTools → VM (pass-through, plus the browser-domain bridge) ------

  const feedVm = (chunk: string) => {
    devBuf += chunk;
    if (vm) {
      vm.write(devBuf.endsWith('\n') ? devBuf : devBuf + '\n');
      devBuf = '';
    }
    // vm === null: nothing is attached, so the request would sit in devBuf
    // forever and flush as stale garbage into whichever VM attaches next —
    // resetSessionCaches (vm left, DevTools left, new vm attached) drops it.
    // The frontend that sent it is gone or will retry on its own.
  };

  let bridgeSeq = 1_000_000_000;
  const bridgePending = new Map<
    number,
    { resolve: (value: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  const vmEval = (expression: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!vm || vm.destroyed) {
        reject(new Error('no app attached to the debug channel'));
        return;
      }
      const id = bridgeSeq++;
      const timer = setTimeout(() => {
        if (bridgePending.delete(id)) reject(new Error('app did not answer in time'));
      }, 5000);
      bridgePending.set(id, { resolve, reject, timer });
      vm.write(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }) + '\n',
      );
    });
  };

  const bridgeCmd = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const raw = await vmEval(
      `(function(){try{return __fjsDevtools.cmd(${JSON.stringify(method)}, ${JSON.stringify(
        JSON.stringify(params),
      )});}catch(e){return JSON.stringify({__error:String(e&&e.message||e)});}})()`,
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.__error === 'string') throw new Error(parsed.__error);
    return parsed;
  };

  const reply = (ws: WebSocket, id: unknown, result: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id, result }));
  };
  const replyError = (ws: WebSocket, id: unknown, message: string) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ id, error: { message } }));
  };

  // ---- events we push at DevTools ourselves (spec 092) --------------------
  //
  // Two event sources the engine knows nothing about: the app's own log
  // stream (Console panel) and element-tree invalidation (Elements panel).

  /** A context id the engine will never mint (its own are small counters), so
   * the synthesized log lines have a context to live in — DevTools shows them
   * under "fjs host" in the console context dropdown, next to the engine's
   * own "fjs console". */
  const FJS_HOST_CONTEXT_ID = 424242;
  /** The one synthetic stylesheet every matched rule cites; announced via
   * CSS.styleSheetAdded on DevTools connect (see the connect handler). */
  const FJS_STYLESHEET_ID = 'fjs-main';
  /** Whether this DevTools session has been handed the stylesheet header
   * above. CSSModel.enable() runs once per model life, so this doubles as
   * "the dispatcher exists to receive it" — reset on CSS.disable. */
  let styleSheetAnnounced = false;

  /** Announce the one synthetic stylesheet every matched rule cites. Chrome
   * backends fire styleSheetAdded for existing sheets on CSS.enable; the
   * frontend keeps rules whose styleSheetId resolves to a header, so without
   * this the Styles panel shows inline styles only (spec 092). */
  const announceStyleSheet = (): void => {
    if (styleSheetAnnounced) return;
    styleSheetAnnounced = true;
    pushToDevtools('CSS.styleSheetAdded', {
      header: {
        styleSheetId: FJS_STYLESHEET_ID,
        frameId: 'fjs',
        sourceURL: 'fjs://app/styles.css',
        origin: 'regular',
        title: 'fjs',
        disabled: false,
        isInline: false,
        isMutable: false,
        startLine: 0,
        startColumn: 0,
        length: 0,
        endLine: 0,
        endColumn: 0,
      },
    });
  };

  const pushToDevtools = (method: string, params: Record<string, unknown>): void => {
    if (devtools?.readyState === WebSocket.OPEN)
      devtools.send(JSON.stringify({ method, params }));
  };

  const CONSOLE_TYPE_OF_LEVEL: Record<number, string> = {
    0: 'debug',
    1: 'info',
    2: 'warning',
    3: 'error',
  };

  const consoleLine = (level: number, text: string): void => {
    // eval answers travel the same log stream and are nobody's console
    // output — same rule the dev server applies to its own echo
    if (text.startsWith('\u0000fjs-eval:')) return;
    pushToDevtools('Runtime.consoleAPICalled', {
      type: CONSOLE_TYPE_OF_LEVEL[level] ?? 'info',
      timestamp: Date.now(),
      executionContextId: FJS_HOST_CONTEXT_ID,
      args: [{ type: 'string', value: text }],
    });
  };

  // ---- Elements freshness (spec 092/093) ---------------------------------
  //
  // DOM.documentUpdated tells the real frontend to re-pull the whole document
  // — and, as 092 measured with the real frontend, every push restarts all
  // pending style requests, so an actively mutating app driven by a naive
  // per-frame poll spins the Styles sidebar forever. Spec 093 therefore only
  // pushes on STRUCTURAL changes (element insert/remove, page-root add/remove
  // — the runtime's `devtoolsStructuralVersion` counter), polled at a low
  // 1.5s cadence, with a 1s cooldown so a v-for batch insert collapses into
  // ONE event instead of a storm. Pure attribute/text mutations do not move
  // that counter. The same poll drains them and pushes one
  // `DOM.characterDataModified` / `DOM.attributeModified` per edit, which the
  // frontend applies in place and does not restart style requests. The 092
  // triggers (debug-reload world reset, stale-click self-heal) remain and
  // share the same cooldown window.

  /** Minimum gap between two DOM.documentUpdated pushes (spec 093). Without
   * it, a route push that inserts a page root AND its subtree fires one push
   * per inserted node from the poll's perspective across ticks. */
  const INVALIDATE_COOLDOWN_MS = 1000;
  let lastInvalidateAt = 0;

  /** The tree changed underneath a (stale) DevTools snapshot: make the panel
   * re-pull the whole document. Debounced by the cooldown above — see the
   * block comment for why every caller funnels through here. */
  /** @returns false when the cooldown swallowed the push. Callers that
   * track a version must NOT advance their baseline on false — a route
   * push dropped here would otherwise be marked seen and never retried. */
  const domInvalidated = (): boolean => {
    const now = Date.now();
    if (now - lastInvalidateAt < INVALIDATE_COOLDOWN_MS) return false;
    lastInvalidateAt = now;
    pushToDevtools('DOM.documentUpdated', {});
    return true;
  };

  // ---- Elements: DOM/CSS over __fjsDevtools.cmd --------------------------
  //
  // nodeId layout: document = 1, element = elementId*2 + 1000, its text node
  // = elementId*2 + 1001. Pure arithmetic — no table to invalidate on reload.

  const toElem = (nodeId: number): number | null => {
    const v = nodeId - 1000;
    return v >= 0 && v % 2 === 0 ? v / 2 : null;
  };

  interface RuntimeNode {
    id: number;
    tag: string;
    attrs: Record<string, string>;
    text?: string;
    children: RuntimeNode[];
  }

  /** One matched rule as the runtime's styleCmd reports it (spec 092). */
  interface MatchedRule {
    selectors: string[];
    matched: number[];
    decls: Record<string, unknown>;
  }

  const attrArray = (attrs: Record<string, string>): string[] => {
    const out: string[] = [];
    for (const [k, v] of Object.entries(attrs)) out.push(k, v);
    return out;
  };

  const mapNode = (n: RuntimeNode): Record<string, unknown> => {
    const children: Record<string, unknown>[] = n.children.map(mapNode);
    if (n.text !== undefined) {
      children.push({
        nodeId: n.id * 2 + 1001,
        nodeType: 3,
        nodeName: '#text',
        nodeValue: n.text,
      });
    }
    const node: Record<string, unknown> = {
      nodeId: n.id * 2 + 1000,
      nodeType: 1,
      nodeName: n.tag,
      localName: n.tag,
      nodeValue: '',
      attributes: attrArray(n.attrs),
      childNodeCount: children.length,
    };
    if (children.length) node.children = children;
    return node;
  };

  const styleObject = (css: Record<string, unknown>): Record<string, unknown> => ({
    cssProperties: Object.entries(css).map(([name, value]) => ({
      name: cssDisplayName(name),
      value: cssDisplayValue(name, value),
    })),
    shorthandEntries: [],
  });

  /** The engine stores property names camelCase; CSS text spells them
   * kebab-case. Custom properties (`--*`) pass through untouched. */
  const cssDisplayName = (name: string): string =>
    name.startsWith('--') ? name : name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

  /** The engine normalizes px/rem lengths to numbers, so the number itself
   * no longer carries a unit. `px` is the engine's unit for those; the small
   * set of genuinely unitless numeric properties is spelled out. Anything
   * else kept its string form at parse time. */
  const UNITLESS_NUMERIC = new Set([
    'opacity',
    'zIndex',
    'fontWeight',
    'flexGrow',
    'flexShrink',
    'order',
    'columnCount',
    'zoom',
    'fillOpacity',
    'strokeOpacity',
  ]);
  const cssDisplayValue = (name: string, value: unknown): string => {
    if (typeof value === 'number' && !UNITLESS_NUMERIC.has(name)) return `${value}px`;
    return String(value);
  };

  const routeBridged = async (
    ws: WebSocket,
    id: unknown,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    if (method === 'DOM.getDocument') {
      const doc = (await bridgeCmd('DOM.getDocument', {})) as unknown as {
        roots: RuntimeNode[];
        structuralVersion?: number;
      };
      const children = doc.roots.map(mapNode);
      reply(ws, id, {
        root: {
          nodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          nodeValue: '',
          childNodeCount: children.length,
          children,
        },
      });
      // Baseline is the version OF THIS SNAPSHOT, not whatever the counter
      // says on the first poll tick. The panel the user is looking at was
      // built from `doc` just now; a route push in the following 1.5s used
      // to be recorded as the baseline and never pushed, so the second page
      // root (navKey=1) never appeared (spec 093).
      if (typeof doc.structuralVersion === 'number') {
        lastSeenStructuralVersion = doc.structuralVersion;
      } else if (lastSeenStructuralVersion === null) {
        try {
          const ver = (await bridgeCmd('Dom.structuralVersion')) as { version?: number };
          if (typeof ver.version === 'number') lastSeenStructuralVersion = ver.version;
        } catch {
          // first poll tick baselines if this runtime has no counter yet
        }
      }
      // the Elements panel is demonstrably live now — start watching the
      // runtime's structural counter so route pushes / subtree inserts
      // invalidate the snapshot without a manual refresh (spec 093 T024)
      startStructuralPoll(ws);
      return;
    }
    // spec 093: the lazy-tree method the real frontend uses to expand nodes
    // past the first depth. Before this it fell into the blanket
    // `reply(ws, id, {})` below — but note the CDP contract (browser_protocol
    // JSON, verified against the real protocol): requestChildNodes returns
    // VOID; the children arrive afterwards as a `DOM.setChildNodes` event
    // keyed by parentId. Replying with a payload the frontend never reads
    // leaves it waiting for an event that never comes — expansion stays
    // empty. So: void reply, then push the event.
    if (method === 'DOM.requestChildNodes') {
      const eid = toElem(Number(params.nodeId));
      const out =
        eid === null
          ? { id: 0, children: [] }
          : ((await bridgeCmd('DOM.requestChildNodes', { id: eid })) as {
              id: number;
              children: RuntimeNode[];
            });
      // response first (Promise<void> resolves), then the subtree event —
      // either order is safe (the DOM dispatcher is registered before enable
      // returns), this matches "returned in the form of setChildNodes
      // events" semantics with a definite reply boundary.
      reply(ws, id, {});
      pushToDevtools('DOM.setChildNodes', {
        parentId: Number(params.nodeId),
        nodes: out.children.map(mapNode),
      });
      return;
    }
    if (method === 'DOM.getFlattenedInnerHTML') {
      const eid = toElem(Number(params.nodeId));
      const out =
        eid === null
          ? { html: '' }
          : ((await bridgeCmd('DOM.getFlattenedInnerHTML', { id: eid })) as { html: string });
      // `{result, type}` is the CDP shape (verified against the real
      // frontend's sdk in spec 093); `{outerHTML}` alone reads as undefined
      // to this frontend version.
      reply(ws, id, { result: out.html, type: 'string' });
      return;
    }
    if (method === 'DOM.querySelector') {
      const rawNodeId = Number(params.nodeId ?? 1);
      const eid = rawNodeId === 1 ? null : toElem(rawNodeId);
      const out = (await bridgeCmd('DOM.querySelector', {
        ...(eid === null ? {} : { id: eid }),
        selector: String(params.selector ?? ''),
      })) as { id: number };
      // CDP: a miss is `{nodeId: 0}`, never an error or an absent field.
      reply(ws, id, { nodeId: out.id === 0 ? 0 : out.id * 2 + 1000 });
      return;
    }
    if (method === 'CSS.getComputedStyleForNode') {
      const eid = toElem(Number(params.nodeId));
      if (eid === null) {
        reply(ws, id, { computedStyle: [] });
        return;
      }
      const style = (await bridgeCmd('CSS.getComputedStyleForNode', { id: eid })) as {
        computed?: Record<string, unknown>;
        exists?: boolean;
      };
      // the node DevTools clicked is gone from the live tree (stale snapshot):
      // answer empty AND make the panel re-pull, or every click keeps dying
      if (style.exists === false) domInvalidated();
      // computedStyle is a FLAT [{name,value}] list for this frontend: its
      // SDK iterates the reply (r.length / for..of), so a single CSSStyle
      // object reads as "no properties" — verified against the real
      // frontend's sdk.js, not the protocol doc (spec 092)
      reply(ws, id, {
        computedStyle: Object.entries(style.computed ?? {}).map(([name, value]) => ({
          name,
          value: String(value),
        })),
      });
      return;
    }
    if (method === 'CSS.getMatchedStylesForNode' || method === 'CSS.getInlineStylesForNode') {
      const eid = toElem(Number(params.nodeId));
      const style =
        eid === null
          ? { inline: {} as Record<string, unknown>, matched: [] as MatchedRule[] }
          : ((await bridgeCmd('CSS.getMatchedStylesForNode', { id: eid })) as {
              inline?: Record<string, unknown>;
              exists?: boolean;
              matched?: MatchedRule[];
            });
      if (style.exists === false) domInvalidated();
      const inline = style.inline ?? {};
      // always hand back an (empty is fine) inline style: the Styles panel
      // then at least renders the `element.style` section instead of a blank
      // column. inlineStyle IS the CSS.Style per the CDP spec — an extra
      // `{style: ...}` wrapper makes the DevTools frontend throw while
      // parsing the response and the sidebar spins forever. The Styles
      // panel's element.style section reads getInlineStylesForNode, which
      // the frontend resolves to null unless inlineStyle is present.
      // matchedCSSRules feed the "where does this style come from" list —
      // selector texts and declarations come straight from the style engine
      // (spec 092); source ranges stay out, so no stylesheet link is shown.
      reply(ws, id, {
        inlineStyle: styleObject(inline),
        matchedCSSRules: (style.matched ?? []).map((m) => ({
          rule: {
            styleSheetId: FJS_STYLESHEET_ID,
            selectorList: {
              selectors: m.selectors.map((text) => ({ text })),
              text: m.selectors.join(', '),
            },
            origin: 'regular',
            style: {
              cssProperties: Object.entries(m.decls).map(([name, value]) => ({
                name: cssDisplayName(name),
                value: cssDisplayValue(name, value),
              })),
              shorthandEntries: [],
            },
          },
          matchingSelectors: m.matched,
        })),
      });
      return;
    }
    if (method === 'Network.enable') {
      networkEnabled = true;
      if (devtools) startNetPoll(devtools);
      reply(ws, id, {});
      return;
    }
    if (method === 'Network.disable') {
      networkEnabled = false;
      stopNetPoll();
      reply(ws, id, {});
      return;
    }
    if (method === 'Network.getResponseBody') {
      const cached = bodyCache.get(String(params.requestId));
      if (!cached) {
        replyError(
          ws,
          id,
          'response body not captured (too large, or the request predates this session)',
        );
        return;
      }
      reply(ws, id, { body: cached.base64, base64Encoded: true });
      return;
    }
    if (method === 'Page.getResourceTree') {
      reply(ws, id, {
        frameTree: {
          frame: { id: 'fjs', loaderId: '', url: 'fjs://app', mimeType: 'text/html' },
          resources: [],
        },
      });
      return;
    }
    if (method === 'Page.getNavigationHistory') {
      // the screencast panel asks for this on attach; an empty {} makes its
      // requestNavigationHistory throw reading `entries.length` (caught live
      // with the real frontend, spec 092)
      reply(ws, id, {
        currentIndex: 0,
        entries: [{ id: 1, url: 'fjs://app', title: 'fjs app' }],
      });
      return;
    }
    if (method === 'Page.startScreencast') {
      // no Flutter-side capture pipeline yet (roadmap). Refuse rather than
      // ack: an acked-but-silent screencast leaves the frontend's preview
      // pane blank, which reads as a broken target instead of "unsupported"
      replyError(ws, id, 'Page.startScreencast is not supported by the fjs relay');
      return;
    }
    if (method === 'Network.emulateNetworkConditionsByRule') {
      // the frontend's boot reads ruleIds.length off this reply — an empty
      // {} threw "Cannot read properties of undefined (reading 'length')"
      // inside sdk.js (measured with the real frontend, spec 092)
      reply(ws, id, { ruleIds: [] });
      return;
    }
    if (method === 'CSS.enable') {
      reply(ws, id, {});
      // after the reply, never at socket-open: CSSModel registers its CSS
      // dispatcher just before calling enable(), so this is the first moment
      // the event is guaranteed a listener (spec 092)
      announceStyleSheet();
      return;
    }
    if (method === 'CSS.disable') {
      styleSheetAnnounced = false;
      reply(ws, id, {});
      return;
    }
    // DOM.enable, Page.enable, Overlay.*, Emulation.*, Console.*, Log.*,
    // Performance.* …: acknowledged, with whatever the panel asked for left
    // empty — the panels degrade gracefully, and the docs list exactly what
    // is served. (requestChildNodes / getFlattenedInnerHTML / querySelector
    // are handled above, NOT here — see spec 093.)
    reply(ws, id, {});
  };

  // ---- structural-change poll (spec 093 T024) -----------------------------
  //
  // The runtime bumps `devtoolsStructuralVersion` ONLY on element
  // insert/remove and page-root add/remove. Polling it at 1.5s (rather than
  // the per-frame `Dom.version` that 092 proved would spin the Styles panel)
  // gives route pushes / subtree inserts an automatic re-pull within ~2s.
  // The same tick drains text/attr edits into incremental CDP events so a
  // counter click shows up in the tree without a document reload.

  const STRUCTURAL_POLL_MS = 1500;
  let structuralPollTimer: NodeJS.Timeout | null = null;
  let lastSeenStructuralVersion: number | null = null;
  /** A content drain hit the cap and the follow-up documentUpdated was
   * swallowed by the cooldown. Retry on the next tick. */
  let contentResyncPending = false;

  type ContentMutation =
    | { kind: 'text'; id: number; text: string }
    | { kind: 'attr'; id: number; name: string; value: string };

  const stopStructuralPoll = (): void => {
    if (structuralPollTimer) {
      clearInterval(structuralPollTimer);
      structuralPollTimer = null;
    }
    lastSeenStructuralVersion = null;
    contentResyncPending = false;
  };

  /** Text/attr edits since the last drain. `discard` drops them: a
   * documentUpdated is already on the wire and the re-pull has the new
   * values, so replaying the events would race that pull. */
  const pushContentEdits = async (discard: boolean): Promise<void> => {
    let drained: { mutations?: ContentMutation[]; overflow?: boolean };
    try {
      drained = (await bridgeCmd('Dom.drainContent')) as {
        mutations?: ContentMutation[];
        overflow?: boolean;
      };
    } catch {
      // runtime predates content drain — structural poll must keep working
      return;
    }
    const mutations = Array.isArray(drained?.mutations) ? drained.mutations : [];
    if (discard) {
      contentResyncPending = false;
      return;
    }
    if (drained?.overflow) contentResyncPending = true;
    if (contentResyncPending) {
      if (domInvalidated()) contentResyncPending = false;
      return;
    }
    for (const m of mutations) {
      if (m.kind === 'text') {
        pushToDevtools('DOM.characterDataModified', {
          nodeId: m.id * 2 + 1001,
          characterData: m.text,
        });
      } else if (m.kind === 'attr') {
        pushToDevtools('DOM.attributeModified', {
          nodeId: m.id * 2 + 1000,
          name: m.name,
          value: m.value,
        });
      }
    }
  };

  const startStructuralPoll = (ws: WebSocket): void => {
    if (structuralPollTimer) return;
    structuralPollTimer = setInterval(() => {
      void (async () => {
        if (!vm || ws.readyState !== WebSocket.OPEN) return;
        const out = (await bridgeCmd('Dom.structuralVersion')) as unknown as { version: number };
        if (lastSeenStructuralVersion === null) {
          // getDocument didn't report a version (runtime predates spec 093).
          // This tick can only baseline — there is no earlier snapshot to
          // compare against.
          lastSeenStructuralVersion = out.version;
          return;
        }
        let reloading = false;
        if (out.version !== lastSeenStructuralVersion) {
          // Cooldown false → leave the baseline where it is. Advancing it
          // anyway marks the route push as handled and the panel never
          // re-pulls that page root.
          if (domInvalidated()) {
            lastSeenStructuralVersion = out.version;
            reloading = true;
          }
        }
        await pushContentEdits(reloading);
      })().catch(() => {
        // a failed poll (app detached mid-round) just skips this round
      });
    }, STRUCTURAL_POLL_MS);
  };

  // ---- Network polling -----------------------------------------------------
  //
  // requestWillBeSent / responseReceived / loadingFinished are pushed as the
  // rows drain; bodies ride along (≤512KB, spec 089) into a cache that
  // Network.getResponseBody reads.

  let networkEnabled = false;
  let netPollTimer: NodeJS.Timeout | null = null;
  const netSent = new Set<number>();
  const netDone = new Set<number>();
  const bodyCache = new Map<string, { base64: string; size: number }>();

  const mimeTypeOf = (headers: Record<string, string>): string =>
    headers['content-type'] ?? headers['Content-Type'] ?? 'application/octet-stream';

  const startNetPoll = (ws: WebSocket): void => {
    if (netPollTimer) return;
    netPollTimer = setInterval(() => {
      void (async () => {
        if (!networkEnabled || !vm || ws.readyState !== WebSocket.OPEN) return;
        const out = (await bridgeCmd('Network.drain')) as unknown as {
          rows: {
            id: number;
            state: 'pending' | 'done';
            request?: { url: string; method: string; headers: Record<string, string> };
            response?: {
              url: string;
              status: number;
              statusText: string;
              headers: Record<string, string>;
            };
            body?: { base64?: string; size: number; truncated: boolean };
          }[];
        };
        const send = (method: string, params: Record<string, unknown>) => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ method, params }));
        };
        for (const row of out.rows) {
          const requestId = `n${row.id}`;
          if (!netSent.has(row.id) && row.request) {
            netSent.add(row.id);
            send('Network.requestWillBeSent', {
              requestId,
              loaderId: '',
              documentURL: row.request.url,
              request: {
                url: row.request.url,
                method: row.request.method,
                headers: row.request.headers,
              },
              timestamp: Date.now() / 1000,
              wallTime: Date.now() / 1000,
              type: 'Fetch',
              initiator: { type: 'other' },
            });
          }
          if (row.response && !netDone.has(row.id)) {
            netDone.add(row.id);
            send('Network.responseReceived', {
              requestId,
              type: 'Fetch',
              response: {
                url: row.response.url,
                status: row.response.status,
                statusText: row.response.statusText,
                headers: row.response.headers,
                mimeType: mimeTypeOf(row.response.headers),
                connectionReused: false,
                connectionId: 0,
                remoteIPAddress: '',
                remotePort: 0,
                fromDiskCache: false,
                fromServiceWorker: false,
                encodedDataLength: row.body?.size ?? -1,
              },
            });
            send('Network.loadingFinished', {
              requestId,
              timestamp: Date.now() / 1000,
              encodedDataLength: row.body?.size ?? 0,
            });
            if (row.body?.base64) {
              bodyCache.set(requestId, { base64: row.body.base64, size: row.body.size });
            }
          }
        }
      })().catch(() => {
        // a failed drain (app detached mid-poll) just skips this round
      });
    }, 500);
  };

  const stopNetPoll = (): void => {
    if (netPollTimer) {
      clearInterval(netPollTimer);
      netPollTimer = null;
    }
  };

const resetSessionCaches = (): void => {
  netSent.clear();
  netDone.clear();
  bodyCache.clear();
  networkEnabled = false;
  stopNetPoll();
  stopStructuralPoll();
  lastInvalidateAt = 0;

  // requests buffered while nothing was attached would flush into the
  // next VM as stale protocol traffic from a dead session
  devBuf = '';
};

  // ---- sockets ---------------------------------------------------------------

  const vmListener = createTcpServer((socket) => {
    // remoteAddress matters when a dial mysteriously never completes: the
    // Android emulator's network proxy fronts every guest connection, so a
    // relay-side trace of who knocked and when is the only ground truth
    log(`vm channel dial from ${socket.remoteAddress ?? '?'}`);
    if (vm) {
      log('a second app tried to attach the debugger — rejected (one session at a time)');
      socket.destroy();
      return;
    }
    vm = socket;
    vmCount++;
    // single-session relay, so this counter is a cumulative dial ordinal —
    // it never goes down on disconnect and must not read as a live count
    log(`app attached the debug channel (session #${vmCount})`);
    socket.setNoDelay(true);
    // a fresh VM means a fresh fetch id space — stale per-request bookkeeping
    // from the previous VM must never suppress rows (or serve stale bodies)
    resetSessionCaches();
    socket.on('data', (chunk) => feedDevtools(String(chunk)));
    const gone = () => {
      if (vm === socket) {
        vm = null;
        vmBuf = '';
        resetSessionCaches();
        log('app left the debug channel');
      }
    };
    socket.on('close', gone);
    socket.on('error', gone);
  });

  const httpServer: Server = createServer((req, res) => {
    const json = (obj: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url === '/json/version') {
      json({
        Browser: `fjs/${process.env.FJS_VERSION ?? 'debug'}`,
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: `ws://127.0.0.1:${opts.cdpPort}/cdp`,
      });
    } else if (req.url === '/json/list' || req.url === '/json') {
      json([
        {
          id: 'fjs',
          title: 'fjs (PrimJS on device)',
          type: 'page',
          url: 'fjs://app',
          webSocketDebuggerUrl: `ws://127.0.0.1:${opts.cdpPort}/cdp`,
        },
      ]);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const wss = new WebSocketServer({ server: httpServer, path: '/cdp' });
  wss.on('connection', (ws) => {
    if (devtools) {
      log('a second DevTools window tried to attach — rejected (one session at a time)');
      ws.close(1013, 'another debugger is attached');
      return;
    }
    devtools = ws;
    log('Chrome DevTools connected');
    // the synthesized log lines need a context to live in; announced before
    // anything else can reference it (see FJS_HOST_CONTEXT_ID)
    pushToDevtools('Runtime.executionContextCreated', {
      context: { id: FJS_HOST_CONTEXT_ID, origin: 'fjs://app', name: 'fjs host' },
    });
    // the synthetic stylesheet is announced on CSS.enable instead of here:
    // the frontend's CSSModel registers its event dispatcher in the same
    // constructor that calls enable(), so anything pushed at socket-open
    // races model creation and is silently dropped when it loses (spec 092,
    // measured: same build registered or not depending on boot timing).
    styleSheetAnnounced = false;

    ws.on('message', (data) => {
      let req: { id?: unknown; method?: unknown; params?: Record<string, unknown> };
      try {
        req = JSON.parse(String(data));
      } catch {
        return;
      }
      if (typeof req?.method !== 'string') return;
      const domain = req.method.split('.')[0];
      if (!BRIDGED.has(domain)) {
        feedVm(String(data));
        return;
      }
      if (!vm) {
        if (typeof req.id !== 'undefined')
          replyError(ws, req.id, 'no app attached to the debug channel yet');
        return;
      }
      void routeBridged(ws, req.id, req.method, req.params ?? {}).catch((e: Error) => {
        if (typeof req.id !== 'undefined') replyError(ws, req.id, e.message);
      });
    });
    ws.on('close', () => {
      if (devtools !== ws) return;
      devtools = null;
      devBuf = '';
      stopStructuralPoll();

      resetSessionCaches();
      // Tell the engine the session ended: a reconnecting DevTools must get
      // the scriptParsed replay (the engine only replays when the session
      // is not already enabled), and an app frozen at a breakpoint while
      // its debugger vanished has to unfreeze — Debugger.disable does both
      // (the reply lands nowhere and is harmless).
      if (vm) vm.write('{"id":0,"method":"Debugger.disable"}\n');
      log('Chrome DevTools disconnected — session reset');
    });
  });

  return new Promise((resolve, reject) => {
    let first: Error | null = null;
    const fail = (e: Error) => {
      if (!first) {
        first = e;
        reject(
          e.message.includes('EADDRINUSE')
            ? new Error(
                `port ${opts.cdpPort}/${opts.vmPort} is already in use — ` +
                  'another `fjs debug` may be running, or pass --port/--vm-port',
              )
            : e,
        );
      }
    };
    vmListener.once('error', fail);
    httpServer.once('error', fail);
    vmListener.listen(opts.vmPort, vmHost, () => {
      httpServer.listen(opts.cdpPort, '127.0.0.1', () => {
        if (first) return;
        resolve({
          consoleLine,
          banner: (sessions) =>
            `debug relay: CDP http://127.0.0.1:${opts.cdpPort}/json/list, ` +
            `VM channel :${opts.vmPort} (${sessions} attached)`,
          close: () =>
            new Promise<void>((done) => {
              vm?.destroy();
              stopNetPoll();
              stopStructuralPoll();

              wss.close();
              httpServer.close(() => {
                vmListener.close(() => done());
              });
              done();
            }),
        });
      });
    });
  });
}
