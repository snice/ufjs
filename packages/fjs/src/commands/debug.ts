// fjs debug — attach Chrome DevTools to the JS VM running on the device.
//
//   fjs debug
//   fjs debug --port 38902 --vm-port 38903
//
// Starts the CDP relay (src/debug/cdp-server.ts) and prints how to open
// Chrome DevTools. When a `fjs dev` server is reachable, it also connects
// as a tool (same handshake as `fjs log`) and asks the server to push
// `debug on <vm-port>` at every app. The engine (vendored PrimJS, spec
// 088) implements CDP itself; this command is transport plus discovery.
// The relay is standalone: a desktop VM can dial it directly via
// `fjsrun --debug-connect 127.0.0.1:<vm-port>` with no dev server at all.
//
// Ctrl-C detaches and exits.
import {
  connectDevServer,
  handshakeTool,
  parseDevToolArgs,
  type DevToolOptions,
} from '../dev/tool-conn.js';
import { startCdpRelay } from '../debug/cdp-server.js';

interface DebugOptions extends DevToolOptions {
  cdpPort: number;
  vmPort: number;
}

export async function debugCommand(argv: string[]): Promise<void> {
  const { opts: base, rest } = parseDevToolArgs(argv);
  const opts: DebugOptions = { ...base, cdpPort: 38902, vmPort: 38903 };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    // NOT --port: parseDevToolArgs already claimed that one for the dev
    // server this command talks to, so it never reaches here.
    if (arg === '--cdp-port') {
      const value = Number(rest[++i]);
      if (!Number.isInteger(value)) throw new Error('--cdp-port needs a number');
      opts.cdpPort = value;
    } else if (arg === '--vm-port') {
      const value = Number(rest[++i]);
      if (!Number.isInteger(value)) throw new Error('--vm-port needs a number');
      opts.vmPort = value;
    } else throw new Error(`unknown debug option: ${arg}`);
  }

  // The relay is self-sufficient: the app side dials IT. The dev server is
  // only the hint channel that tells a connected app which port to dial —
  // nice to have, not required (`fjsrun --debug-connect` skips it).
  const relay = await startCdpRelay({
    cdpPort: opts.cdpPort,
    vmPort: opts.vmPort,
    log: (line) => console.log(`[fjs debug] ${line}`),
  });

  let dev: import('ws').WebSocket | null = null;
  try {
    dev = await connectDevServer(opts);
    const hello = await handshakeTool(dev);
    if (hello.apps > 0) {
      // The dev server relays this at every app as `debug on <port>`; each
      // app then dials vmPort itself (the relay accepts exactly one).
      dev.send(
        JSON.stringify({ fjs: 'debug-relay', on: true, port: opts.vmPort }),
      );
    } else {
      console.log(
        `[fjs debug] no app on the dev server yet — the attach push goes ` +
          'out to apps as they connect',
      );
    }
    dev.on('message', (raw) => {
      const msg = (() => {
        try {
          return JSON.parse(String(raw)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })();
      if (msg?.fjs === 'hello' && dev) {
        dev.send(
          JSON.stringify({ fjs: 'debug-relay', on: true, port: opts.vmPort }),
        );
      }
    });
    dev.on('close', () => {
      console.log('[fjs debug] dev server closed the connection — the relay ' +
        'stays up for apps that dial it directly');
      dev = null;
    });
  } catch {
    console.log(
      `[fjs debug] no dev server at ${opts.host}:${opts.port} — for a ` +
        `desktop VM, run:  fjsrun --debug-connect 127.0.0.1:${opts.vmPort} <script.js>`,
    );
  }

  console.log('fjs debug — Chrome DevTools for the fjs VM (spec 088)');
  console.log('');
  // Not chrome://inspect: its discovery leaves you staring at an empty list
  // with no error when anything is off (localhost resolving to ::1 while the
  // relay binds IPv4 loopback is only the first trap). Pointing the frontend
  // straight at the socket skips discovery entirely. devtools:// cannot be
  // pasted into the omnibox, so hand it to the browser as an argument.
  console.log('  open DevTools straight on the relay (copy-paste):');
  console.log('');
  console.log(`    open -a "Google Chrome" \\`);
  console.log(
    `      "devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${opts.cdpPort}/cdp"`,
  );
  console.log('');
  console.log('  then: Sources → pick a script → click a line number');
  console.log('');
  console.log('  breakpoints pause the app until you resume — that is the');
  console.log('  debugger, not a hang. Console output arrives in DevTools.');
  console.log('');
  console.log(relay.banner(0));
  console.log('');

  const detach = () => {
    try {
      dev?.send(JSON.stringify({ fjs: 'debug-relay', on: false }));
    } catch {
      // dev server gone; nothing to detach
    }
    void relay.close().then(() => process.exit(0));
  };
  process.on('SIGINT', detach);
  process.on('SIGTERM', detach);

  // resolves only on Ctrl-C
  await new Promise<void>(() => {});
}
