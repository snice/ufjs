import { mpDev } from '../mp/dev.js';
// fjs dev — HTTP bundle server + WebSocket change notifications.
//
// Three shapes, matching `fjs build`:
//   default   GET /bundle.js rebuilds a single self-contained bundle
//   --pages   GET /shared.js (prelude), /bundle.js (app entry) and
//             /pages/<id>.js (one per route); /manifest.json says `split`
//             so fjs go knows to register the prelude first. A client that
//             asks (`/manifest.json?units=1`) additionally gets the dev
//             unit build (spec 037): /units.js, /units/<id>.js and
//             /pages/<id>.deps.json, with module-level hot reload pushes.
//   --web     builds the browser app and serves it as a static site
// WS /ws pushes "reload" on change in every shape.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import {
  buildBundle,
  parseBuildArgs,
  webTitle,
  type BuildOptions,
  type BuildResult,
  type DevUnitsInfo,
} from '../bundler/build.js';
import { pagesFor, ROUTE_TYPES_FILE, writeRouteTypes } from '../project/pages.js';
import { ASSET_TYPES_FILE, writeAssetTypes } from '../project/assets.js';
import { WORKERS_DIR, bundleWorker, workerFileForUrl } from '../project/workers.js';
import {
  MODULE_COMPONENT_TYPES_FILE,
  MODULE_TYPES_FILE,
  moduleDataDir,
  runModulePrepare,
  scanModules,
  writeModuleTypes,
} from '../project/modules.js';
import { qrLines, colorSupported } from './qrcode.js';
import { startBeacon } from './discovery.js';
import { logLevelLabel } from '../commands/inspect.js';
import { startKeyboard, type KeyCommand } from './keys.js';

/** IPv4 addresses other machines on the LAN can reach (phones need one),
 * most-likely-reachable first — that one gets the QR code. */
export function lanAddresses(): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      found.push({ address: info.address, rank: rank(name, info.address) });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  return found.map((f) => f.address);
}

/** Lower sorts first. A dev machine usually has more than one non-internal
 * IPv4: VPN tunnels, VM bridges and Docker networks all look like a LAN
 * address here, and a phone on the Wi-Fi can reach none of them. */
function rank(name: string, address: string): number {
  let score = 0;
  if (/^(en|eth|wlan|wl)\d/.test(name)) score -= 2; // a real NIC
  if (/^(utun|ipsec|ppp|tun|tap|vmnet|bridge|docker|veth|awdl|llw)/.test(name)) score += 4;
  if (address.startsWith('192.168.')) score -= 1; // the usual home LAN
  return score;
}

/** Project name from package.json, falling back to the directory name. */
function projectName(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name;
  } catch {
    // no package.json (or unreadable) — the directory name is a fine label
  }
  return path.basename(root);
}

// the MIME table and the file semantics live in dev/static.ts, shared with
// `fjs preview` — what a URL means must not drift between the two servers
import { MIME, resolveStaticFile } from './static.js';

/** Live-reload client appended to the dev index.html.
 *
 * It also mirrors console output up the socket and answers `eval` pushes,
 * so `fjs log` and `fjs eval` work against the browser build exactly as
 * they do against a device. Without the eval branch this listener would
 * reload the page on an eval push — every message used to mean "reload". */
const RELOAD_SNIPPET = `
<script>
(function () {
  var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  var ws = new WebSocket(url);
  var send = function (level, text) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ fjs: 'log', level: level, text: String(text) }));
  };
  // the same mapping the engine uses natively (FJS_LOG_* in fjs.h), so a
  // level means one thing whichever side produced it
  var levels = { debug: 0, log: 1, info: 1, warn: 2, error: 3 };
  Object.keys(levels).forEach(function (name) {
    var original = console[name];
    if (!original) return;
    console[name] = function () {
      send(levels[name], Array.prototype.map.call(arguments, String).join(' '));
      return original.apply(console, arguments);
    };
  });
  ws.onmessage = function (e) {
    var msg = String(e.data);
    if (msg.indexOf('eval ') === 0) {
      var rest = msg.slice(5), space = rest.indexOf(' ');
      if (space < 0) return;
      var id = rest.slice(0, space);
      try { new Function(rest.slice(space + 1))(); }
      catch (err) { send(3, '\\u0000fjs-eval:' + id + ':err:' + (err && err.message ? err.message : err)); }
      return;
    }
    location.reload();
  };
  ws.onclose = function () { setTimeout(function () { location.reload(); }, 1500); };
})();
</script>
`;

