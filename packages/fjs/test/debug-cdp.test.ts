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
