// fjs debug — attach Chrome DevTools to the JS VM running on the device.
//
//   fjs debug
//   fjs debug --cdp-port 38902 --vm-port 38903
//
// Starts the CDP relay (src/debug/cdp-server.ts) and prints how to open
// Chrome DevTools. It also stays connected to `fjs dev` as a tool (same
// handshake as `fjs log`) and registers the relay there, so the server
// pushes `debug on <vm-port>` at every app — including apps that connect
// later, which is the normal case while `fjs run ios` is still building. The engine (vendored PrimJS, spec
// 088) implements CDP itself; this command is transport plus discovery.
// The relay is standalone: a desktop VM can dial it directly via
// `fjsrun --debug-connect 127.0.0.1:<vm-port>` with no dev server at all.
//
// Ctrl-C detaches and exits.
import { spawnSync } from 'node:child_process';
import {
  keepDevServerLinked,
  parseDevToolArgs,
  parseJsonMessage,
  type DevToolOptions,
} from '../dev/tool-conn.js';
import { adbDevices, resolveAdb } from '../dev/adb.js';
import { startCdpRelay } from '../debug/cdp-server.js';
import { resolveJsEngine } from '../project/engine.js';

interface DebugOptions extends DevToolOptions {
  cdpPort: number;
  vmPort: number;
}

export async function debugCommand(argv: string[]): Promise<void> {
  const { opts: base, rest } = parseDevToolArgs(argv);
  const opts: DebugOptions = { ...base, cdpPort: 38902, vmPort: 38903 };
  // spec 091: the CDP inspector only exists in the primjs flavor. The env
  // var is the same source `fjs run` uses, so a quickjs session warns before
  // anyone wonders why chrome://inspect never lists the app.
  if (resolveJsEngine() === 'quickjs') {
    console.warn(
      'fjs debug: FJS_JS_ENGINE=quickjs — the quickjs-ng engine has no CDP ' +
        'inspector, so breakpoints/Elements/Network cannot attach. Run the ' +
        'primjs flavor (`fjs run --js-engine primjs`) to debug.',
    );
  }
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

  // OPTIONAL accelerator, not a requirement: publish the VM channel on every
  // adb device as a reverse tunnel, so the app's first dial candidate
  // (127.0.0.1:<vmPort> on itself) connects instantly and USB devices with
  // no Wi-Fi route work at all. The direct dial against the dev-server host
  // is the primary path and needs no adb — a machine without it simply gets
  // no tunnel here. Resolved from PATH plus the default SDK locations; synced
  // every few seconds so a device started after `fjs debug` gets covered;
  // teardown is best effort — a stale tunnel just refuses at dial time.
  const adb = resolveAdb();
  const reversed = new Set<string>();
  const syncReverse = (announce: boolean) => {
    if (!adb) return;
    for (const serial of adbDevices()) {
      const r = spawnSync(
        adb,
        ['-s', serial, 'reverse', `tcp:${opts.vmPort}`, `tcp:${opts.vmPort}`],
        { stdio: 'ignore' },
      );
      if (r.status === 0 && !reversed.has(serial)) {
        reversed.add(serial);
        if (announce) {
          console.log(
            `[fjs debug] adb reverse tcp:${opts.vmPort} on ${serial} — ` +
              `the app reaches the channel at 127.0.0.1:${opts.vmPort}`,
          );
        }
      }
    }
  };
  syncReverse(true);
  const reverseTimer = setInterval(() => syncReverse(false), 5000);
  reverseTimer.unref?.();
  const removeReverse = () => {
    clearInterval(reverseTimer);
    if (!adb) return;
    for (const serial of reversed) {
      spawnSync(
        adb,
        ['-s', serial, 'reverse', '--remove', `tcp:${opts.vmPort}`],
        { stdio: 'ignore' },
      );
    }
  };

  // The link is kept up for the whole session: `fjs run ios` restarts the
  // dev server under us, and a relay that stopped announcing itself is a
  // debugger that silently never attaches.
  const link = keepDevServerLinked(opts, {
    onLink: (socket, hello) => {
      // The server remembers this and greets apps as they connect, so one
      // announce per link covers apps that are not up yet.
      socket.send(
        JSON.stringify({ fjs: 'debug-relay', on: true, port: opts.vmPort }),
      );
      if (hello.apps === 0) {
        console.log(
          '[fjs debug] no app on the dev server yet — it gets the attach ' +
            'push as soon as it connects',
        );
      }
      // The server broadcasts the app log stream to every tool (the same
      // lines `fjs log` shows). Most of it is Dart-side progress the engine
      // never sees — synthesize console events so DevTools' Console panel
      // shows what the terminal shows (spec 092).
      socket.on('message', (raw) => {
        const msg = parseJsonMessage(String(raw));
        if (msg?.fjs !== 'log') return;
        relay.consoleLine(Number(msg.level ?? 1), String(msg.text ?? ''));
      });
    },
    onDrop: () => {
      console.log(
        `[fjs debug] no dev server at ${opts.host}:${opts.port} — retrying; ` +
          `for a desktop VM run:  fjsrun --debug-connect 127.0.0.1:${opts.vmPort} <script.js>`,
      );
    },
  });

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
      link.socket?.send(JSON.stringify({ fjs: 'debug-relay', on: false }));
    } catch {
      // dev server gone; nothing to detach
    }
    removeReverse();
    link.stop();
    void relay.close().then(() => process.exit(0));
  };
  process.on('SIGINT', detach);
  process.on('SIGTERM', detach);

  // resolves only on Ctrl-C
  await new Promise<void>(() => {});
}