interface Server {
  handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean>;
  banner(addresses: string[], port: number): void;
  /** Called after a debounced file change. Returns the message to push —
   * 'reload' for "start over", `reload pages:a,b` when only those page
   * chunks changed, or null when the rebuild produced nothing new. */
  onChange?(): Promise<string | null>;
  /** The `r` shortcut: throw away whatever is cached and build again, no
   * matter what changed on disk. A manual reload is what you reach for when
   * the incremental path got it wrong, so it must not do the same diffing. */
  rebuild?(): Promise<void>;
}

/** What a module's data directory is serving.
 *
 * This used to be `application/json` unconditionally, which was true while
 * the only consumer was iconmind's icons.json. It stopped being true the
 * moment a module shipped a page: a WebView handed `application/json` for an
 * HTML file renders the SOURCE, and it does it after a perfectly normal load
 * event — so nothing in the logs says anything is wrong (specs/013-web-view).
 */
export function moduleContentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.woff2':
      return 'font/woff2';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/** What one build wrote, keyed by artifact ('bundle', 'shared',
 * 'page:<chunk>'), so the next build can say which of them an edit
 * actually changed. */
type Fingerprint = Map<string, string>;

function fingerprint(result: BuildResult, root: string): Fingerprint {
  const out: Fingerprint = new Map();
  const add = (key: string, file: string | undefined) => {
    if (!file || !fs.existsSync(file)) return;
    out.set(key, crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'));
  };
  add('bundle', result.jsPath);
  add('shared', result.sharedPath);
  for (const [chunk, file] of Object.entries(result.pageChunks ?? {})) {
    add(`page:${chunk}`, file);
  }
  for (const [id, file] of Object.entries(result.devUnits?.files ?? {})) {
    add(`unit:${id}`, file);
  }
  const addModuleData = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) addModuleData(file, `${prefix}/${entry.name}`);
      else add(`module:${prefix}/${entry.name}`, file);
    }
  };
  for (const mod of scanModules(root)) {
    addModuleData(moduleDataDir(root, mod.name), mod.name.replace(/^@[^/]+\//, ''));
  }
  return out;
}

/** The push a rebuild earns.
 *
 * Page chunks are the common edit, and re-evaluating one of those in the
 * running VM is far less disruptive than restarting the program — the app
 * stays on the page the user is looking at. In units mode (spec 037) an
 * edit to a shared app module earns the middle ground: re-evaluate the
 * changed unit plus every transitive importer (dependencies first, which
 * the unit factories need since they capture imports at require time) and
 * re-evaluate the page chunks that pull them in — a chunk's bundled code
 * captured the old exports when it was evaluated, so only a fresh eval
 * makes the swap visible. Anything else (the shell, the shared runtime,
 * the route table, a unit the entry reaches) still means a full reload.
 */
export function changeMessage(
  before: Fingerprint | null,
  after: Fingerprint,
  graph?: DevUnitsInfo,
): string | null {
  if (!before) return 'reload';
  const changed: string[] = [];
  for (const [key, hash] of after) {
    if (before.get(key) !== hash) changed.push(key);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) changed.push(key); // a page went away
  }
  if (changed.length === 0) return null;
  const units = changed
    .filter((key) => key.startsWith('unit:'))
    .map((key) => key.slice('unit:'.length));
  const pages = changed.filter((key) => key.startsWith('page:'));
  if (units.length > 0 && units.length === changed.length && graph) {
    // transitive importers, dependencies first: Set insertion order is
    // BFS layer order along the importer edges
    const affected = new Set(units);
    const pageChunks = new Set<string>();
    let reachesEntry = false;
    let frontier = units;
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const unit of frontier) {
        for (const importer of graph.importers[unit] ?? []) {
          if (importer === 'bundle') {
            reachesEntry = true;
          } else if (importer.startsWith('page:')) {
            pageChunks.add(importer.slice('page:'.length));
          } else if (!affected.has(importer)) {
            affected.add(importer);
            next.push(importer);
          }
        }
      }
      frontier = next;
    }
    if (!reachesEntry) {
      const affectedUnits = [...affected];
      const pagesToken = pageChunks.size > 0 ? ` pages:${[...pageChunks].join(',')}` : '';
      return `reload units:${affectedUnits.join(',')}${pagesToken}`;
    }
    // entry-reachable: making the edit visible means re-running the entry,
    // which is a program restart anyway
  }
  if (pages.length > 0 && pages.length === changed.length) {
    return `reload pages:${pages.map((key) => key.slice('page:'.length)).join(',')}`;
  }
  return 'reload';
}

