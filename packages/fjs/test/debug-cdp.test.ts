// spec 088 — the `fjs debug` CDP relay. The engine speaks CDP natively, so
// the relay is a byte pipe between the app's TCP channel and the DevTools
// WebSocket, plus the /json discovery endpoints. These tests pin the pipe
// semantics (framing survives, one session at a time) without a real VM.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { WebSocket } from 'ws';

import { startCdpRelay, type CdpRelay } from '../src/debug/cdp-server.js';

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((done) => srv.listen(0, '127.0.0.1', done));
  const port = (srv.address() as AddressInfo).port;
  await new Promise<void>((done) => srv.close(() => done()));
  return port;
}

describe('fjs debug cdp relay', () => {
  let relay: CdpRelay;
  let cdpPort: number;
  let vmPort: number;

  beforeAll(async () => {
    cdpPort = await freePort();
    vmPort = await freePort();
    relay = await startCdpRelay({ cdpPort, vmPort, vmHost: '127.0.0.1' });
  });

  afterAll(async () => {
    await relay.close();
  });

  it('discovery endpoints answer /json/version and /json/list', async () => {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.webSocketDebuggerUrl).toContain(`:${cdpPort}`);

    const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const targets = (await list.json()) as Array<Record<string, unknown>>;
    expect(targets).toHaveLength(1);
    expect(targets[0].type).toBe('page');
  });

  it('pipes CDP both ways between one VM and one DevTools socket', async () => {
    const seen: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${cdpPort}/cdp`);
    await new Promise<void>((done) => ws.once('open', done));

    // a VM dials the relay and identifies nothing — the relay is a pipe
    const vm = connect(vmPort, '127.0.0.1');
    await new Promise<void>((done) => vm.once('connect', done));

    // DevTools → VM: newline-framed CDP request survives the hop
    const vmLines: string[] = [];
    vm.on('data', (chunk) => {
      vmLines.push(...String(chunk).split('\n').filter(Boolean));
    });
    ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }));
    await new Promise<void>((done) => {
      const timer = setInterval(() => {
        if (vmLines.length) {
          clearInterval(timer);
          done();
        }
      }, 10);
    });
    expect(() => JSON.parse(vmLines[0])).not.toThrow();
    expect(JSON.parse(vmLines[0])).toMatchObject({ id: 1, method: 'Debugger.enable' });

    // VM → DevTools: engine events stream back intact
    ws.on('message', (raw) => seen.push(String(raw)));
    vm.write('{"method":"Debugger.scriptParsed","params":{"url":"bundle.js"}}\n');
    await new Promise<void>((done) => {
      const timer = setInterval(() => {
        if (seen.length) {
          clearInterval(timer);
          done();
        }
      }, 10);
    });
    expect(JSON.parse(seen[0])).toMatchObject({
      method: 'Debugger.scriptParsed',
    });

    // partial writes are framed, not split: two chunks, one message
    vm.write('{"method":"Runtime.enable"');
    vm.write(',"params":{}}\n');
    await new Promise<void>((done) => {
      const timer = setInterval(() => {
        if (seen.length >= 2) {
          clearInterval(timer);
          done();
        }
      }, 10);
    });
    expect(() => JSON.parse(seen[1])).not.toThrow();

    vm.destroy();
    // terminate (not close): the relay holds no per-session state that
    // needs the graceful handshake, and this mirrors a DevTools window
    // being killed — the next test then starts with an empty session table
    ws.terminate();
    await new Promise<void>((done) => ws.once('close', done));
  });

  it('serves DOM.getDocument by evaluating __fjsDevtools in the VM (spec 089)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${cdpPort}/cdp`);
    await new Promise<void>((done) => ws.once('open', done));
    await new Promise((r) => setTimeout(r, 50));

    // the fake VM answers the relay's Runtime.evaluate exactly like the
    // engine would (result.result.value = the JSON string the cmd returned)
    const vm = connect(vmPort, '127.0.0.1');
    await new Promise<void>((done) => vm.once('connect', done));
    let vmBuf = '';
    vm.on('data', (chunk) => {
      vmBuf += chunk;
      let pos;
      while ((pos = vmBuf.indexOf('\n')) !== -1) {
        const line = vmBuf.slice(0, pos);
        vmBuf = vmBuf.slice(pos + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { id: number; method: string; params: { expression: string } };
        if (msg.id >= 1e9 && msg.method === 'Runtime.evaluate') {
          expect(msg.params.expression).toContain('__fjsDevtools.cmd');
          const tree = { roots: [{ id: 5, tag: 'view', attrs: { class: 'card' }, children: [] }] };
          vm.write(
            JSON.stringify({
              id: msg.id,
              result: { result: { type: 'string', value: JSON.stringify(tree) } },
            }) + '\n',
          );
        }
      }
    });

    const response = await new Promise<any>((done) => {
      ws.on('message', function h(raw) {
        const msg = JSON.parse(String(raw));
        if (msg.id === 5) {
          ws.off('message', h);
          done(msg);
        }
      });
      ws.send(JSON.stringify({ id: 5, method: 'DOM.getDocument', params: {} }));
    });
    expect(response.error).toBeUndefined();
    const root = response.result.root;
    expect(root.nodeType).toBe(9);
    const element = root.children[0];
    expect(element.nodeName).toBe('view');
    expect(element.nodeId).toBe(5 * 2 + 1000);
    expect(element.attributes).toEqual(['class', 'card']);

    // an unattached second VM's bridged request fails loudly, not forever
    ws.close();
    vm.destroy();
    await new Promise<void>((done) => ws.once('close', done));
  });

  it('rejects a second DevTools socket while one is attached', async () => {
    const first = new WebSocket(`ws://127.0.0.1:${cdpPort}/cdp`);
    await new Promise<void>((done) => first.once('open', done));
    // let the relay's connection handler register `first` as the attached
    // session before `second` arrives, or the rejection could land on the
    // wrong connection
    await new Promise((r) => setTimeout(r, 50));
    const second = new WebSocket(`ws://127.0.0.1:${cdpPort}/cdp`);
    const closed = new Promise<number>((done) =>
      second.once('close', (code) => done(code)),
    );
    await expect(closed).resolves.toBe(1013);
    first.close();
  });
});

