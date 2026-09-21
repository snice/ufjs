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
      name,
      value: String(value),
    })),
    shorthandEntries: [],
  });

  const routeBridged = async (
    ws: WebSocket,
    id: unknown,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    if (method === 'DOM.getDocument') {
      const doc = (await bridgeCmd('DOM.getDocument', {})) as unknown as {
        roots: RuntimeNode[];
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
      };
      reply(ws, id, {
        computedStyle: Object.entries(style.computed ?? {}).map(([name, value]) => ({
          name,
          value: String(value),
        })),
      });
      return;
    }
    if (method === 'CSS.getMatchedStylesForNode') {
      const eid = toElem(Number(params.nodeId));
      const style =
        eid === null
          ? { inline: {} as Record<string, unknown> }
          : ((await bridgeCmd('CSS.getMatchedStylesForNode', { id: eid })) as {
              inline?: Record<string, unknown>;
            });
      const inline = style.inline ?? {};
      reply(ws, id, {
        inlineStyle: Object.keys(inline).length
          ? { style: styleObject(inline) }
          : undefined,
        matchedCSSRules: [],
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
    // DOM.enable/requestChildNodes, CSS.enable, Page.enable, Overlay.*,
    // Emulation.*, Console.*, Log.*, Performance.* …: acknowledged, with
    // whatever the panel asked for left empty — the panels degrade
    // gracefully, and the docs list exactly what is served.
    reply(ws, id, {});
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
    log(`app attached the debug channel (${vmCount} session${vmCount === 1 ? '' : 's'} total)`);
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
          banner: (sessions) =>
            `debug relay: CDP http://127.0.0.1:${opts.cdpPort}/json/list, ` +
            `VM channel :${opts.vmPort} (${sessions} attached)`,
          close: () =>
            new Promise<void>((done) => {
              vm?.destroy();
              stopNetPoll();
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