/** Shared with the server impls: whether an FS watcher is actually running,
 * which decides if build results may be cached between requests. */
interface DevState {
  watching: boolean;
}

/** dev shape, for the "another fjs dev is running" check below. */
function devMode(opts: BuildOptions): string {
  return opts.web ? 'web' : opts.pages ? 'pages' : 'bundle';
}

/** Warns when a second `fjs dev` of the same shape already serves this
 * outDir, and records this one.
 *
 * Two such servers write the same files: their builds interleave, one can
 * fail on the other's half-written output, and a failed rebuild sends no
 * reload — so the visible symptom is "the terminal compiles but the app
 * never refreshes". Only a warning: the second server may well be the one
 * the user wants, and killing it is not ours to do.
 */
function claimOutDir(opts: BuildOptions, port: number): void {
  const lock = path.join(path.resolve(opts.outDir), `.fjs-dev.${devMode(opts)}.lock`);
  try {
    const prev = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid?: number; port?: number };
    if (typeof prev.pid === 'number' && prev.pid !== process.pid && alive(prev.pid)) {
      console.warn(
        `⚠️  另一个 fjs dev（pid ${prev.pid}${prev.port ? `, 端口 ${prev.port}` : ''}）正在同一个项目上以 --${devMode(opts)} 模式运行。`,
      );
      console.warn(
        `    两个进程会同时写 ${opts.outDir}/，构建互相覆盖，热更新可能失效。先停掉它，或给这个实例换个输出目录：fjs dev --out dist-2`,
      );
    }
  } catch {
    // no lock, or an unreadable one — nothing to warn about
  }
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, port, mode: devMode(opts) }));
  } catch {
    // a read-only outDir is the build's problem to report, not ours
  }
  const release = () => {
    try {
      const held = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid?: number };
      if (held.pid === process.pid) fs.rmSync(lock, { force: true });
    } catch {
      // already gone
    }
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      release();
      process.exit(0);
    });
  }
}

/** Whether a pid is still running (a stale lock outlives its writer). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Removes `flag` from argv, reporting whether it was there. */
function takeFlag(argv: string[], flag: string): boolean {
  const i = argv.indexOf(flag);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
}

