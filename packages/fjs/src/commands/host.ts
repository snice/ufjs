// fjs host — the Flutter project fjs generates and runs the app inside.
//
// By default it lives under .fjs/flutter: disposable, gitignored, and
// regenerated on every run. That is the right default until the app needs
// real native work — a permission, a plugin, a signing config, an icon —
// at which point `fjs host eject` moves it into the repo and fjs stops
// rewriting its Dart and pubspec.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_FLUTTER_DIR,
  flutterDir as configuredFlutterDir,
  isEjected,
  updateConfig,
} from '../project/config.js';
import { ensureFlutterHost, projectName } from './run.js';

const SUBCOMMANDS = ['status', 'create', 'open', 'eject', 'sync', 'id'] as const;
type Sub = (typeof SUBCOMMANDS)[number];

export function hostCommand(argv: string[]): void {
  const first = argv[0];
  const sub: Sub = first && (SUBCOMMANDS as readonly string[]).includes(first)
    ? (first as Sub)
    : 'status';
  const rest = sub === 'status' && first !== 'status' ? argv : argv.slice(1);
  if (sub === 'status' && first !== undefined && first !== 'status') {
    throw new Error(`unknown host subcommand "${first}" — one of: ${SUBCOMMANDS.join(', ')}`);
  }

  const root = process.cwd();
  const dir = path.resolve(root, configuredFlutterDir(root));
  switch (sub) {
    case 'status':
      status(root, dir, rest);
      break;
    case 'create':
      create(root, dir, rest);
      break;
    case 'open':
      open(dir, rest);
      break;
    case 'eject':
      eject(root, dir, rest);
      break;
    case 'sync':
      sync(root, dir, rest);
      break;
    case 'id':
      setBundleId(dir, rest);
      break;
  }
}

// ------------------------------------------------------------- status

function status(root: string, dir: string, argv: string[]): void {
  noOptions('status', argv);
  const shown = path.relative(root, dir) || dir;
  if (!fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
    console.log(`host:   ${shown} (not created yet)`);
    console.log('        fjs host create, or fjs run android|ios');
    return;
  }
  console.log(`host:   ${shown}`);
  console.log(
    `owner:  ${
      isEjected(root)
        ? 'you — fjs keeps assets + generated lib modules in sync, never touches your main.dart/pubspec'
        : 'fjs — regenerated on every run (fjs host eject takes it over)'
    }`,
  );
  const id = currentBundleId(dir);
  if (id) console.log(`id:     ${id}`);
  const pubspec = fs.readFileSync(path.join(dir, 'pubspec.yaml'), 'utf8');
  const local = /flutter_fjs:\s*\n\s*path:\s*(\S+)/.exec(pubspec);
  console.log(`plugin: flutter_fjs ${local ? `from ${local[1]}` : 'from pub.dev'}`);
}

// ------------------------------------------------------------- create

function create(root: string, dir: string, argv: string[]): void {
  noOptions('create', argv);
  ensureFlutterHost(dir, projectName(root), !isEjected(root));
  console.log(`host ready: ${path.relative(root, dir) || dir}`);
}

// --------------------------------------------------------------- open

function open(dir: string, argv: string[]): void {
  const platform = argv[0];
  if (platform !== 'android' && platform !== 'ios' && platform !== 'ohos') {
    throw new Error('fjs host open needs a platform: android, ios or ohos');
  }
  noOptions('open', argv.slice(1));
  requireHost(dir);

  const target =
    platform === 'android'
      ? path.join(dir, 'android')
      : platform === 'ohos'
        ? path.join(dir, 'ohos')
        : [
            path.join(dir, 'ios', 'Runner.xcworkspace'),
            path.join(dir, 'ios', 'Runner.xcodeproj'),
          ].find((candidate) => fs.existsSync(candidate));
  if (!target || !fs.existsSync(target)) {
    const hint =
      platform === 'ohos'
        ? ' (created by the OpenHarmony fork: flutter create --platforms ohos .)'
        : ' — run fjs host create first';
    throw new Error(`no ${platform} project in ${dir}${hint}`);
  }

  const [cmd, args] = opener(target, platform);
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`could not open ${target} — open it manually`);
  }
  console.log(`opened ${target}`);
}

