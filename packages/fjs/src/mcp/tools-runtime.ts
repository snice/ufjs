// Runtime tools for `fjs mcp` (specs/213): dev_status, get_logs, eval,
// dump_tree — all through the same tool channel `fjs log` / `fjs eval` use
// (dev/tool-conn.ts), because `fjs dev` already holds a socket to every
// connected app. Every failure says what to start; an empty answer is never
// dressed up as success (constitution V).
import { WebSocket } from 'ws';
import {
  connectDevServer,
  handshakeTool,
  parseJsonMessage,
  type DevToolOptions,
} from '../dev/tool-conn.js';
import { evalViaSocket } from '../commands/inspect.js';
import type { McpTool } from './server.js';

function devOpts(args: Record<string, unknown>): DevToolOptions {
  return {
    host: typeof args.host === 'string' && args.host ? args.host : '127.0.0.1',
    port: Number.isFinite(Number(args.port)) ? Number(args.port) : 38900,
  };
}

const NO_APP = (url: string): Error =>
  new Error(
    `no app connected to ${url} — start one with fjs run android|ios, ` +
      'open the web build (fjs dev --web), or connect fjs-go',
  );

async function withSocket<T>(
  opts: DevToolOptions,
  fn: (socket: WebSocket, apps: number) => Promise<T>,
): Promise<T> {
  const socket = await connectDevServer(opts);
  try {
    const hello = await handshakeTool(socket);
    if (hello.apps === 0) throw NO_APP(`ws://${opts.host}:${opts.port}/ws`);
    return await fn(socket, hello.apps);
  } finally {
    socket.close();
  }
}