export async function devCommand(argv: string[]): Promise<void> {
  // --port <n> is dev-only: pull it out before parseBuildArgs, which would
  // otherwise take the port number for a positional entry path
  const rest = [...argv];
  let port = 38900;
  let host = '0.0.0.0';
  const pi = rest.indexOf('--port');
  if (pi >= 0) {
    const value = rest[pi + 1];
    if (value) port = Number(value);
    rest.splice(pi, value ? 2 : 1);
  }
  const hi = rest.indexOf('--host');
  if (hi >= 0) {
    const value = rest[hi + 1];
    if (value) host = value;
    rest.splice(hi, value ? 2 : 1);
  }
  const qr = !takeFlag(rest, '--no-qr');
  const discovery = !takeFlag(rest, '--no-discovery');
  const opts = parseBuildArgs(rest);
  if (opts.web && port === 38900) port = 5173; // browsers, not phones

  // the mini-program target has no server: DevTools watches the emitted
  // files itself (compileHotReLoad), so dev = rebuild on change
  if (opts.mp) {
    await mpDev({ root: process.cwd(), outDir: opts.outDir });
    return;
  }

  const root = process.cwd();
  // A split build only pays for itself when there are routes to split off.
  // A project with no `src/pages` — `examples/hello-js`, any plain-JS app —
  // would otherwise be served a shared prelude that carries all of Vue
  // (~450 KB the app never calls, evaluated into the VM on every launch).
  // `fjs run` always asks for --pages, so this is the place that knows
  // better; buildBundle makes the same call for `fjs build --pages`.
  if (opts.pages && pagesFor(root, 'app').length === 0) {
    opts.pages = false;
    console.log('fjs dev: no src/pages — single bundle (--pages does not apply)');
  }
  // the modules' build steps run on every rebuild too (buildBundle does it);
  // this first pass is what makes the generated types right from the start
  await runModulePrepare(root, opts.web ? 'web' : 'app');
  writeRouteTypes(root);
  writeModuleTypes(root);
  writeAssetTypes(root);
  claimOutDir(opts, port);
  const state: DevState = { watching: false };
  const impl = opts.web ? webServer(opts, root) : bundleServer(opts, root, state);

  const server = http.createServer((req, res) => {
    void impl
      .handle(req, res)
      .then((handled) => {
        if (handled) return;
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found\n');
      })
      .catch((e) => {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(String(e instanceof Error ? e.message : e));
      });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  // Two kinds of client share this socket: apps (the Flutter host, the
  // browser page) and tools (`fjs log`, `fjs eval`), which announce
  // themselves. Apps must never receive a tool's traffic — a stray "eval"
  // pushed at a browser would reload it — so the split is by identity, not
  // by guessing from the message.
  const tools = new Set<WebSocket>();
  // toggled by the `l` shortcut, read by the log relay below
  let streamLogs = false;
  const apps = (): WebSocket[] =>
    [...wss.clients].filter((c) => !tools.has(c) && c.readyState === WebSocket.OPEN);
  const toTools = (payload: object) => {
    const text = JSON.stringify(payload);
    for (const tool of tools) {
      if (tool.readyState === WebSocket.OPEN) tool.send(text);
    }
  };

  wss.on('connection', (socket) => {
    socket.on('close', () => tools.delete(socket));
    socket.on('message', (raw) => {
      // apps that predate this protocol never send anything; anything that
      // is not our JSON is ignored rather than trusted
      let msg: { fjs?: string; level?: number; text?: string; id?: string; source?: string };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.fjs) {
        case 'tool':
          tools.add(socket);
          socket.send(JSON.stringify({ fjs: 'hello', apps: apps().length }));
          break;
        case 'log': {
          const level = msg.level ?? 1;
          const text = String(msg.text ?? '');
          toTools({ fjs: 'log', level, text });
          // `l`: the same stream `fjs log` shows, without a second terminal.
          // Eval answers travel as logs too and are nobody's console output.
          if (streamLogs && !text.startsWith('\u0000fjs-eval:')) {
            console.log(`${logLevelLabel(Number(level), colorSupported())} ${text}`);
          }
          break;
        }
        case 'eval': {
          // `eval <id> <source>`: the id travels outside the source so the
          // app can answer even when the source does not parse
          const targets = apps();
          const push = `eval ${String(msg.id ?? '-')} ${String(msg.source ?? '')}`;
          for (const app of targets) app.send(push);
          socket.send(JSON.stringify({ fjs: 'eval-sent', apps: targets.length }));
          break;
        }
        case 'perf': {
          // the same thing the `p` key does. Reachable from a tool as well
          // because the key needs a TTY, and a dev server started by
          // `fjs run` (or by CI) does not have one.
          const targets = apps();
          for (const app of targets) app.send('perf');
          socket.send(JSON.stringify({ fjs: 'perf-sent', apps: targets.length }));
          break;
        }
      }
    });
  });

  const notify = (message: string) => {
    let sent = 0;
    for (const client of apps()) {
      client.send(message);
      sent++;
    }
    // "0 clients" is the whole story when an app stops picking up edits
    console.log(`pushed "${message}" to ${sent} client${sent === 1 ? '' : 's'}`);
  };

  // Every request rebuilds into outDir, which sits inside the watched tree:
  // without this filter each reload triggers the next one and the client
  // reloads forever. Match outDir by resolved path, not by basename: the
  // layout puts dev output in dist/app (spec 047), and a basename rule would
  // also silence a project directory that happens to be called `app`.
  const outDirAbs = path.resolve(opts.outDir);
  const generated = new Set([
    path.basename(ROUTE_TYPES_FILE),
    path.basename(MODULE_TYPES_FILE),
    path.basename(MODULE_COMPONENT_TYPES_FILE),
    path.basename(ASSET_TYPES_FILE),
  ]);
  const ignored = (watchDir: string, filename: string | Buffer | null): boolean => {
    if (filename == null) return true; // unnamed event: can't rule out our own write
    // our own generated types: rewriting them must not schedule another rebuild
    const rel = filename.toString();
    if (generated.has(path.basename(rel))) return true;
    // anything on the path between the watched dir and outDir (or below it)
    // is our own build output — `dist` itself, `dist/app`, files inside
    const outDirRel = path.relative(watchDir, outDirAbs);
    if (!outDirRel.startsWith('..')) {
      if (
        rel === outDirRel ||
        rel.startsWith(outDirRel + path.sep) ||
        outDirRel.startsWith(rel + path.sep)
      ) {
        return true;
      }
    }
    return rel
      .split(path.sep)
      .some((seg) => seg === 'node_modules' || seg.startsWith('.'));
  };

  // debounce FS events
  let timer: NodeJS.Timeout | null = null;
  const watchers: fs.FSWatcher[] = [];
  for (const dir of [path.join(root, 'src'), root]) {
    if (!fs.existsSync(dir)) continue;
    try {
      const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (ignored(dir, filename)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          writeRouteTypes(root);
          writeModuleTypes(root);
          writeAssetTypes(root);
          void (impl.onChange?.() ?? Promise.resolve('reload')).then(
            (message) => {
              if (message) notify(message);
            },
            (e: unknown) => {
              console.error('build failed:', e instanceof Error ? e.message : e);
            },
          );
        }, 150);
      });
      watchers.push(w);
    } catch {
      // recursive watch unsupported here — dev still works via manual reload
    }
  }
  // no watcher: never serve a cached build, because nothing would ever
  // invalidate it and a manual reload has to pick up edits
  state.watching = watchers.length > 0;

  await new Promise<void>((resolve, reject) => {
    // without a listener the 'error' event throws a raw stack trace; the
    // common case (a second `fjs dev` on the same port) deserves a sentence.
    // WebSocketServer re-emits the http server's errors, so both need it.
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${port} 已被占用 — 可能已经有一个 fjs dev 在跑。`);
        console.error(`换个端口：fjs dev --port ${port + 1}`);
        process.exit(1);
      }
      reject(err);
    };
    server.once('error', onError);
    wss.once('error', onError);
    server.listen(port, host, resolve);
  });
  // bound to one interface, that interface is the whole story; bound to
  // 0.0.0.0, the banner has to work out which addresses a phone can use
  const lan = host === '0.0.0.0' ? lanAddresses() : [];
  console.log(`fjs dev — ${projectName(root)}`);
  impl.banner(lan, port);

  // fjs go lists whatever it hears here, so a phone needs neither the QR
  // code nor the address. --web is a browser target: nothing to announce.
  if (discovery && !opts.web) {
    startBeacon({
      name: projectName(root),
      port,
      mode: opts.pages ? 'pages' : 'bundle',
      entry: opts.entry ?? 'src/main.ts',
    });
    console.log('');
    console.log('  局域网广播已开启 — fjs go 连接页会直接列出这个服务器（--no-discovery 关闭）');
  }
  const qrAddress = host === '0.0.0.0' ? lan[0] : host;
  if (qr && qrAddress) printQr(qrAddress, port);

  const webUrl = `http://localhost:${port}/`;
  const keys: KeyCommand[] = [
    {
      key: 'r',
      label: 'reload the app (rebuild, then push a full reload)',
      async run() {
        console.log('rebuilding…');
        await impl.rebuild?.();
        notify('reload');
      },
    },
    {
      key: 'l',
      label: 'toggle the app log stream (same lines as fjs log)',
      run() {
        streamLogs = !streamLogs;
        console.log(streamLogs ? 'log stream on' : 'log stream off');
      },
    },
    {
      key: 'p',
      label: 'toggle the performance overlay on the connected apps',
      run() {
        const count = apps().length;
        notify('perf');
        console.log(
          count === 0
            ? 'no app connected — nothing to toggle'
            : `perf overlay toggled on ${count} app${count === 1 ? '' : 's'}`,
        );
      },
    },
    {
      key: 'd',
      label: 'who is connected',
      run() {
        const count = apps().length;
        console.log(
          `${count} app${count === 1 ? '' : 's'} and ${tools.size} tool${
            tools.size === 1 ? '' : 's'
          } connected on port ${port}`,
        );
      },
    },
    {
      key: 'c',
      label: 'show the addresses and the QR code again',
      run() {
        impl.banner(lan, port);
        if (qrAddress) printQr(qrAddress, port);
      },
    },
  ];
  if (opts.web) {
    keys.push({
      key: 'o',
      label: `open ${webUrl} in the browser`,
      run: () => openInBrowser(webUrl),
    });
  }
  const keyboard = startKeyboard(keys);
  if (keyboard) {
    keyboard.help();
  } else {
    // no TTY (piped, CI, or spawned by `fjs run`) — nothing reads keys here
    console.log('Ctrl+C to stop.');
  }
}

/** Hands a URL to the platform's opener. Best effort: a machine without one
 * (a headless box, an unusual desktop) just gets the URL printed above. */
function openInBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
  child.on('error', () => console.log(`could not open a browser — ${url}`));
  child.unref();
}