function opener(target: string, platform?: string): [string, string[]] {
  // the ohos host has no IDE-neutral project file; DevEco Studio is the only
  // thing that understands an hvigor/ArkTS project tree
  if (platform === 'ohos' && process.platform === 'darwin') {
    return ['open', ['-a', 'DevEco-Studio', target]];
  }
  if (process.platform === 'darwin') return ['open', [target]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '', target]];
  return ['xdg-open', [target]];
}

// -------------------------------------------------------------- eject

function eject(root: string, dir: string, argv: string[]): void {
  let target = 'flutter';
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force' || arg === '-f') force = true;
    else if (!arg.startsWith('-')) target = arg;
    else throw new Error(`unknown "fjs host eject" option: ${arg}`);
  }
  if (isEjected(root) && !force) {
    throw new Error(
      `already ejected to ${configuredFlutterDir(root)} — pass --force to move it again`,
    );
  }
  const dest = path.resolve(root, target);
  if (!isInside(root, dest)) {
    throw new Error(`${dest} is outside the project`);
  }
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    throw new Error(`${path.relative(root, dest)} is not empty`);
  }
  if (!fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
    // nothing to move: create it where it is going to live
    updateConfig(root, { flutterDir: path.relative(root, dest) });
    ensureFlutterHost(dest, projectName(root), true);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(dir, dest);
    repointRelativePaths(path.join(dest, 'pubspec.yaml'), dir, dest);
    updateConfig(root, { flutterDir: path.relative(root, dest) });
  }

  const shown = path.relative(root, dest);
  console.log(`moved ${path.relative(root, dir) || dir} -> ${shown}`);
  console.log(`package.json: fjs.flutterDir = ${JSON.stringify(shown)}`);
  console.log('');
  console.log('from now on fjs will not rewrite its pubspec.yaml or your lib/main.dart.');
  console.log('lib/fjs_autolink.dart and lib/fjs_attach.dart stay generated (module');
  console.log('changes autolink themselves); main.dart is only patched to call them.');
  console.log(`commit ${shown}/ — it is no longer under the ignored .fjs directory.`);
  console.log('fjs host sync --force re-applies the generated versions if you want them back.');
}

// --------------------------------------------------------------- sync

/** Rewrites relative `path:` dependency values after the host directory
 * moved. A generated pubspec points at in-repo packages (flutter_fjs, the
 * modules' Flutter packages) relative to the host's own location, so a
 * plain rename invalidates every one of them — `../../../packages/x` that
 * resolved from `.fjs/flutter` misses from `flutter/`. Resolving each value
 * against the old directory and re-relativizing against the new one keeps
 * it pointing at the same absolute target; a path inside the moved
 * directory comes out unchanged by the same math. */
export function repointRelativePaths(pubspec: string, oldDir: string, newDir: string): void {
  if (!fs.existsSync(pubspec)) return;
  const text = fs.readFileSync(pubspec, 'utf8');
  const next = text.replace(/^([ \t]*path:[ \t]*)(\S+)[ \t]*$/gm, (line, prefix: string, value: string) => {
    if (!value.startsWith('.')) return line;
    const absolute = path.resolve(oldDir, value);
    let rel = path.relative(newDir, absolute).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return `${prefix}${rel}`;
  });
  if (next !== text) fs.writeFileSync(pubspec, next);
}

function sync(root: string, dir: string, argv: string[]): void {
  let force = false;
  for (const arg of argv) {
    if (arg === '--force' || arg === '-f') force = true;
    else throw new Error(`unknown "fjs host sync" option: ${arg}`);
  }
  requireHost(dir);
  if (isEjected(root) && !force) {
    throw new Error(
      'this host is yours: sync would overwrite lib/main.dart, pubspec.yaml and the\n' +
        'Gradle patch with the generated versions. Pass --force if that is what you want.',
    );
  }
  ensureFlutterHost(dir, projectName(root), true, { forceMain: force });
  console.log(`synced ${path.relative(root, dir) || dir}`);
}

