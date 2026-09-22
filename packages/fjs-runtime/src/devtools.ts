// DevTools data plane (spec 089/090): everything the `fjs debug` relay needs
// to answer the browser-only CDP domains — Elements (element tree, styles)
// and Network (fetch rows + bodies).
//
// Why a globalThis module instead of engine support: PrimJS implements
// Debugger/Runtime only; DOM/Network describe things that live on THIS side
// (the element tree, the fetch wrapper). The relay turns DOM.* / Network.*
// requests into `Runtime.evaluate(__fjsDevtools.cmd(...))` calls against this
// object — the debug channel works while the VM is paused, needs no new
// protocol (constitution II) and covers fjsrun desktop VMs for free.
//
// spec 090: this module is bundled ONLY in dev / `--devtools` builds — the
// bundler injects it and calls devtoolsBoot() under the __FJS_DEVTOOLS__
// define. It installs the real implementations into the always-present
// devtoolsSlots (devtools-hooks.ts); the call sites in element.ts /
// renderer.ts / net/fetch.ts keep working either way.
import { base64Decode, base64Encode } from './net/base64';
import {
  devtoolsSlots,
  devtoolsStructuralVersion,
  devtoolsTreeVersion,
  type DevtoolsNetRow,
  type DevtoolsNode,
  type DevtoolsTreeProvider,
} from './devtools-hooks';

// Build-time define injected by the fjs bundler (spec 090).
declare const __FJS_DEVTOOLS__: boolean;

/* ---- element records (fed through the slots) --------------------------- */

const propsOf = new Map<number, Record<string, unknown>>();
const textOf = new Map<number, string>();

/** Mirrors the props a node has received, merged over prior updates (the
 * renderer may setProps one prop at a time). Event-marker props are included
 * so the Elements panel shows handlers as attributes, like DevTools does. */
/** Content edits since the last drain. The relay turns these into
 * `DOM.characterDataModified` / `DOM.attributeModified` — incremental
 * events the Elements tree applies in place. A full `documentUpdated`
 * for the same edit restarts every pending style request (092 R14). */
const CONTENT_CAP = 200;
const contentMutations: Array<
  | { kind: 'text'; id: number; text: string }
  | { kind: 'attr'; id: number; name: string; value: string }
> = [];
let contentOverflow = false;
/** Queuing starts after the first document pull. Writes before that are
 * already in the snapshot the panel just received. */
let contentLive = false;

function noteContent(
  mutation:
    | { kind: 'text'; id: number; text: string }
    | { kind: 'attr'; id: number; name: string; value: string },
): void {
  if (!contentLive) return;
  if (contentMutations.length >= CONTENT_CAP) {
    contentOverflow = true;
    return;
  }
  contentMutations.push(mutation);
}

function attrValue(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function recordProps(id: number, clean: Record<string, unknown>): void {
  const prev = propsOf.get(id);
  propsOf.set(id, prev ? { ...prev, ...clean } : { ...clean });
  if (!prev) return;
  for (const [name, value] of Object.entries(clean)) {
    const next = attrValue(value);
    if (prev[name] !== undefined && attrValue(prev[name]) === next) continue;
    noteContent({ kind: 'attr', id, name, value: next });
  }
}

/** Last text of a text-bearing node ({{ }} / setValue paths). */
function recordText(id: number, text: string): void {
  const prev = textOf.get(id);
  textOf.set(id, text);
  if (prev !== undefined && prev !== text) noteContent({ kind: 'text', id, text });
}

/* ---- tree provider (registered by the Vue renderer via the slots) ------ */

let tree: DevtoolsTreeProvider | null = null;

function cssText(style: Record<string, unknown> | undefined): string {
  if (!style) return '';
  return Object.entries(style)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('; ');
}

function buildNode(id: number, visited: Set<number>): DevtoolsNode | null {
  const provider = devtoolsSlots.provider;
  if (!provider || !provider.exists(id)) return null;
  visited.add(id);
  const attrs: Record<string, string> = {};
  const classes = provider.classesOf(id);
  if (classes.length) attrs.class = classes.join(' ');
  const inline = provider.inlineStyle(id);
  const styleText = cssText(inline);
  if (styleText) attrs.style = styleText;
  const props = propsOf.get(id);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style' || attrs[k] !== undefined) continue;
      attrs[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    }
  }
  const text = textOf.get(id);
  return {
    id,
    tag: provider.tag(id),
    attrs,
    text: text === undefined ? undefined : String(text),
    children: provider
      .childIds(id)
      .map((cid) => buildNode(cid, visited))
      .filter((n): n is DevtoolsNode => n !== null),
  };
}