/** The scan-me block: fjs go's 扫一扫 reads it, and so does a phone camera
 * (--web opens it in the browser). Only the first address gets one — a
 * screen full of QR codes is worse than one plus a printed list. */
function printQr(address: string, port: number): void {
  // no trailing slash: at this length one byte is the difference between a
  // 25-module code and a 29-module one, and both sides accept either form
  const url = `http://${address}:${port}`;
  console.log('');
  console.log(`  扫码连接：${url}`);
  console.log('');
  for (const line of qrLines(url, { color: colorSupported() })) {
    console.log(`    ${line}`);
  }
  console.log('');
}

/** Serves one file out of [dir], or answers false so the caller can go on.
 *
 * The path is decoded and then confined to [dir]: a dev server on a LAN
 * address is reachable by anything on the Wi-Fi, and `..` in a URL must not
 * walk out of public/. */
function sendLocalFile(
  res: http.ServerResponse,
  dir: string,
  relative: string,
  root: string,
): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return false;
  }
  if (!decoded || decoded.includes('\0')) return false;
  const file = path.resolve(dir, decoded);
  if (file !== dir && !file.startsWith(dir + path.sep)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': moduleContentType(file),
    'cache-control': 'no-store',
  });
  res.end(body);
  console.log(`served ${path.relative(root, file)} (${body.length} B)`);
  return true;
}

