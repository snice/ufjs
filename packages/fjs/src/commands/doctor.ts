// fjs doctor — check that this machine and this project can actually build.
//
// Every check here corresponds to a failure people otherwise hit halfway
// through a build: a missing fjsc, a Flutter host that is not there yet, a
// @ufjs/cli and @ufjs/runtime pair that drifted apart. Checks are grouped
// as ok / warn / fail — warnings are for things only some targets need
// (Xcode on a Linux box is not a problem), failures set the exit code.
//
// The slow probes (flutter, adb, xcodebuild) are spawned asynchronously
// rather than with spawnSync: `flutter devices` alone can take seconds, and
// a blocked event loop would freeze the spinner it is supposed to explain.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fjscPackageName, locateFjsc, type FjscLookup } from '../bundler/build.js';
import { ENGINE_IDS, resolveJsEngine, type JsEngine } from '../project/engine.js';
import { pagesDir, scanPages } from '../project/pages.js';
import { flutterDir as configuredFlutterDir, isEjected } from '../project/config.js';
import { colorSupported } from '../dev/qrcode.js';

type Status = 'ok' | 'warn' | 'fail';

interface Result {
  status: Status;
  detail: string;
  hint?: string;
}

interface Check extends Result {
  label: string;
}

interface CheckSpec {
  label: string;
  run: () => Result | Promise<Result>;
}

export async function doctorCommand(argv: string[]): Promise<void> {
  for (const arg of argv) throw new Error(`unknown doctor option: ${arg}`);

  const root = process.cwd();
  const specs: CheckSpec[] = [
    { label: 'node', run: nodeCheck },
    { label: 'project', run: () => projectCheck(root) },
    { label: 'entry', run: () => entryCheck(root) },
    { label: 'pages', run: () => pagesCheck(root) },
    { label: 'packages', run: () => versionCheck(root) },
    { label: 'fjsc primjs', run: () => fjscCheck('primjs') },
    { label: 'fjsc quickjs', run: () => fjscCheck('quickjs') },
    { label: 'flutter', run: flutterCheck },
    { label: 'android', run: androidCheck },
    ...(process.platform === 'darwin' ? [{ label: 'ios', run: iosCheck }] : []),
    { label: 'devices', run: devicesCheck },
    { label: 'flutter host', run: () => hostCheck(root) },
  ];

  const color = colorSupported();
  // known up front, so results can print as they land and still line up
  const width = Math.max(...specs.map((spec) => spec.label.length));
  console.log(`fjs doctor — ${root}\n`);

  const checks: Check[] = [];
  for (const spec of specs) {
    const stop = spinner(spec.label, color);
    let result: Result;
    try {
      result = await spec.run();
    } catch (e) {
      result = { status: 'fail', detail: e instanceof Error ? e.message : String(e) };
    } finally {
      stop();
    }
    const check: Check = { label: spec.label, ...result };
    checks.push(check);
    console.log(`${mark(check.status, color)} ${check.label.padEnd(width)}  ${check.detail}`);
    if (check.hint) {
      for (const line of check.hint.split('\n')) console.log(`  ${dim(line, color)}`);
    }
  }

  const failures = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  console.log(
    `\n${checks.length - failures - warnings} ok, ${warnings} warning${
      warnings === 1 ? '' : 's'
    }, ${failures} problem${failures === 1 ? '' : 's'}`,
  );
  if (failures > 0) process.exitCode = 1;
}

/** Draws a spinner on the current line until the returned function is
 * called, which erases it so the result can take the line. A no-op when
 * stdout is not a terminal: piped output should stay diffable. */
function spinner(label: string, color: boolean): () => void {
  if (!process.stdout.isTTY) return () => {};
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const draw = () => {
    process.stdout.write(`\r\x1B[K${dim(frames[i++ % frames.length], color)} ${label}…`);
  };
  draw();
  const timer = setInterval(draw, 80);
  // never let the animation hold the process open
  timer.unref?.();
  return () => {
    clearInterval(timer);
    process.stdout.write('\r\x1B[K');
  };
}

// ------------------------------------------------------------- checks

function nodeCheck(): Result {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 18
    ? { status: 'ok', detail: `v${process.versions.node}` }
    : {
        status: 'fail',
        detail: `v${process.versions.node}`,
        hint: 'fjs needs Node 18 or newer',
      };
}