/* ---- network rows (fed by net/fetch.ts) -------------------------------- */

const NET_BODY_CAP = 512 * 1024; // bytes; bigger responses report size only
const NET_ROW_KEEP = 100;

const netRows = new Map<number, DevtoolsNetRow>();
/** Rows are recorded only after the first netDrain(): a Network panel is
 * demonstrably attached, so the per-response body copy is paid for a
 * consumer, never speculatively. */
let netActive = false;

function netRequest(row: {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyBase64?: string;
}): void {
  if (!netActive) return;
  netRows.set(row.id, {
    id: row.id,
    state: 'pending',
    request: {
      url: row.url,
      method: row.method,
      headers: row.headers,
      bodyBase64: row.bodyBase64,
    },
  });
}

/** Response bodies ride binary handles (ABI ≥ 2) whose bytes belong to the
 * app's own `text()/json()` read. Bodies are therefore recorded when the app
 * materializes them — see the hook call in net/fetch.ts materialize(). */
const handleToRow = new Map<number, number>();

function netResponse(row: {
  id: number;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64?: string;
  handle: number | null;
}): void {
  if (!netActive) return;
  const existing = netRows.get(row.id);
  if (!existing) return; // no panel attached when the request went out
  let body: DevtoolsNetRow['body'];
  // The Dart host sends an EMPTY bodyBase64 when the body rides a handle —
  // branch on truthiness, not definedness.
  if (row.bodyBase64) {
    const size = Math.floor((row.bodyBase64.length * 3) / 4);
    body =
      size <= NET_BODY_CAP
        ? { base64: row.bodyBase64, size, truncated: false }
        : { size, truncated: true };
  } else if (row.handle != null) {
    handleToRow.set(row.handle, row.id);
  }
  netRows.set(row.id, {
    ...existing,
    state: 'done',
    response: {
      url: row.url,
      status: row.status,
      statusText: row.statusText,
      headers: row.headers,
    },
    body,
  });
}

/** Called from net/fetch.ts when the app materializes a handled body: this
 * is the verified copy (the app is about to use it), so the Network panel
 * records from it — no second borrow, no speculation. */
function netBodyMaterialized(handle: number, bytes: Uint8Array): void {
  const rowId = handleToRow.get(handle);
  if (rowId === undefined) return;
  const row = netRows.get(rowId);
  if (!row) return;
  const capped = bytes.length <= NET_BODY_CAP ? bytes : bytes.slice(0, NET_BODY_CAP);
  row.body = {
    base64: base64Encode(capped),
    size: bytes.length,
    truncated: bytes.length > NET_BODY_CAP,
  };
}

/* ---- the cmd surface the relay evaluates ------------------------------- */

/** Frees props/text records for ids that left the tree. Runs on every doc()
 * so an unbounded session cannot grow the maps forever. */
function sweep(visited: Set<number>): void {
  for (const id of propsOf.keys()) if (!visited.has(id)) propsOf.delete(id);
  for (const id of textOf.keys()) if (!visited.has(id)) textOf.delete(id);
}

function cmd(method: string, paramsJson: string): unknown {
  const params = paramsJson ? (JSON.parse(paramsJson) as Record<string, unknown>) : {};
  // The relay addresses cmds by the CDP method it is serving — one namespace
  // fewer to keep in sync between the two sides.
  if (method === 'DOM.getDocument') return docCmd();
  if (method === 'CSS.getComputedStyleForNode' || method === 'CSS.getMatchedStylesForNode') {
    return styleCmd(Number(params.id));
  }
  if (method === 'Dom.version') return versionCmd();
  if (method === 'Dom.structuralVersion') return structuralVersionCmd();
  if (method === 'Dom.drainContent') return drainContentCmd();
  if (method === 'DOM.requestChildNodes') return requestChildNodesCmd(Number(params.id));
  if (method === 'DOM.getFlattenedInnerHTML') return flattenedHtmlCmd(Number(params.id));
  if (method === 'DOM.querySelector') {
    return querySelectorCmd(
      params.id === undefined || params.id === null ? null : Number(params.id),
      String(params.selector ?? ''),
    );
  }
  if (method === 'Network.drain') return drainCmd();
  if (method === 'Network.getResponseBody') return bodyCmd(Number(params.id));
  throw new Error(`__fjsDevtools: unknown cmd ${method}`);
}