// ----------------------------------------------------------------- id

/** Only applicationId / PRODUCT_BUNDLE_IDENTIFIER change. The Gradle
 * `namespace` stays: it is the package of the generated R and BuildConfig
 * classes, and moving it means moving MainActivity.kt with it. */
function setBundleId(dir: string, argv: string[]): void {
  let id: string | undefined;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') dryRun = true;
    else if (!arg.startsWith('-') && !id) id = arg;
    else throw new Error(`unknown "fjs host id" option: ${arg}`);
  }
  requireHost(dir);
  const current = currentBundleId(dir);
  if (!id) {
    console.log(current ?? 'could not read the current id');
    return;
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(id)) {
    throw new Error(
      `"${id}" is not a valid application id: at least two dot-separated segments, ` +
        'each starting with a letter, letters/digits/underscore only',
    );
  }
  if (!current) throw new Error('could not read the current application id');
  if (current === id) {
    console.log(`already ${id}`);
    return;
  }

  const edits: Array<[string, string]> = [];
  const gradle = gradleFile(dir);
  if (gradle) {
    const source = fs.readFileSync(gradle, 'utf8');
    const next = source.replace(
      /(applicationId\s*=?\s*)(["'])[^"']+\2/,
      (_m, head: string, quote: string) => `${head}${quote}${id}${quote}`,
    );
    if (next !== source) edits.push([gradle, next]);
  }
  const pbxproj = path.join(dir, 'ios', 'Runner.xcodeproj', 'project.pbxproj');
  if (fs.existsSync(pbxproj)) {
    const source = fs.readFileSync(pbxproj, 'utf8');
    // covers the RunnerTests ids too: they are the app id plus a suffix
    const next = source.split(current).join(id);
    if (next !== source) edits.push([pbxproj, next]);
  }

  if (edits.length === 0) throw new Error(`nothing to change — ${current} not found`);
  for (const [file, contents] of edits) {
    if (!dryRun) fs.writeFileSync(file, contents);
    console.log(`${dryRun ? 'would update' : 'updated'} ${path.relative(process.cwd(), file)}`);
  }
  console.log(`${current} -> ${id}`);
  if (!dryRun) console.log('rebuild to pick it up; a changed id installs as a new app');
}

function gradleFile(dir: string): string | null {
  return [
    path.join(dir, 'android', 'app', 'build.gradle'),
    path.join(dir, 'android', 'app', 'build.gradle.kts'),
  ].find((file) => fs.existsSync(file)) ?? null;
}

function currentBundleId(dir: string): string | null {
  const gradle = gradleFile(dir);
  if (gradle) {
    const found = /applicationId\s*=?\s*["']([^"']+)["']/.exec(fs.readFileSync(gradle, 'utf8'));
    if (found) return found[1];
  }
  const pbxproj = path.join(dir, 'ios', 'Runner.xcodeproj', 'project.pbxproj');
  if (fs.existsSync(pbxproj)) {
    const text = fs.readFileSync(pbxproj, 'utf8');
    for (const m of text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)) {
      const value = m[1].trim();
      if (!value.endsWith('.RunnerTests')) return value;
    }
  }
  return null;
}

// ------------------------------------------------------------- helpers

function requireHost(dir: string): void {
  if (!fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
    throw new Error(
      `no Flutter host at ${path.relative(process.cwd(), dir) || dir} — ` +
        'create it with fjs host create',
    );
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function noOptions(sub: string, argv: string[]): void {
  for (const arg of argv) throw new Error(`unknown "fjs host ${sub}" option: ${arg}`);
}

export { DEFAULT_FLUTTER_DIR };