// ---- Flutter bundle server -------------------------------------------------

function bundleServer(opts: BuildOptions, root: string, state: DevState): Server {
  // buildBundle applies the same default; resolve it here too so the banner
  // and the manifest name the file that is actually served
  const entry = opts.entry ?? 'src/main.ts';
  // a split build produces 2 + one-per-page artifacts, and fjs go asks for
  // them one request at a time — rebuilding all of them per request would
  // make every page navigation cost a full build
  let cached: Promise<BuildResult> | null = null;
  // what the last successful build wrote, so a rebuild can name what changed
  let prints: Fingerprint | null = null;
  let lastResult: BuildResult | null = null;
  // Units mode (spec 037) is negotiated at the manifest: a current engine
  // requests `/manifest.json?units=1` and gets the unit-shaped build; an
  // older app gets the classic split layout, whose artifacts it understands.
  // Toggling the flag changes every artifact's shape, so the cache drops.
  let unitsMode = false;
  const build = () => {
    const fresh = async () => {
      const started = Date.now();
      const result = await buildBundle({
        ...opts,
        minify: false,
        bytecode: false,
        units: unitsMode && opts.pages,
      });
      lastResult = result;
      prints = fingerprint(result, root);
      console.log(`built dev bundle in ${Date.now() - started}ms`);
      return result;
    };
    if (!state.watching) return fresh();
    return (cached ??= fresh().catch((e) => {
      cached = null; // a failed build must not stick
      throw e;
    }));
  };

  const sendJs = (res: http.ServerResponse, file: string, started = Date.now()) => {
    const size = fs.statSync(file).size;
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(fs.readFileSync(file));
    console.log(`served ${path.relative(root, file)} (${size} B) in ${Date.now() - started}ms`);
  };

  return {
    async handle(req, res) {
      const url = (req.url ?? '/').split('?')[0];
      if (url === '/manifest.json') {
        // what fjs go shows before/while connecting; also its reachability probe
        const wantsUnits =
          new URL(req.url ?? '/', 'http://fjs.dev').searchParams.get('units') === '1';
        if (wantsUnits !== unitsMode) {
          unitsMode = wantsUnits;
          cached = null; // the artifact shape changes with the flag
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(
          JSON.stringify({
            name: projectName(root),
            entry,
            root,
            split: opts.pages,
            units: unitsMode && opts.pages,
            routes: opts.pages
              ? pagesFor(root, 'app').map((p) => ({ path: p.path, chunk: p.chunk }))
              : [],
          }),
        );
        return true;
      }
      if (
        url === '/bundle.js' ||
        url === '/shared.js' ||
        url === '/units.js' ||
        url.startsWith('/pages/') ||
        url.startsWith('/units/')
      ) {
        const started = Date.now();
        try {
          const result = await build();
          if (url === '/bundle.js') sendJs(res, result.jsPath, started);
          else if (url === '/shared.js') {
            if (!result.sharedPath) throw new Error('no shared chunk (run fjs dev --pages)');
            sendJs(res, result.sharedPath, started);
          } else if (url === '/units.js') {
            // the whole unit set, dependencies-first-ish, define-only: the
            // engine evaluates it once at bootstrap so every later require
            // finds its factory
            const file = path.join(path.dirname(result.jsPath), 'units.js');
            if (!result.devUnits || !fs.existsSync(file)) {
              throw new Error('no unit bundle (not a units-mode dev server)');
            }
            sendJs(res, file, started);
          } else if (url.startsWith('/units/')) {
            if (!result.devUnits) throw new Error('not a units-mode dev server');
            let id: string;
            try {
              id = decodeURIComponent(url.slice('/units/'.length)).replace(/\.js$/, '');
            } catch {
              throw new Error('bad unit id');
            }
            // looked up in the graph, never joined into a path: traversal-proof
            const file = result.devUnits.files[id];
            if (!file) throw new Error(`unknown unit "${id}"`);
            sendJs(res, file, started);
          } else if (url.endsWith('.deps.json')) {
            if (!result.devUnits) throw new Error('not a units-mode dev server');
            const chunk = url
              .slice('/pages/'.length)
              .replace(/\.deps\.json$/, '');
            const deps = result.devUnits.pageDeps[chunk];
            if (!deps) throw new Error(`unknown page chunk "${chunk}"`);
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            });
            res.end(JSON.stringify(deps));
            console.log(`served /pages/${chunk}.deps.json (${deps.length} units)`);
          } else {
            const chunk = url.slice('/pages/'.length).replace(/\.js$/, '');
            const file = result.pageChunks?.[chunk];
            if (!file) throw new Error(`unknown page chunk "${chunk}"`);
            sendJs(res, file, started);
          }
        } catch (e) {
          const message = 'fjs dev build error: ' + String(e instanceof Error ? e.message : e);
          console.error(message);
          res.writeHead(500, { 'content-type': 'application/javascript; charset=utf-8' });
          res.end(`throw new Error(${JSON.stringify(message)});`);
        }
        return true;
      }
      // Local files, the same root paths the browser uses: what the bundler
      // emitted from an `import png from …` under /assets/, and public/
      // verbatim everywhere else. `await build()` first — /assets/ must be
      // read out of THIS build's output, or an edited image serves the
      // previous hash (specs/017-local-image-assets).
      // worker scripts (specs/049): compiled from src/workers on every
      // request, so an edited worker is what the next `new Worker` runs
      if (url.startsWith(`/${WORKERS_DIR}/`)) {
        const file = workerFileForUrl(root, url);
        if (!file) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`not found: ${url}\n`);
          return true;
        }
        try {
          const code = await bundleWorker(root, file);
          res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
          res.end(code);
        } catch (e) {
          const message = `fjs dev: worker ${url} failed to build: ${e instanceof Error ? e.message : e}`;
          console.error(message);
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(message);
        }
        return true;
      }
      if (url.startsWith('/assets/')) {
        const result = await build();
        const dir = path.join(path.dirname(result.jsPath), 'assets');
        if (sendLocalFile(res, dir, url.slice('/assets/'.length), root)) return true;
      }
      if (url !== '/' && sendLocalFile(res, path.join(root, 'public'), url.slice(1), root)) {
        return true;
      }
      // html/ keeps its directory name in the URL, so /html/guide.html is
      // read straight off the project root (specs/018-src-hints-and-html-dir)
      if (url.startsWith('/html/') && sendLocalFile(res, root, url.slice(1), root)) {
        return true;
      }
      if (url.startsWith('/modules/')) {
        let modPath: string;
        try {
          modPath = decodeURIComponent(url.slice('/modules/'.length));
        } catch {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('bad module path\n');
          return true;
        }
        const separator = modPath.indexOf('/');
        const shortName = separator < 0 ? modPath : modPath.slice(0, separator);
        const relative = separator < 0 ? '' : modPath.slice(separator + 1);
        const module = scanModules(root).find(
          (candidate) => candidate.name.replace(/^@[^/]+\//, '') === shortName,
        );
        if (
          !module ||
          !relative ||
          relative.includes('..') ||
          path.isAbsolute(relative)
        ) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('not found\n');
          return true;
        }
        const dataDir = path.resolve(moduleDataDir(root, module.name));
        const file = path.resolve(dataDir, relative);
        if (file !== dataDir && !file.startsWith(dataDir + path.sep)) {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('bad module path\n');
          return true;
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('not found\n');
          return true;
        }
        res.writeHead(200, {
          'content-type': moduleContentType(file),
          'cache-control': 'no-store',
        });
        res.end(fs.readFileSync(file));
        return true;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('fjs dev server\n');
      return true;
    },
    async rebuild() {
      cached = null;
      await build();
    },
    async onChange() {
      // Rebuild before notifying fjs-go. Otherwise the first route change
      // after an edit pays the full split-build cost while the user is
      // waiting on a tiny page chunk. It also tells us which artifacts the
      // edit really touched, which decides how much the app has to redo.
      const before = prints;
      cached = null;
      if (!state.watching) return 'reload';
      await build();
      return changeMessage(before, prints ?? new Map(), lastResult?.devUnits);
    },
    banner(addresses, port) {
      console.log(`  entry:   ${entry}`);
      console.log(`  mode:    ${opts.pages ? 'split (shared prelude + page chunks)' : 'single bundle'}`);
      console.log('');
      console.log('  fjs go, connect to:');
      for (const ip of ['127.0.0.1', ...addresses]) {
        console.log(`    ${ip}:${port}${ip === '127.0.0.1' ? '   (simulator / desktop)' : '   (LAN — physical devices)'}`);
      }
      console.log(`    10.0.2.2:${port}   (Android emulator -> this machine)`);
      console.log('');
      console.log(`  embedded host: engine.connectDev('${addresses[0] ?? '127.0.0.1'}', ${port});`);
    },
  };
}