function docCmd(): unknown {
  const provider = devtoolsSlots.provider;
  if (!provider) return { roots: [], live: false };
  const visited = new Set<number>();
  const roots = provider
    .roots()
    .map((id) => buildNode(id, visited))
    .filter((n): n is DevtoolsNode => n !== null);
  sweep(visited);
  // The panel now holds this snapshot. Drop anything queued before it and
  // start recording edits so a later text/attr change can be pushed without
  // a full document reload.
  contentMutations.length = 0;
  contentOverflow = false;
  contentLive = true;
  // The relay baselines its structural poll on THIS number, taken in the
  // same turn as the tree. Sampling the counter on the first poll tick
  // (up to 1.5s later) treated a route push in that window as "already in
  // the snapshot" and the Elements panel stayed on the previous page root.
  return { roots, live: true, structuralVersion: devtoolsStructuralVersion.value };
}

function styleCmd(id: number): unknown {
  const provider = devtoolsSlots.provider;
  return {
    computed: provider?.computedStyle(id) ?? {},
    inline: provider?.inlineStyle(id) ?? {},
    classes: provider ? provider.classesOf(id) : [],
    // spec 092: false means the id is gone from the live tree (DevTools is
    // reading a stale snapshot) — the relay answers empty AND pushes
    // DOM.documentUpdated so the panel re-pulls instead of staying dead
    exists: !!provider && provider.exists(id),
    // the Styles panel's matched-rules list (selector texts, matched
    // indices, per-rule declarations), in cascade order
    matched: provider?.matchedRules?.(id) ?? [],
  };
}

/** Introspection for tooling: how many UI frames have gone out. The relay's
 * DOM invalidation ended up push-based (world resets + stale-click healing,
 * spec 092) — a change poll here made the real DevTools re-pull the document
 * on every frame of a busy app, so it was dropped. Kept because it is free
 * and answers "is the tree moving" without a doc pull. */
function versionCmd(): unknown {
  return { version: devtoolsTreeVersion.value };
}

/** The STRUCTURE-only counter (spec 093). The relay polls this at a low
 * frequency and pushes DOM.documentUpdated only when it moves — see
 * devtools-hooks.ts for why this must never track plain attribute/text
 * mutations. */
function structuralVersionCmd(): unknown {
  return { version: devtoolsStructuralVersion.value };
}

/** Text/attr edits since the previous drain. The relay emits one CDP event
 * per entry. `overflow` means the cap was hit and the panel should re-pull
 * instead of trusting a partial list. */
function drainContentCmd(): unknown {
  const mutations = contentMutations.splice(0);
  const overflow = contentOverflow;
  contentOverflow = false;
  return { mutations, overflow };
}

/* ---- lazy tree access (spec 093) ----------------------------------------- */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeHtml(node: DevtoolsNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join('');
  const open = `<${node.tag}${attrs}>`;
  const close = `</${node.tag}>`;
  const inner =
    (node.text === undefined ? '' : escapeHtml(node.text)) +
    node.children.map(serializeHtml).join('');
  return inner ? open + inner + close : open;
}

/** Direct children of `id` for DOM.requestChildNodes. A missing node yields
 * an empty list — the relay translates that to `{nodes: []}` (spec 093). */
function requestChildNodesCmd(id: number): unknown {
  const provider = devtoolsSlots.provider;
  if (!provider || !provider.exists(id)) return { id, children: [] };
  const visited = new Set<number>();
  const children = provider
    .childIds(id)
    .map((cid) => buildNode(cid, visited))
    .filter((n): n is DevtoolsNode => n !== null);
  return { id, children };
}

/** Subtree as an HTML string for DOM.getFlattenedInnerHTML. A missing node
 * yields an empty string (spec 093). */
function flattenedHtmlCmd(id: number): unknown {
  const provider = devtoolsSlots.provider;
  if (!provider || !provider.exists(id)) return { html: '' };
  const node = buildNode(id, new Set<number>());
  return { html: node ? serializeHtml(node) : '' };
}

/** Minimal selector matcher for DOM.querySelector: supports compound
 * selectors made of a type / `#id` / `.class` / `[attr=value]` pieces,
 * space-separated descendant combinators, and strips `:pseudo` classes
 * (matching the same "skip state pseudo" rule as matchedRulesOf — a static
 * tree has no hover/active state). Unknown selector shapes answer 0 rather
 * than throwing, so a DevTools probe never breaks the panel (spec 093). */
