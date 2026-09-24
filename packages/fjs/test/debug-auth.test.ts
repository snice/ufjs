// spec 107 — the relay's VM door. A VM dialing from off the dev machine has
// to present the session token (the relay asks for it with a plain
// Runtime.evaluate) before it gets the one debug session. The tests dial
// over loopback and switch the loopback exemption off to stand in for a LAN
// peer.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { WebSocket } from 'ws';

import { startCdpRelay, type CdpRelay } from '../src/debug/cdp-server.js';

const TOKEN = '0123456789abcdef0123456789abcdef';

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((done) => srv.listen(0, '127.0.0.1', done));
  const port = (srv.address() as AddressInfo).port;
  await new Promise<void>((done) => srv.close(() => done()));
  return port;
}

const until = (cond: () => boolean, ms = 2000) =>
  new Promise<void>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (cond()) {
        clearInterval(timer);
        done();
      } else if (Date.now() - start > ms) {
        clearInterval(timer);
        fail(new Error('timed out waiting'));
      }
    }, 10);
  });

/** A fake VM: answers the token challenge with [answer] (or never, for
 * null) and records every other line it receives. */
function fakeVm(port: number, answer: string | null) {
  const socket: Socket = connect(port, '127.0.0.1');
  const lines: string[] = [];
  let closed = false;
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk;
    let pos;
    while ((pos = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, pos);
      buf = buf.slice(pos + 1);
      const msg = JSON.parse(line) as { id: number; method?: string; params?: { expression?: string } };
      if (msg.id >= 2e9 && msg.method === 'Runtime.evaluate') {
        expect(msg.params?.expression).toContain('__fjsDebugToken');
        if (answer !== null) {
          socket.write(
            JSON.stringify({ id: msg.id, result: { result: { type: 'string', value: answer } } }) + '\n',
          );
        }
        continue;
      }
      lines.push(line);
    }
  });
  socket.on('close', () => (closed = true));
  socket.on('error', () => {});
  return { socket, lines, isClosed: () => closed };
}

describe('fjs debug relay token challenge (specs/107)', () => {
  let relay: CdpRelay;
  let cdpPort: number;
  let vmPort: number;
  const logs: string[] = [];

  beforeEach(async () => {
    cdpPort = await freePort();
    vmPort = await freePort();
    logs.length = 0;
    relay = await startCdpRelay({
      cdpPort,
      vmPort,
      vmHost: '127.0.0.1',
      token: TOKEN,
      trustLoopback: false,
      challengeMs: 300,
      log: (l) => logs.push(l),
    });
  });
  afterEach(async () => {
    await relay.close();
  });

  async function devtools() {
    const ws = new WebSocket(`ws://127.0.0.1:${cdpPort}/cdp`);
    await new Promise<void>((done) => ws.once('open', done));
    return ws;
  }

  it('gives the session to a VM that presents the token', async () => {
    const vm = fakeVm(vmPort, TOKEN);
    await until(() => logs.some((l) => l.includes('app attached the debug channel')));
    const ws = await devtools();
    ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }));
    await until(() => vm.lines.length > 0);
    expect(JSON.parse(vm.lines[0])).toMatchObject({ id: 1, method: 'Debugger.enable' });
    vm.socket.destroy();
    ws.terminate();
  });

  it('refuses a wrong token and a VM that never answers — and neither holds the slot', async () => {
    const wrong = fakeVm(vmPort, 'f'.repeat(32));
    const silent = fakeVm(vmPort, null);
    await until(() => wrong.isClosed());
    expect(logs.some((l) => l.includes("did not present this session's debug token"))).toBe(true);

    // while the silent impostor is still pending, the real app gets in
    const real = fakeVm(vmPort, TOKEN);
    await until(() => logs.some((l) => l.includes('app attached the debug channel')));
    await until(() => silent.isClosed());
    expect(logs.some((l) => l.includes('no answer to the token challenge'))).toBe(true);

    // and DevTools talks to the real one only
    const ws = await devtools();
    ws.send(JSON.stringify({ id: 7, method: 'Runtime.enable' }));
    await until(() => real.lines.length > 0);
    expect(JSON.parse(real.lines[0])).toMatchObject({ id: 7 });
    expect(wrong.lines).toEqual([]);
    expect(silent.lines).toEqual([]);
    real.socket.destroy();
    ws.terminate();
  });

  it('forwards nothing a pending VM says to DevTools', async () => {
    const ws = await devtools();
    const seen: string[] = [];
    ws.on('message', (raw) => seen.push(String(raw)));
    const impostor = fakeVm(vmPort, null);
    await new Promise<void>((done) => impostor.socket.once('connect', () => done()));
    impostor.socket.write('{"method":"Debugger.paused","params":{"reason":"fake"}}\n');
    await until(() => impostor.isClosed());
    expect(seen).toEqual([]);
    ws.terminate();
  });
});

describe('without a token (fjsrun, older callers)', () => {
  it('lets any VM attach, as before', async () => {
    const cdpPort = await freePort();
    const vmPort = await freePort();
    const logs: string[] = [];
    const relay = await startCdpRelay({
      cdpPort,
      vmPort,
      vmHost: '127.0.0.1',
      trustLoopback: false,
      log: (l) => logs.push(l),
    });
    const vm = connect(vmPort, '127.0.0.1');
    await until(() => logs.some((l) => l.includes('app attached the debug channel')));
    vm.destroy();
    await relay.close();
  });
});