// ---- web static server -----------------------------------------------------

function webServer(opts: BuildOptions, root: string): Server {
  const webOut = path.join(path.resolve(opts.outDir), 'web');
  let building: Promise<void> | null = null;
  const rebuild = async () => {
    await buildBundle({ ...opts, minify: false, bytecode: false });
    // dev-only: teach the built page to reload itself
    const indexPath = path.join(webOut, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    if (!html.includes('fjs-dev-reload')) {
      fs.writeFileSync(
        indexPath,
        html.replace('</body>', `${RELOAD_SNIPPET}<!-- fjs-dev-reload --></body>`),
      );
    }
  };
  const ready = () => (building ??= rebuild());

  return {
    async handle(req, res) {
      await ready();
      const url = (req.url ?? '/').split('?')[0];
      // resolveStaticFile carries the SPA-fallback comment: an
      // extension-less path lands on index.html (a deep link in history
      // mode), a missing path WITH an extension gets the honest 404 that
      // specs/017's silent-failure cleanup demands.
      const file = resolveStaticFile(webOut, url);
      if (file === null) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`not found: ${url}\n`);
        return true;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(fs.readFileSync(file));
      return true;
    },
    async rebuild() {
      building = rebuild();
      await building;
    },
    async onChange() {
      building = rebuild();
      await building;
      return 'reload'; // one bundle, one page: nothing finer to say
    },
    banner(addresses, port) {
      console.log(`  ${webTitle(root)} — web build`);
      console.log('');
      console.log(`    http://localhost:${port}/`);
      for (const ip of addresses) console.log(`    http://${ip}:${port}/   (LAN)`);
    },
  };
}
