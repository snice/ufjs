// Runtime tools against a stub dev server (specs/213). The stub speaks the
// real tool protocol — `{"fjs":"tool"}` handshake, eval answers riding the
// log stream under EVAL_MARK — because the point is exactly that the MCP
// tools and `fjs log`/`fjs eval` share one channel, with no second protocol
// to drift. Without a server, every tool must fail with the thing to start,
// never an empty success (constitution V).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { EVAL_MARK } from '../src/commands/inspect.js';
import { RUNTIME_TOOLS } from '../src/mcp/tools-runtime.js';

function tool(name: string) {
  const found = RUNTIME_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`runtime tool ${name} not registered`);
  return found;
}

let httpServer: Server;
let wss: WebSocketServer;
let port = 0;
/** Per-connection eval responder, overridden by individual tests. */
let answerEval: (source: string) => string = () => 'ok:stubbed';

beforeAll(async () => {
  httpServer = http.createServer((req, res) => {
    if (req.url === '/manifest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'stub-app', entry: 'src/main.ts' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (socket: WsSocket) => {
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { fjs?: string; id?: string; source?: string };
      if (msg.fjs === 'tool') {
        socket.send(JSON.stringify({ fjs: 'hello', apps: 1 }));
        // Log lines arrive AFTER the handshake settles, like a real app —
        // a client attaching its listener in the same tick as 'hello' must
        // still catch them.
        setTimeout(() => {
          socket.send(JSON.stringify({ fjs: 'log', level: 2, text: 'stub warning line' }));
          socket.send(JSON.stringify({ fjs: 'log', level: 1, text: 'stub info line' }));
        }, 50);
        return;
      }
      if (msg.fjs === 'eval' && msg.id) {
        socket.send(
          JSON.stringify({ fjs: 'log', level: 1, text: `${EVAL_MARK}${msg.id}:${answerEval(msg.source ?? '')}` }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  port = (httpServer.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  wss.close();
});

describe('runtime tools vs the stub dev server', () => {
  it('dev_status reports the project and the connected app count', async () => {
    const text = await tool('dev_status').run({ port });
    expect(text).toContain('dev server: up');
    expect(text).toContain('stub-app');
    expect(text).toContain('apps connected: 1');
  });

  it('get_logs catches the console stream in its window', async () => {
    const text = await tool('get_logs').run({ port, durationMs: 400 });
    expect(text).toContain('stub warning line');
    expect(text).toContain('warn: stub warning line');
  });

  it('get_logs minLevel filters; an idle window reports honestly', async () => {
    const quiet = await tool('get_logs').run({ port, durationMs: 300, minLevel: 3 });
    expect(quiet).toContain('no output at level ≥ error');
  });

  it('eval rides the log-stream answer channel', async () => {
    answerEval = (source) =>
      source.includes('6 * 7') ? 'ok:42' : 'err:not the answer';
    expect(await tool('eval').run({ port, expression: '6 * 7' })).toBe('42');
    await expect(tool('eval').run({ port, expression: 'wrong()' })).rejects.toThrow(
      'not the answer',
    );
  });

  it('dump_tree refuses cleanly when the devtools plane is absent', async () => {
    answerEval = () => 'ok:undefined';
    await expect(tool('dump_tree').run({ port })).rejects.toThrow(/__fjsDevtools.*fjs dev/s);
  });

  it('dump_tree formats the DOM.getDocument shape', async () => {
    answerEval = (source) => {
      if (source.includes('typeof __fjsDevtools')) return 'ok:object';
      return (
        'ok:' +
        JSON.stringify({
          roots: [
            {
              id: 1,
              tag: 'page',
              attrs: { class: 'root' },
              children: [{ id: 2, tag: 'text', attrs: {}, text: 'hello world', children: [] }],
            },
          ],
        })
      );
    };
    const text = await tool('dump_tree').run({ port });
    expect(text).toContain('<page#1 class="root">');
    expect(text).toContain('<text#2> "hello world"');
  });
});

describe('runtime tools with nothing running', () => {
  it('eval on a dead port says what to start', async () => {
    await expect(tool('eval').run({ port: 1, expression: '1' })).rejects.toThrow(/start one/);
  });

  it('dev_status on a dead port names the URL and the fix', async () => {
    await expect(tool('dev_status').run({ port: 1 })).rejects.toThrow('fjs dev');
  });
});

describe('evalViaSocket listener hygiene', () => {
  it('removes its message listener after answering, so repeat evals do not leak', async () => {
    // dump_tree evaluates twice on one socket; a leaked per-call listener
    // would grow every round and slow the second answer. Prove the count
    // returns to its baseline.
    answerEval = (source) => (source.includes('typeof') ? 'ok:object' : 'ok:{"roots":[]}');
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ fjs: 'tool' }));
    await new Promise<void>((resolve) =>
      socket.once('message', (raw) => {
        if (String(raw).includes('hello')) resolve();
      }),
    );
    const { evalViaSocket } = await import('../src/commands/inspect.js');
    const baseline = socket.listenerCount('message');
    await evalViaSocket(socket, 'typeof __fjsDevtools');
    await evalViaSocket(socket, "1");
    expect(socket.listenerCount('message')).toBe(baseline);
    socket.close();
  });
});