async function devStatus(args: Record<string, unknown>): Promise<string> {
  const opts = devOpts(args);
  const httpUrl = `http://${opts.host}:${opts.port}/manifest.json`;
  // The WS handshake is the authoritative probe: it answers in both the
  // app mode and `fjs dev --web` (which serves Vite and has no
  // /manifest.json). The manifest fetch is enrichment only — a 404 there
  // must not read as "no server".
  let apps = -1;
  let wsError = '';
  try {
    const socket = await connectDevServer(opts);
    try {
      apps = (await handshakeTool(socket)).apps;
    } finally {
      socket.close();
    }
  } catch (e) {
    wsError = e instanceof Error ? e.message : String(e);
  }
  let project = '';
  try {
    const response = await fetch(httpUrl, { signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const manifest = (await response.json()) as { name?: string };
      if (typeof manifest.name === 'string') project = manifest.name;
    }
  } catch {
    // app-mode only; ignore for --web
  }
  if (apps === -1) {
    throw new Error(
      `no dev server reachable at ws://${opts.host}:${opts.port}/ws (${wsError}) — ` +
        'start one with `fjs dev` in the project (or pass port)',
    );
  }
  const lines = [
    `dev server: up at ws://${opts.host}:${opts.port}/ws`,
    project ? `project: ${project}` : null,
    `apps connected: ${apps}`,
    apps === 0 ? 'no app yet — fjs run android|ios, fjs-go, the --web build in a browser' : null,
  ].filter(Boolean);
  return lines.join('\n');
}

interface LogLine {
  level: number;
  text: string;
}

/** Collects console output for a bounded window. The dev server does not
 * buffer past messages for tools, so "since" semantics don't exist — the
 * honest shape is "listen for a moment and report what arrives". */
async function getLogs(args: Record<string, unknown>): Promise<string> {
  const opts = devOpts(args);
  const durationMs = Math.max(200, Math.min(Number(args.durationMs ?? 1500), 10_000));
  const minLevel = Number.isFinite(Number(args.minLevel)) ? Number(args.minLevel) : 0;
  const names = ['debug', 'info', 'warn', 'error'];
  return withSocket(opts, (socket) =>
    new Promise<string>((resolve) => {
      const lines: LogLine[] = [];
      socket.on('message', (raw) => {
        const msg = parseJsonMessage(String(raw));
        if (msg?.fjs !== 'log') return;
        const level = Number(msg.level ?? 1);
        if (level < minLevel) return;
        lines.push({ level, text: String(msg.text ?? '') });
      });
      const timer = setTimeout(() => {
        socket.close();
        if (!lines.length) {
          resolve(
            `no output at level ≥ ${names[minLevel] ?? minLevel} in ${durationMs}ms — ` +
              'the app is idle. Interact with it, or raise durationMs.',
          );
          return;
        }
        const body = lines
          .slice(-200)
          .map((line) => `${names[line.level] ?? 'info'}: ${line.text}`)
          .join('\n');
        resolve(
          `${lines.length} line(s) in ${durationMs}ms (showing last ${Math.min(lines.length, 200)}):\n${body}`,
        );
      }, durationMs);
      timer.unref?.();
    }),
  );
}

async function evalTool(args: Record<string, unknown>): Promise<string> {
  const opts = devOpts(args);
  const expression = String(args.expression ?? '');
  if (!expression.trim()) throw new Error('eval needs { expression: "1 + 1" }');
  const timeout = Math.max(500, Math.min(Number(args.timeoutMs ?? 5000), 30_000));
  return withSocket(opts, (socket) => evalViaSocket(socket, expression, timeout));
}

interface DevtoolsNode {
  id: number;
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  children: DevtoolsNode[];
}

function formatTree(roots: DevtoolsNode[], maxLines: number): string {
  const lines: string[] = [];
  const walk = (node: DevtoolsNode, depth: number): void => {
    if (lines.length >= maxLines) return;
    const indent = '  '.repeat(depth);
    const attrs = Object.entries(node.attrs)
      .slice(0, 4)
      .map(([key, value]) => `${key}="${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`)
      .join(' ');
    const text =
      node.text !== undefined && node.text.length > 0
        ? ` ${JSON.stringify(node.text.length > 60 ? `${node.text.slice(0, 60)}…` : node.text)}`
        : '';
    lines.push(`${indent}<${node.tag}#${node.id}${attrs ? ` ${attrs}` : ''}>${text}`);
    for (const child of node.children) walk(child, depth + 1);
    if (lines.length >= maxLines && node.children.length) {
      lines.push(`${indent}  … (output capped at ${maxLines} lines)`);
    }
  };
  for (const root of roots) walk(root, 0);
  return lines.join('\n');
}

async function dumpTree(args: Record<string, unknown>): Promise<string> {
  const opts = devOpts(args);
  return withSocket(opts, async (socket) => {
    const kind = await evalViaSocket(socket, 'typeof __fjsDevtools', 5000).catch(() => 'error');
    if (kind !== 'object') {
      throw new Error(
        '__fjsDevtools is not in this build (typeof === ' +
          kind +
          '). The devtools data plane ships in app-mode fjs dev and `fjs build --devtools`; ' +
          'web builds never include it (the browser has its own DevTools — inspect there, ' +
          'or use eval on this channel).',
      );
    }
    const raw = await evalViaSocket(
      socket,
      "__fjsDevtools.cmd('DOM.getDocument')",
      Math.max(500, Math.min(Number(args.timeoutMs ?? 10_000), 30_000)),
    );
    let doc: { roots?: DevtoolsNode[] };
    try {
      doc = JSON.parse(raw) as { roots?: DevtoolsNode[] };
    } catch {
      throw new Error(`dump_tree: devtools returned a non-JSON answer: ${raw.slice(0, 200)}`);
    }
    const roots = doc.roots ?? [];
    if (!roots.length) {
      throw new Error(
        'dump_tree: the element tree is empty — is a page mounted? Navigate in the app and retry.',
      );
    }
    const maxLines = Math.max(50, Math.min(Number(args.maxLines ?? 400), 2000));
    return formatTree(roots, maxLines);
  });
}

export const RUNTIME_TOOLS: McpTool[] = [
  {
    name: 'dev_status',
    description:
      'Is the fjs dev server up, which project, how many apps are connected. ' +
      'Call this before the other runtime tools.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'dev server port (default 38900)' },
        host: { type: 'string', description: 'dev server host (default 127.0.0.1)' },
      },
      additionalProperties: false,
    },
    run: async (args) => devStatus(args),
  },
  {
    name: 'get_logs',
    description:
      'Collect app console output for a short window (the dev server does not buffer ' +
      'past tool messages, so this listens for durationMs and returns what arrives).',
    inputSchema: {
      type: 'object',
      properties: {
        durationMs: { type: 'number', description: 'listen window, 200–10000 (default 1500)' },
        minLevel: { type: 'number', description: '0 debug, 1 info, 2 warn, 3 error (default 0)' },
        port: { type: 'number' },
        host: { type: 'string' },
      },
      additionalProperties: false,
    },
    run: async (args) => getLogs(args),
  },
  {
    name: 'eval',
    description:
      'Evaluate an expression in the running app VM (same channel as `fjs eval`). ' +
      'Answers render like the console: strings as-is, objects as JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'e.g. "1 + 1" or "globalThis.__fjsPages?.length"' },
        timeoutMs: { type: 'number', description: 'default 5000' },
        port: { type: 'number' },
        host: { type: 'string' },
      },
      required: ['expression'],
      additionalProperties: false,
    },
    run: async (args) => evalTool(args),
  },
  {
    name: 'dump_tree',
    description:
      'Dump the current element tree of the running app as indented text ' +
      '(via the devtools data plane, DOM.getDocument). The ground truth for "what did my page actually render".',
    inputSchema: {
      type: 'object',
      properties: {
        maxLines: { type: 'number', description: 'output cap, 50–2000 (default 400)' },
        timeoutMs: { type: 'number', description: 'default 10000' },
        port: { type: 'number' },
        host: { type: 'string' },
      },
      additionalProperties: false,
    },
    run: async (args) => dumpTree(args),
  },
];
