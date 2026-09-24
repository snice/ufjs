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

/** The dev server refused this connection as a tool (spec 107: tools must
 * run on the dev machine unless it was started with --remote-tools).
 * Retrying cannot change that, so a reconnect loop stops on it. */
export class DevToolDeniedError extends Error {}

export interface DevServerLink {
  /** Stop reconnecting and drop the current socket, if any. */
  stop(): void;
  /** The live socket, or null while disconnected. */
  readonly socket: WebSocket | null;
}

/** Keeps a tool connection to `fjs dev` alive across dev server restarts.
 *
 * `fjs debug` outlives the server it talks to: `fjs run ios` restarts the
 * dev server, the user restarts `fjs dev`, or the relay is started first
 * and the server comes up later. A one-shot connect leaves the relay
 * running with nothing to tell the app, which looks exactly like a broken
 * debugger — so reconnect instead, and re-announce on every link.
 *
 * `onLink` runs after the tool handshake; `onDrop` runs once per
 * disconnected streak, not once per retry. */
export function keepDevServerLinked(
  opts: DevToolOptions,
  handlers: {
    onLink: (socket: WebSocket, hello: { apps: number }) => void;
    onDrop?: () => void;
    /** The server refused us as a tool; reconnecting stops. Default: print
     * the reason. */
    onDenied?: (error: DevToolDeniedError) => void;
  },
  retryMs = 1000,
): DevServerLink {
  let stopped = false;
  let current: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dropReported = false;

  const drop = (): void => {
    current = null;
    if (!dropReported) {
      dropReported = true;
      handlers.onDrop?.();
    }
    retry();
  };

  const retry = (): void => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void attempt();
    }, retryMs);
    timer.unref?.();
  };

  const attempt = async (): Promise<void> => {
    if (stopped) return;
    let socket: WebSocket;
    try {
      socket = await connectDevServer(opts);
      const hello = await handshakeTool(socket);
      if (stopped) {
        socket.close();
        return;
      }
      current = socket;
      dropReported = false;
      handlers.onLink(socket, hello);
    } catch (e) {
      if (e instanceof DevToolDeniedError) {
        stopped = true;
        if (handlers.onDenied) handlers.onDenied(e);
        else console.error(`fjs: ${e.message}`);
        return;
      }
      drop();
      return;
    }
    socket.on('close', () => {
      if (current === socket) drop();
    });
    // 'error' always precedes 'close' on a broken socket; swallowing it
    // here keeps ws from throwing it at the process
    socket.on('error', () => {});
  };

  void attempt();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const socket = current;
      current = null;
      socket?.close();
    },
    get socket() {
      return current;
    },
  };
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
      if (msg?.fjs === 'denied') {
        clearTimeout(timer);
        socket.off('message', hello);
        reject(
          new DevToolDeniedError(
            `the dev server refused this tool: ${String(msg.reason ?? 'not allowed')}`,
          ),
        );
        return;
      }
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