function querySelectorCmd(scopedId: number | null, selector: string): unknown {
  const provider = devtoolsSlots.provider;
  if (!provider) return { id: 0 };

  type Step = { tag?: string; id?: string; classes: string[]; attrs: Array<[string, string]> };
  const parseStep = (raw: string): Step | null => {
    const step: Step = { classes: [], attrs: [] };
    const re = /([a-zA-Z][\w-]*|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=([^\]]+))?\])|:([\w-]+)(\([^)]*\))?/g;
    let matchedAny = false;
    let consumed = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      if (m.index !== consumed) return null; // unsupported fragment (combinator, `*`, …)
      consumed = m.index + m[0].length;
      if (m[1]) {
        matchedAny = true;
        if (m[1][0] === '#') step.id = m[2];
        else if (m[1][0] === '.') step.classes.push(m[3]);
        else if (m[1][0] === '[') step.attrs.push([m[4], m[5] ?? '']);
        else step.tag = m[1];
      }
      // :pseudo (m[6]) is consumed but not evaluated — a static snapshot has
      // no hover/active state, same rule as matchedRulesOf (spec 093).
    }
    if (consumed !== raw.length) return null;
    return matchedAny ? step : null;
  };

  const matchesStep = (id: number, step: Step): boolean => {
    if (step.tag && provider.tag(id) !== step.tag) return false;
    if (step.id && (propsOf.get(id)?.['id'] as string | undefined) !== step.id) return false;
    if (step.classes.length) {
      const classes = provider.classesOf(id);
      for (const cls of step.classes) if (!classes.includes(cls)) return false;
    }
    for (const [name, value] of step.attrs) {
      const props = propsOf.get(id);
      const actual = provider.inlineStyle(id)?.[name] ?? props?.[name];
      if (actual === undefined) return false;
      if (value !== '' && String(actual) !== value) return false;
    }
    return true;
  };

  const parts = selector.trim().split(/\s+/).map(parseStep);
  if (!parts.length || parts.some((p) => p === null)) return { id: 0 };
  const steps = parts as Step[];
  const last = steps.length - 1;

  // Pre-order walk carrying how many leading steps have matched along the
  // current root→node path (descendant combinators = "some ancestor matched").
  // Single-step selectors — the overwhelmingly common DevTools probe — reduce
  // to a plain pre-order find on the first node that matches `steps[0]`.
  const walk = (id: number, depth: number): number => {
    if (!provider.exists(id)) return 0;
    const nowMatched = matchesStep(id, steps[depth]) ? depth + 1 : depth;
    if (nowMatched > last) return id; // every step matched on this path
    for (const cid of provider.childIds(id)) {
      // carry BOTH outcomes: the path may continue matching from `nowMatched`,
      // or (if this node didn't extend the chain) from the inherited `depth`
      const hit = walk(cid, nowMatched) || (nowMatched > depth ? walk(cid, depth) : 0);
      if (hit) return hit;
    }
    return 0;
  };

  const roots = scopedId === null ? provider.roots() : [scopedId];
  for (const root of roots) {
    const hit = walk(root, 0);
    if (hit) return { id: hit };
  }
  return { id: 0 };
}

function drainCmd(): unknown {
  netActive = true;
  const rows: DevtoolsNetRow[] = [];
  for (const row of netRows.values()) rows.push(row);
  // rows stay put (the relay overlays its view); the map itself is LRU-trimmed
  while (netRows.size > NET_ROW_KEEP) {
    netRows.delete(netRows.keys().next().value as number);
  }
  return { rows };
}

function bodyCmd(id: number): unknown {
  const row = netRows.get(id);
  return row?.body ?? { size: -1, truncated: false };
}

// The relay evaluates exactly this shape; keep the name stable — it is the
// contract of this whole module (see specs/089-devtools-panels/plan.md §3).
/** Called from index.ts: installs hooks + registers `__fjsDevtools`.
 * The bundler replaces `__FJS_DEVTOOLS__` with true/false; false DCEs the
 * entire data plane from the output. */
export function bootIfEnabled(): void {
  // `typeof` first, not a bare read: consumers that import @ufjs/runtime
  // without our bundler (plain vitest in sibling packages) never set the
  // define and would throw at import time. esbuild substitutes inside
  // `typeof` too, so define=false still folds this to false and DCEs the
  // whole data plane.
  if (typeof __FJS_DEVTOOLS__ !== 'undefined' && __FJS_DEVTOOLS__) devtoolsBoot();
}

export function devtoolsBoot(): void {
  devtoolsSlots.recordProps = recordProps;
  devtoolsSlots.recordText = recordText;
  devtoolsSlots.netRequest = netRequest;
  devtoolsSlots.netResponse = netResponse;
  devtoolsSlots.netBodyMaterialized = netBodyMaterialized;
  const g = globalThis as Record<string, unknown>;
  g.__fjsDevtools = {
    version: '093-1',
    cmd: (method: string, paramsJson: string): string =>
      JSON.stringify(cmd(method, paramsJson)),
  };
}
