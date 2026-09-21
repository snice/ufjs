// Shared plumbing for tools that talk to a running `fjs dev` — `fjs log`,
// `fjs eval` and `fjs debug` all connect as tools and let the server relay.
// Extracted from inspect.ts when `fjs debug` needed the same handshake.
import { WebSocket } from 'ws';

export interface DevToolOptions {
  port: number;
  host: string;
}

export function devServerUrl(opts: DevToolOptions): string {
  return `ws://${opts.host}:${opts.port}/ws`;
}

export function connectDevServer(opts: DevToolOptions): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(devServerUrl(opts));
    socket.once('open', () => resolve(socket));
    socket.once('error', () => {
      reject(
        new Error(
          `cannot reach a dev server at ${devServerUrl(opts)}\n` +
            '  start one with `fjs dev` (or `fjs run android|ios`), or pass --port',
        ),
      );
    });
  });
}

/** Announces this connection as a tool, so the server never pushes app
 * traffic — a stray "reload" — at it, and answers with how many apps are
 * listening. */
export function handshakeTool(socket: WebSocket): Promise<{ apps: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('the dev server did not answer — is it an older fjs?'));
    }, 3000);
    socket.on('message', function hello(raw) {
      const msg = parseJsonMessage(raw.toString());
      if (msg?.fjs !== 'hello') return;
      clearTimeout(timer);
      socket.off('message', hello);
      resolve({ apps: Number(msg.apps ?? 0) });
    });
    socket.send(JSON.stringify({ fjs: 'tool' }));
  });
}

export function parseJsonMessage(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface DevToolCommonOptions extends DevToolOptions {}

export function parseDevToolArgs(argv: string[]): {
  opts: DevToolOptions;
  rest: string[];
} {
  const opts: DevToolOptions = { port: 38900, host: '127.0.0.1' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value)) throw new Error('--port needs a number');
      opts.port = value;
    } else if (arg === '--host') {
      const value = argv[++i];
      if (!value) throw new Error('--host needs a value');
      opts.host = value;
    } else rest.push(arg);
  }
  return { opts, rest };
}
