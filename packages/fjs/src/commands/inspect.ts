// fjs log / fjs eval — talk to the JS engine running on the device.
//
// Both go through the dev server rather than the device: `fjs dev` already
// holds a socket to every connected app, so a tool only has to say who it
// is (`{"fjs":"tool"}`) and the server relays. Nothing new is opened on the
// phone, and it works the same for an emulator, a physical device over the
// LAN, and the browser build.
//
//   fjs log            console output from the app, as it happens
//   fjs eval '1 + 1'   evaluate an expression in the running VM
import { colorSupported } from '../dev/qrcode.js';
import {
  connectDevServer as connect,
  handshakeTool as handshake,
  parseDevToolArgs as parseCommon,
  parseJsonMessage,
  type DevToolOptions as Options,
} from '../dev/tool-conn.js';

/** Marks an eval answer inside the ordinary log stream, so getting a value
 * back needs no second message type — and no new native call. The NUL
 * prefix keeps it out of `fjs log`'s output and out of anything a real
 * console.log would produce. */
const EVAL_MARK = '\u0000fjs-eval:';

export async function logCommand(argv: string[]): Promise<void> {
  const { opts, rest } = parseCommon(argv);
  for (const arg of rest) throw new Error(`unknown log option: ${arg}`);

  const color = colorSupported();
  const socket = await connect(opts);
  const hello = await handshake(socket);
  console.log(
    `fjs log — ${url(opts)}, ${hello.apps} app${hello.apps === 1 ? '' : 's'} connected`,
  );
  if (hello.apps === 0) {
    console.log(dim('(nothing connected yet; lines appear as soon as an app is)', color));
  }

  socket.on('message', (raw) => {
    const msg = parseJsonMessage(raw.toString());
    if (msg?.fjs !== 'log') return;
    const text = String(msg.text ?? '');
    if (text.startsWith(EVAL_MARK)) return; // another tool's answer
    console.log(`${logLevelLabel(Number(msg.level ?? 1), color)} ${text}`);
  });
  socket.on('close', () => {
    console.log('dev server closed the connection');
    process.exit(1);
  });
  // resolves only on Ctrl-C
  await new Promise<void>(() => {});
}

export async function evalCommand(argv: string[]): Promise<void> {
  const { opts, rest } = parseCommon(argv);
  let expression: string | undefined;
  let timeout = 5000;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--timeout') {
      const value = Number(rest[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--timeout needs milliseconds');
      timeout = value;
    } else if (expression === undefined) expression = arg;
    else throw new Error(`unknown eval option: ${arg}`);
  }
  if (!expression) {
    throw new Error("fjs eval needs an expression: fjs eval 'Object.keys(globalThis)'");
  }

  const socket = await connect(opts);
  const hello = await handshake(socket);
  if (hello.apps === 0) {
    socket.close();
    throw new Error(
      `no app connected to ${url(opts)} — start one with fjs run android|ios, ` +
        'or open the web build',
    );
  }

  const id = Math.random().toString(36).slice(2, 8);
  const answer = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`no answer in ${timeout}ms — the app may be busy or not listening`));
    }, timeout);
    socket.on('message', (raw) => {
      const msg = parseJsonMessage(raw.toString());
      if (msg?.fjs !== 'log') return;
      const text = String(msg.text ?? '');
      if (!text.startsWith(`${EVAL_MARK}${id}:`)) return;
      clearTimeout(timer);
      const body = text.slice(EVAL_MARK.length + id.length + 1);
      if (body.startsWith('err:')) reject(new Error(body.slice(4)));
      else resolve(body.slice(3));
    });
  });

  socket.send(JSON.stringify({ fjs: 'eval', id, source: wrap(id, expression) }));
  try {
    console.log(await answer);
  } finally {
    socket.close();
  }
}

/** The expression runs in the VM as written; only the answer is wrapped.
 * Values come back as JSON, the one encoding both sides already agree on. */
export function wrap(id: string, expression: string): string {
  return (
    `try{var __fjsv=(${expression});` +
    `console.log(${JSON.stringify(EVAL_MARK + id + ':ok:')}+` +
    `(function(v){` +
    `if(typeof v==='string')return v;` +
    `if(typeof v==='undefined')return 'undefined';` +
    `if(typeof v==='function')return String(v);` +
    `try{var s=JSON.stringify(v);return s===undefined?String(v):s;}catch(e){return String(v);}` +
    `})(__fjsv))}` +
    `catch(e){console.log(${JSON.stringify(EVAL_MARK + id + ':err:')}+` +
    `(e&&e.message?e.message:String(e)))}`
  );
}

// ------------------------------------------------------------- plumbing

function url(opts: Options): string {
  return `ws://${opts.host}:${opts.port}/ws`;
}

/** The engine's levels are the console methods that produced them:
 * 0 debug, 1 log/info, 2 warn, 3 error (FJS_LOG_* in native/include/fjs.h).
 * Names, not numbers — a number in the margin is one more thing to look up
 * while reading a log. */
const LEVELS = ['debug', 'info', 'warn', 'error'];

/** Shared with `fjs dev`, whose `l` shortcut prints the same stream in the
 * server's own terminal — one log line should look the same either way. */
export function logLevelLabel(value: number, color: boolean): string {
  const name = (LEVELS[value] ?? 'info').padStart(5);
  if (!color) return name;
  if (value >= 3) return `\x1B[31m${name}\x1B[0m`;
  if (value === 2) return `\x1B[33m${name}\x1B[0m`;
  return `\x1B[2m${name}\x1B[0m`;
}

function dim(value: string, color: boolean): string {
  return color ? `\x1B[2m${value}\x1B[0m` : value;
}
