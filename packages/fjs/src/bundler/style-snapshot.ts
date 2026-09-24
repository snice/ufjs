// Build-time style prewarm (specs/119, split builds: specs/121).
//
// The first open of a page used to pay for every style match and computed
// style from an empty cache, on the device, every cold start — although the
// answer is fixed by the page's element tree and the style sheets, both known
// at build time. Here the Flutter-target bundle runs once in Node, mounts
// each static route exactly as the router does on a device (headless), and
// hands back the style engine's caches per page (StyleEngine.exportSnapshot).
// They are appended to the page's chunk (or the single bundle) as JSON
// strings; the router imports one right before its page mounts.
//
// Why Node and not fjsrun: the CLI ships fjsc (a compiler), not an engine,
// and Node is always there. The style engine is plain ES2019 with no host
// dependency on this path; the match counts per page are identical to the
// PrimJS run (vant-mount-perf.md). A fresh vm context rather than the CLI's
// own global keeps Node-only globals (TextEncoder, URL…) out of reach, as
// they are on the device.
import fs from 'node:fs';
import vm from 'node:vm';

export interface CapturedStyles {
  /** Route path -> snapshot JSON. */
  snapshots: Record<string, string>;
  /** Route path -> why its capture failed (the page threw while mounting). */
  errors: Record<string, string>;
  ms: number;
}

type CaptureHook = ((results: unknown) => void) & {
  started?: boolean;
  routes?: string[];
  loadChunk?: (chunk: string) => void;
};

export interface CaptureOptions {
  /** Capture only these route paths (default: every static route). */
  routes?: string[];
  /** Page chunk name -> file, for a split build: the router evaluates a
   * page's chunk into the VM before mounting it, as the host does. */
  chunks?: Record<string, string>;
  timeoutMs?: number;
}

/** Runs `files` in order in one fresh VM with the capture hook set — a
 * single bundle, or a split build's shared prelude then its entry. Null
 * when the bundle never starts a capture (an app not built on createFjsApp,
 * e.g. a raw element API app) or does not finish within `timeoutMs`. */
export async function captureStyleSnapshots(
  files: string | string[],
  opts: CaptureOptions = {},
): Promise<CapturedStyles | null> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const t0 = Date.now();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  let hook!: CaptureHook;
  const done = new Promise<unknown>((resolve) => {
    hook = resolve as CaptureHook;
  });
  const quiet = () => {};
  const sandbox: Record<string, unknown> = {
    // pages log freely while mounting; none of it is the build's business
    console: { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet },
    setTimeout: (fn: () => void, ms?: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    },
    clearTimeout: (t: ReturnType<typeof setTimeout>) => {
      timers.delete(t);
      clearTimeout(t);
    },
    setInterval: (fn: () => void, ms?: number) => {
      const t = setInterval(fn, ms);
      intervals.add(t);
      return t;
    },
    clearInterval: (t: ReturnType<typeof setInterval>) => {
      intervals.delete(t);
      clearInterval(t);
    },
    queueMicrotask,
    __fjsCaptureStyles: hook,
  };
  // animation-driven components (vant's swipe, sticky) schedule frames
  sandbox.requestAnimationFrame = (cb: (t: number) => void) =>
    (sandbox.setTimeout as (fn: () => void, ms: number) => unknown)(() => cb(Date.now()), 16);
  sandbox.cancelAnimationFrame = sandbox.clearTimeout;
  const context = vm.createContext(sandbox);
  const run = (file: string) => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  hook.routes = opts.routes;
  const chunks = opts.chunks;
  if (chunks) {
    hook.loadChunk = (chunk: string) => {
      const file = chunks[chunk];
      if (file) run(file);
    };
  }
  const cleanup = () => {
    for (const t of timers) clearTimeout(t);
    for (const t of intervals) clearInterval(t);
  };
  try {
    for (const file of Array.isArray(files) ? files : [files]) run(file);
  } catch (e) {
    cleanup();
    throw new Error(`style prewarm: the bundle threw while loading: ${String((e as Error)?.message ?? e)}`);
  }
  // createFjsApp().mount() marks the hook synchronously when it takes over
  if (!hook.started) {
    cleanup();
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const results = await Promise.race([
    done,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  cleanup();
  if (results === null) return null;
  const out: CapturedStyles = { snapshots: {}, errors: {}, ms: Date.now() - t0 };
  const table = results as Record<string, unknown>;
  if (typeof table.__error === 'string') throw new Error(`style prewarm failed: ${table.__error}`);
  for (const [route, snap] of Object.entries(table)) {
    const error = (snap as { error?: unknown }).error;
    if (typeof error === 'string') {
      out.errors[route] = error.split('\n')[0];
      continue;
    }
    const json = JSON.stringify(snap);
    // PrimJS's JSON.parse reads a string holding an escaped NUL as empty:
    // such a snapshot would import wrong values without any error. Nothing
    // in the engine puts NUL in a style value today (css/font-shorthand.ts
    // moved off it for this reason); refuse rather than ship it if it ever
    // comes back.
    if (json.includes('\\u0000')) {
      out.errors[route] = 'its styles contain a NUL character, which PrimJS cannot read back';
      continue;
    }
    out.snapshots[route] = json;
  }
  return out;
}

/** The statement that makes `snapshots` available to the router: one
 * assignment per route into `globalThis.__fjsStyleSnapshots`. The JSON stays
 * a string literal — a bytecode build would otherwise rebuild the whole
 * object graph every time the chunk runs, and a page never opened should
 * not pay for its snapshot. ES2019: no `??=`. One line, newline-terminated
 * (see prependSnapshots). */
export function snapshotStatement(snapshots: Record<string, string>): string {
  const lines = Object.entries(snapshots).map(
    ([route, json]) => `t[${JSON.stringify(route)}]=${JSON.stringify(json)};`,
  );
  if (lines.length === 0) return '';
  return (
    '(function(t){' +
    lines.join('') +
    '})(globalThis.__fjsStyleSnapshots||(globalThis.__fjsStyleSnapshots={}));\n'
  );
}

/** Puts the snapshots at the TOP of a built JS file. Not the end: a single
 * bundle mounts its first page while it is still evaluating (main.ts calls
 * createFjsApp().mount()), before anything appended would have run. The
 * statement is one whole line, so an external source map only needs one
 * more empty line at its start (a leading `;` in `mappings`). */
export function prependSnapshots(file: string, snapshots: Record<string, string>): void {
  const statement = snapshotStatement(snapshots);
  if (!statement) return;
  fs.writeFileSync(file, statement + fs.readFileSync(file, 'utf8'));
  const mapFile = `${file}.map`;
  if (fs.existsSync(mapFile)) {
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as { mappings?: string };
    if (typeof map.mappings === 'string') {
      map.mappings = `;${map.mappings}`;
      fs.writeFileSync(mapFile, JSON.stringify(map));
    }
  }
}

/** One line for the build log. */
export function describeCapture(c: CapturedStyles): string {
  const pages = Object.keys(c.snapshots).length;
  const kb = Object.values(c.snapshots).reduce((n, s) => n + s.length, 0) / 1024;
  const failed = Object.keys(c.errors);
  return (
    `style prewarm: ${pages} page${pages === 1 ? '' : 's'} captured in ${c.ms}ms (${kb.toFixed(0)} KB)` +
    (failed.length ? `; skipped ${failed.join(', ')}` : '')
  );
}