function projectCheck(root: string): Result {
  const pkg = readPackage(root);
  if (!pkg) {
    return {
      status: 'warn',
      detail: 'no package.json here',
      hint: 'run fjs from a project root, or create one:\n  npx @ufjs/cli create my-app',
    };
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (!deps['@ufjs/cli'] && !deps['@ufjs/runtime']) {
    return {
      status: 'warn',
      detail: `${pkg.name ?? path.basename(root)} — no @ufjs dependency`,
      hint: 'this does not look like an fjs project',
    };
  }
  return { status: 'ok', detail: String(pkg.name ?? path.basename(root)) };
}

function entryCheck(root: string): Result {
  const entry = path.join(root, 'src', 'main.ts');
  if (fs.existsSync(entry)) return { status: 'ok', detail: 'src/main.ts' };
  const alt = ['src/main.js', 'src/index.ts'].find((p) => fs.existsSync(path.join(root, p)));
  if (alt) {
    return {
      status: 'warn',
      detail: `${alt} (not the default)`,
      hint: `pass it explicitly: fjs build ${alt}`,
    };
  }
  return {
    status: 'warn',
    detail: 'no src/main.ts',
    hint: 'fjs build/dev default to src/main.ts',
  };
}

function pagesCheck(root: string): Result {
  const dir = pagesDir(root);
  if (!fs.existsSync(dir)) {
    return {
      status: 'warn',
      detail: 'no src/pages',
      hint: 'file routing is off; fjs create page <name> starts it',
    };
  }
  const pages = scanPages(root);
  if (pages.length === 0) return { status: 'warn', detail: 'src/pages is empty' };
  const app = pages.filter((p) => p.platforms.includes('app')).length;
  const web = pages.filter((p) => p.platforms.includes('web')).length;
  return {
    status: 'ok',
    detail: `${pages.length} page${pages.length === 1 ? '' : 's'} (app ${app}, web ${web}) — fjs routes lists them`,
  };
}

function versionCheck(root: string): Result {
  const cli = installedVersion(root, '@ufjs/cli');
  const runtime = installedVersion(root, '@ufjs/runtime');
  if (!cli && !runtime) {
    return {
      status: 'warn',
      detail: 'nothing installed under node_modules',
      hint: 'run npm install',
    };
  }
  const detail = `@ufjs/cli ${cli ?? 'missing'}, @ufjs/runtime ${runtime ?? 'missing'}`;
  if (!cli || !runtime) return { status: 'warn', detail, hint: 'run npm install' };
  if (minor(cli) !== minor(runtime)) {
    return {
      status: 'warn',
      detail,
      hint: 'the CLI and the runtime speak one protocol — keep them on the same minor',
    };
  }
  return { status: 'ok', detail };
}

/** One row per engine flavor (spec 114): the flavor this project builds
 * with (FJS_JS_ENGINE or the default) must have its fjsc, the other one only
 * matters after a --js-engine switch. */
function fjscCheck(engine: JsEngine): Result {
  const current = resolveJsEngine() === engine;
  let found: FjscLookup;
  try {
    found = locateFjsc(engine);
  } catch (e) {
    // FJSC_PATH points at the other flavor
    return { status: current ? 'fail' : 'warn', detail: 'FJSC_PATH is the wrong flavor', hint: (e as Error).message };
  }
  if (found.path === null) {
    const seen = found.tried.map((t) => `${t.path} is ${t.engineId ?? 'not a fjsc'}`).join('\n');
    return {
      status: current ? 'fail' : 'warn',
      detail: `not found (${ENGINE_IDS[engine]})`,
      hint:
        (seen ? `${seen}\n` : '') +
        `${current ? 'bytecode and release builds need it' : `needed for --js-engine ${engine}`}; ` +
        `it normally arrives with ${fjscPackageName()}.\n` +
        'in a repo checkout: node packages/fjsc/build.mjs, then export FJSC_PATH=<binary>',
    };
  }
  return { status: 'ok', detail: `${found.path} (${found.source})` };
}

async function flutterCheck(): Promise<Result> {
  const version = await firstLine('flutter', ['--version']);
  if (!version) {
    return {
      status: 'warn',
      detail: 'not on PATH',
      hint: 'only the web build works without it; fjs run/--release need Flutter',
    };
  }
  return { status: 'ok', detail: version };
}

async function androidCheck(): Promise<Result> {
  const adb = await firstLine('adb', ['--version']);
  return adb
    ? { status: 'ok', detail: adb }
    : {
        status: 'warn',
        detail: 'adb not on PATH',
        hint: 'needed for Android devices — flutter doctor has the full setup',
      };
}

async function iosCheck(): Promise<Result> {
  const xcode = await firstLine('xcodebuild', ['-version']);
  return xcode
    ? { status: 'ok', detail: xcode }
    : {
        status: 'warn',
        detail: 'xcodebuild not available',
        hint: 'install Xcode and run xcode-select --install for iOS builds',
      };
}

async function devicesCheck(): Promise<Result> {
  const out = await capture('flutter', ['devices', '--machine']);
  if (out === null) {
    return { status: 'warn', detail: 'could not list (is flutter installed?)' };
  }
  let devices: Array<{ name?: string; id?: string; targetPlatform?: string }> = [];
  try {
    const parsed: unknown = JSON.parse(out);
    if (Array.isArray(parsed)) devices = parsed;
  } catch {
    return { status: 'warn', detail: 'flutter devices returned junk' };
  }
  const mobile = devices.filter((d) => {
    const target = d.targetPlatform ?? '';
    return target.startsWith('android') || target === 'ios' || target.startsWith('ohos');
  });
  if (mobile.length === 0) {
    return {
      status: 'warn',
      detail: 'no android/ios/ohos device',
      hint: 'start an emulator (flutter emulators) or a simulator before fjs run',
    };
  }
  return { status: 'ok', detail: mobile.map((d) => `${d.name} (${d.id})`).join(', ') };
}

function hostCheck(root: string): Result {
  const shown = configuredFlutterDir(root);
  const pubspec = path.join(root, shown, 'pubspec.yaml');
  if (!fs.existsSync(pubspec)) {
    return { status: 'ok', detail: `not created yet — fjs host create makes ${shown}` };
  }
  const text = fs.readFileSync(pubspec, 'utf8');
  const local = /flutter_fjs:\s*\n\s*path:\s*(\S+)/.exec(text);
  const hosted = /flutter_fjs:\s*(\S+)/.exec(text);
  const source = local ? `from ${local[1]}` : hosted ? hosted[1] : 'from pub.dev';
  const owner = isEjected(root) ? 'ejected' : 'managed';
  // the third leg of the version triangle (fjs upgrade moves all three):
  // a hosted flutter_fjs on a different minor than the CLI is the classic
  // half-upgrade; a path dependency is the repo's own business
  if (!local && hosted !== null) {
    const cli = installedVersion(root, '@ufjs/cli');
    const constraint = hosted[1].replace(/^\^/, '');
    if (cli !== null && minor(constraint) !== minor(cli)) {
      return {
        status: 'warn',
        detail: `${shown} (${owner}) — flutter_fjs ${hosted[1]} vs @ufjs/cli ${cli}`,
        hint: 'fjs upgrade moves the three packages together',
      };
    }
  }
  return { status: 'ok', detail: `${shown} (${owner}) — flutter_fjs ${source}` };
}

// ------------------------------------------------------------- helpers

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

export function readPackage(root: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

/** Walks node_modules by hand instead of using require.resolve: both @ufjs
 * packages declare "exports", which hides their own package.json from the
 * resolver. Walking up also follows pnpm's symlinked workspace layout.
 * fjs upgrade reuses this for its from-side. */
export function installedVersion(root: string, name: string): string | null {
  let dir = root;
  for (;;) {
    const manifest = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as PackageJson;
        return pkg.version ?? null;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function minor(version: string): string {
  const [major, min] = version.split('.');
  return `${major}.${min}`;
}

/** stdout of a successful run, or null for "not installed / did not work".
 * A missing binary is an expected answer here, not an error. */
function capture(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 60_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? out : null));
  });
}

async function firstLine(cmd: string, args: string[]): Promise<string | null> {
  const out = await capture(cmd, args);
  return out ? out.split('\n')[0].trim() || null : null;
}

function mark(status: Status, color: boolean): string {
  const symbol = status === 'ok' ? '✓' : status === 'warn' ? '!' : '✗';
  if (!color) return symbol;
  const code = status === 'ok' ? 32 : status === 'warn' ? 33 : 31;
  return `\x1B[${code}m${symbol}\x1B[0m`;
}

function dim(value: string, color: boolean): string {
  return color ? `\x1B[2m${value}\x1B[0m` : value;
}