// spec 092 — the relay's own event synthesis: the app log stream becomes
// Runtime.consoleAPICalled, and the element tree stays fresh through
// DOM.documentUpdated. Each case runs its own DevTools socket + fake VM (one
// session at a time), with a VM that answers __fjsDevtools.cmd by method.
describe('fjs debug relay synthesis (spec 092)', () => {
  let relay: CdpRelay;
  let cdpPort: number;
  let vmPort: number;

  beforeAll(async () => {
    cdpPort = await freePort();
    vmPort = await freePort();
    relay = await startCdpRelay({ cdpPort, vmPort, vmHost: '127.0.0.1' });
  });

  afterAll(async () => {
    await relay.close();
  });

  interface Session {
    ws: WebSocket;
    vm: ReturnType<typeof connect>;
    seen: { method: string; params: any; id?: number; result?: any; error?: any }[];
    /** resolves on the first message matching pred (already in `seen`) */
    waitFor(
      pred: (m: { method?: string; id?: number }) => boolean,
      timeoutMs?: number,
    ): Promise<void>;
    close(): Promise<void>;
  }

  /** DevTools socket + a VM whose cmd answers come from `answer(method)`.
   * Non-bridge lines (engine events, debug-reload markers) go up as-is via
   * `vmSend`. The message collector registers BEFORE the socket opens: the
   * relay pushes the synthesized execution context inside the connection
   * handler, and a collector attached after `open` misses it. */
  async function attach(
    answer: (method: string) => string | undefined,
  ): Promise<Session> {
    const ws = new WebSocket(`ws://127.0.0.1:${cdpPort}/cdp`);
    const seen: Session['seen'] = [];
    ws.on('message', (raw) => {
      seen.push(JSON.parse(String(raw)));
    });
    await new Promise<void>((done) => ws.once('open', done));
    const vm = connect(vmPort, '127.0.0.1');
    // destroy() below would surface as an unhandled ECONNRESET otherwise
    vm.on('error', () => {});
    await new Promise<void>((done) => vm.once('connect', done));
    let vmBuf = '';
    vm.on('data', (chunk) => {
      vmBuf += chunk;
      let pos;
      while ((pos = vmBuf.indexOf('\n')) !== -1) {
        const line = vmBuf.slice(0, pos);
        vmBuf = vmBuf.slice(pos + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as {
          id: number;
          method: string;
          params: { expression?: string };
        };
        // bridge evaluates carry the cmd method in the expression
        const match = msg.params?.expression?.match(/__fjsDevtools\.cmd\("([^"]+)"/);
        if (msg.id >= 1e9 && match) {
          const value = answer(match[1]);
          if (value === undefined) return;
          vm.write(
            JSON.stringify({
              id: msg.id,
              result: { result: { type: 'string', value } },
            }) + '\n',
          );
        }
      }
    });
    const waitFor = (pred: (m: { method?: string; id?: number }) => boolean, timeoutMs = 3000) =>
      new Promise<void>((done, fail) => {
        const started = Date.now();
        const timer = setInterval(() => {
          if (seen.some(pred)) {
            clearInterval(timer);
            done();
          } else if (Date.now() - started > timeoutMs) {
            clearInterval(timer);
            fail(new Error('expected CDP message never arrived'));
          }
        }, 10);
      });
    const close = async () => {
      ws.close();
      vm.destroy();
      await new Promise<void>((done) => ws.once('close', () => done()));
    };
    return { ws, vm, seen, waitFor, close };
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('announces the fjs host context and synthesizes console events from the log stream', async () => {
    const s = await attach(() => undefined);
    // the synthesized context lands before anything can reference it
    await s.waitFor((m) => m.method === 'Runtime.executionContextCreated');
    const ctx = s.seen.find((m) => m.method === 'Runtime.executionContextCreated')!;
    expect(ctx.params.context.name).toBe('fjs host');

    relay.consoleLine(3, '[nav] mounted key=1');
    await s.waitFor((m) => m.method === 'Runtime.consoleAPICalled');
    const line = s.seen.find((m) => m.method === 'Runtime.consoleAPICalled')!;
    expect(line.params.type).toBe('error');
    expect(line.params.executionContextId).toBe(ctx.params.context.id);
    expect(line.params.args[0].value).toBe('[nav] mounted key=1');

    // eval answers ride the same stream and are not console output
    const before = s.seen.filter((m) => m.method === 'Runtime.consoleAPICalled').length;
    relay.consoleLine(1, '\u0000fjs-eval:7:ok:2');
    await sleep(100);
    const after = s.seen.filter((m) => m.method === 'Runtime.consoleAPICalled').length;
    expect(after).toBe(before);
    await s.close();
  });

  it('never pushes DOM.documentUpdated on its own initiative (only world resets)', async () => {
    // the first spec-092 design polled a tree version and pushed the event
    // on change; against the real frontend that keeps the Styles sidebar
    // spinning forever on a busy app, so the relay must stay silent here
    const s = await attach((method) =>
      method === 'Dom.version' ? JSON.stringify({ version: 1 }) : JSON.stringify({ roots: [] }),
    );
    await sleep(1200);
    expect(s.seen.filter((m) => m.method === 'DOM.documentUpdated').length).toBe(0);
    await s.close();
  });

  it('pushes DOM.documentUpdated on the app debug-reload marker', async () => {
    const s = await attach(() => undefined);
    s.vm.write('{"fjs":"debug-reload"}\n');
    await s.waitFor((m) => m.method === 'DOM.documentUpdated');
    await s.close();
  });

  it('declines Page.startScreencast so the frontend drops the preview pane', async () => {
    const s = await attach(() => undefined);
    const reply = new Promise<any>((done) => {
      const timer = setInterval(() => {
        const hit = s.seen.find((m) => m.id === 21 && (m.result || m.error));
        if (hit) {
          clearInterval(timer);
          done(hit);
        }
      }, 10);
    });
    s.ws.send(JSON.stringify({ id: 21, method: 'Page.startScreencast', params: {} }));
    const response = await reply;
    expect(response.error?.message).toContain('startScreencast');
    await s.close();
  });

  it('self-heals a stale selection: empty styles + documentUpdated', async () => {
    const s = await attach((method) =>
      method === 'CSS.getComputedStyleForNode'
        ? JSON.stringify({ computed: {}, inline: {}, classes: [], exists: false })
        : JSON.stringify({ inline: {}, exists: true }),
    );
    const reply = new Promise<any>((done) => {
      const timer = setInterval(() => {
        const hit = s.seen.find(
          (m) => m.id === 11 && (m.result || m.error),
        );
        if (hit) {
          clearInterval(timer);
          done(hit);
        }
      }, 10);
    });
    s.ws.send(
      JSON.stringify({ id: 11, method: 'CSS.getComputedStyleForNode', params: { nodeId: 2000 } }),
    );
    const response = await reply;
    expect(response.result.computedStyle).toEqual([]);
    await s.waitFor((m) => m.method === 'DOM.documentUpdated');
    await s.close();
  });

  it('always answers an inline style so element.style renders', async () => {
    const s = await attach((method) =>
      method === 'CSS.getMatchedStylesForNode'
        ? JSON.stringify({ inline: {}, exists: true })
        : JSON.stringify({ roots: [] }),
    );
    const reply = new Promise<any>((done) => {
      const timer = setInterval(() => {
        const hit = s.seen.find((m) => m.id === 12 && (m.result || m.error));
        if (hit) {
          clearInterval(timer);
          done(hit);
        }
      }, 10);
    });
    s.ws.send(
      JSON.stringify({ id: 12, method: 'CSS.getMatchedStylesForNode', params: { nodeId: 2000 } }),
    );
    const response = await reply;
    // inlineStyle IS the CSS.Style object — an extra {style: ...} wrapper
    // makes the real DevTools frontend throw and the Styles sidebar spin
    expect(response.result.inlineStyle).toEqual({
      cssProperties: [],
      shorthandEntries: [],
    });
    expect(response.result.matchedCSSRules).toEqual([]);
    await s.close();
  });

  it('serves CSS.getInlineStylesForNode (the Styles panel element.style source)', async () => {
    const s = await attach((method) =>
      method === 'CSS.getMatchedStylesForNode'
        ? JSON.stringify({ inline: { color: 'red' }, exists: true })
        : JSON.stringify({ roots: [] }),
    );
    const reply = new Promise<any>((done) => {
      const timer = setInterval(() => {
        const hit = s.seen.find((m) => m.id === 13 && (m.result || m.error));
        if (hit) {
          clearInterval(timer);
          done(hit);
        }
      }, 10);
    });
    s.ws.send(
      JSON.stringify({ id: 13, method: 'CSS.getInlineStylesForNode', params: { nodeId: 2000 } }),
    );
    const response = await reply;
    // the frontend resolves getInlineStyles to null unless inlineStyle is
    // present, and the Styles panel's element.style section then stays empty
    expect(response.result.inlineStyle).toEqual({
      cssProperties: [{ name: 'color', value: 'red' }],
      shorthandEntries: [],
    });
    await s.close();
  });

  it('builds matchedCSSRules from the runtime matched list (spec 092 round 3)', async () => {
    const s = await attach((method) =>
      method === 'CSS.getMatchedStylesForNode'
        ? JSON.stringify({
            inline: {},
            exists: true,
            matched: [
              { selectors: ['.other', '.title'], matched: [1], decls: { fontSize: 13 } },
              { selectors: ['.title'], matched: [0], decls: { color: 'red' } },
            ],
          })
        : JSON.stringify({ roots: [] }),
    );
    const reply = new Promise<any>((done) => {
      const timer = setInterval(() => {
        const hit = s.seen.find((m) => m.id === 14 && (m.result || m.error));
        if (hit) {
          clearInterval(timer);
          done(hit);
        }
      }, 10);
    });
    s.ws.send(
      JSON.stringify({ id: 14, method: 'CSS.getMatchedStylesForNode', params: { nodeId: 2000 } }),
    );
    const response = await reply;
    const rules = response.result.matchedCSSRules;
    expect(rules).toHaveLength(2);
    expect(rules[0].rule.selectorList.selectors).toEqual([{ text: '.other' }, { text: '.title' }]);
    expect(rules[0].matchingSelectors).toEqual([1]);
    expect(rules[0].rule.origin).toBe('regular');
    // engine-normalized camelCase/number becomes CSS display spelling
    expect(rules[0].rule.style.cssProperties).toEqual([{ name: 'font-size', value: '13px' }]);
    await s.close();
  });

  it('announces the synthetic stylesheet on CSS.enable, not at socket-open (spec 092)', async () => {
    const s = await attach(() => JSON.stringify({ roots: [] }));
    const send = (id: number, method: string) =>
      new Promise<any>((done) => {
        const timer = setInterval(() => {
          const hit = s.seen.find((m) => m.id === id && (m.result || m.error));
          if (hit) {
            clearInterval(timer);
            done(hit);
          }
        }, 10);
        s.ws.send(JSON.stringify({ id, method, params: {} }));
      });

    // socket-open must stay silent: the frontend's CSSModel dispatcher
    // registers later, so an early event is a coin flip
    await s.waitFor((m) => m.method === 'Runtime.executionContextCreated');
    expect(s.seen.some((m) => m.method === 'CSS.styleSheetAdded')).toBe(false);

    await send(21, 'CSS.enable');
    await s.waitFor((m) => m.method === 'CSS.styleSheetAdded');
    const sheets = () => s.seen.filter((m) => m.method === 'CSS.styleSheetAdded');
    expect(sheets()).toHaveLength(1);
    expect(sheets()[0].params.header.styleSheetId).toBe('fjs-main');
    expect(sheets()[0].params.header.origin).toBe('regular');
    // the event follows the enable reply (reply first, push second)
    const replyIdx = s.seen.findIndex((m) => m.id === 21 && m.result);
    const pushIdx = s.seen.findIndex((m) => m.method === 'CSS.styleSheetAdded');
    expect(replyIdx).toBeGreaterThanOrEqual(0);
    expect(pushIdx).toBeGreaterThan(replyIdx);

    // a second enable in the same cycle must not duplicate the header
    // (the frontend's handler asserts on re-registration)
    await send(22, 'CSS.enable');
    expect(sheets()).toHaveLength(1);

    // disable re-arms it: the next enable re-announces
    await send(23, 'CSS.disable');
    await send(24, 'CSS.enable');
    await s.waitFor(() => sheets().length === 2);
    await s.close();
  });
});
