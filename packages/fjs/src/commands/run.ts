// fjs run — ensure a Flutter host exists, start fjs dev, then `flutter run`.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBundle, engineDefineArgs, flutterModeArgs, releaseBuild, type BuildOptions } from '../bundler/build.js';
import { resolveAdb } from '../dev/adb.js';
import {
  autolinkDartModule,
  autolinkEntries,
  autolinkPubspecDeps,
  moduleDataDir,
  scanModules,
  type AutolinkEntry,
} from '../project/modules.js';
import {
  flutterDir as configuredFlutterDir,
  isEjected,
  readAppConfig,
  type AppConfig,
  type AppOrientation,
  type PlistValue,
} from '../project/config.js';
import { ENGINE_IDS, materializeJsEngine, resolveJsEngine, type JsEngine } from '../project/engine.js';
import { ensureOhosSigning } from '../project/ohos-signing.js';
import type { FlutterMode } from '../bundler/build.js';
import { lanAddresses } from '../dev/server.js';

type Platform = 'android' | 'ios' | 'ohos';

interface RunOptions {
  platform: Platform;
  device?: string;
  port: number;
  host: string;
  flutterDir: string;
  /** Flutter build mode. 'debug' is the live-editing shape (dev server +
   * JS source); 'profile' and 'release' bake the bytecode assets instead,
   * because an AOT app measured against a dev bundle is measuring the dev
   * path, not the one that ships. */
  mode: FlutterMode;
  pages: boolean;
  minify: boolean;
  gz: boolean;
  /** Which prebuilt engine flavor to materialize into the plugin before
   * flutter runs (spec 091). Bytecode in --release/--profile mode is
   * compiled by the matching fjsc. */
  jsEngine: JsEngine;
  /** True when the user passed --js-engine (vs env/default): a bad request
   * must fail loudly when there is no abi cache to materialize from. */
  jsEngineExplicit: boolean;
  flutterArgs: string[];
}

export async function runCommand(argv: string[]): Promise<void> {
  const opts = parseRunArgs(argv);
  const root = process.cwd();
  const flutterDir = path.resolve(root, opts.flutterDir);
  // resolved up front: no point building a bundle or starting the dev server
  // when there is nothing to run it on
  const device = resolveDevice(opts.platform, opts.device);

  if (opts.mode !== 'debug') {
    const buildOpts: BuildOptions = {
      // same per-target layout as `fjs build` (spec 047); the artifacts are
      // transient — releaseBuild copies them into the host's assets — but a
      // stale dist/bundle.js next to dist/app/ would only confuse
      outDir: 'dist/app',
      minify: opts.minify,
      bytecode: true,
      pages: opts.pages,
      web: false,
      mp: false,
      release: true,
      mode: opts.mode,
      gz: opts.gz,
      apk: false,
      hap: false,
      ipa: false,
      aab: false,
      jsEngine: opts.jsEngine,
      flutterDir: opts.flutterDir,
      flutterArgs: [],
    };
    const res = await buildBundle(buildOpts);
    releaseBuild(buildOpts, res);
    // non-debug host: the build layer leaves the debugger module out
    // (spec 105; the flag is informational now)
    materializeJsEngine(opts.jsEngine, {
      flutterDir,
      explicit: opts.jsEngineExplicit,
      debugger: false,
    });
    if (opts.platform === 'ohos') ensureOhosSigning(flutterDir, { interactive: process.stdout.isTTY === true });
    stopStaleApp(opts.platform, device.id, flutterDir);
    const args = [
      'run',
      ...flutterModeArgs(opts.mode, opts.flutterArgs),
      '-d',
      device.id,
      ...engineDefineArgs(opts.jsEngine),
      ...opts.flutterArgs,
    ];
    console.log(
      `fjs run ${opts.platform} --${opts.mode} — Flutter host: ${path.relative(root, flutterDir)}`,
    );
    console.log(`js engine: ${ENGINE_IDS[opts.jsEngine]}`);
    const status = spawnSync('flutter', args, {
      cwd: flutterDir,
      stdio: 'inherit',
    }).status;
    process.exit(status ?? 1);
  }

  ensureFlutterHost(flutterDir, projectName(root), !isEjected(root));
  materializeJsEngine(opts.jsEngine, { flutterDir, explicit: opts.jsEngineExplicit });
  // before the dev server: a missing signature would otherwise surface only
  // after hvigor has run for ~20s, with a dev server left to clean up
  if (opts.platform === 'ohos') ensureOhosSigning(flutterDir, { interactive: process.stdout.isTTY === true });

  const dev = await startDevServer(opts.port, opts.host);
  const cleanup = () => {
    if (!dev.child.killed) dev.child.kill('SIGTERM');
  };
  process.once('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      cleanup();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }

  const target = deviceAddress(opts.platform, dev.port, device);
  stopStaleApp(opts.platform, device.id, flutterDir);
  // no --debug: that is `flutter run`'s own default, and passing it would
  // override a `-- --profile` meant as "AOT host, but keep the live JS"
  const args = [
    'run',
    '-d',
    device.id,
    `--dart-define=FJS_DEV=${target}`,
    ...engineDefineArgs(opts.jsEngine),
    ...opts.flutterArgs,
  ];
  console.log(`fjs run ${opts.platform} — Flutter host: ${path.relative(root, flutterDir)}`);
  console.log(`js engine: ${ENGINE_IDS[opts.jsEngine]}`);
  console.log(`FJS_DEV=${target}`);
  const status = spawnSync('flutter', args, {
    cwd: flutterDir,
    stdio: 'inherit',
  }).status;
  cleanup();
  process.exit(status ?? 1);
}

function parseRunArgs(argv: string[]): RunOptions {
  const first = argv.shift();
  if (first !== 'android' && first !== 'ios' && first !== 'ohos') {
    throw new Error(
      'usage: fjs run <android|ios|ohos> [--release|--profile] [--no-minify] [--gz] ' +
        '[--device <id>] [--port <n>] [--flutter-dir <dir>] ' +
        '[--js-engine <primjs|quickjs>] [-- <flutter args>]',
    );
  }
  const opts: RunOptions = {
    platform: first,
    port: 38900,
    host: '0.0.0.0',
    flutterDir: configuredFlutterDir(),
    mode: 'debug',
    pages: true,
    minify: true,
    gz: false,
    // env fallback lives here; a bad FJS_JS_ENGINE fails before any build
    jsEngine: resolveJsEngine(),
    jsEngineExplicit: false,
    flutterArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      opts.flutterArgs = argv.slice(i + 1);
      break;
    }
    if (arg === '--device' || arg === '-d') opts.device = requireValue(argv, ++i, arg);
    else if (arg === '--port') opts.port = Number(requireValue(argv, ++i, arg));
    else if (arg === '--host') opts.host = requireValue(argv, ++i, arg);
    else if (arg === '--flutter-dir') opts.flutterDir = requireValue(argv, ++i, arg);
    else if (arg === '--js-engine') {
      // resolveJsEngine throws with the accepted list on a bad value
      opts.jsEngine = resolveJsEngine(requireValue(argv, ++i, arg));
      opts.jsEngineExplicit = true;
    }
    else if (arg === '--release') opts.mode = 'release';
    else if (arg === '--profile') opts.mode = 'profile';
    else if (arg === '--debug') opts.mode = 'debug';
    else if (arg === '--minify') opts.minify = true;
    else if (arg === '--no-minify') opts.minify = false;
    else if (arg === '--gz') opts.gz = true;
    else if (arg === '--pages') opts.pages = true;
    else if (arg === '--no-pages') opts.pages = false;
    else throw new Error(`unknown run option: ${arg}`);
  }
  return opts;
}

/** Creates the host if it is missing, then brings it up to date.
 *
 * `managed` is what `fjs host eject` turns off: a host the user has taken
 * ownership of keeps its own lib/main.dart, pubspec and Gradle edits, and
 * fjs only guarantees the asset directories and `pub get` — plus the
 * generated lib module (fjs_autolink.dart) and the attach-marker region of
 * main.dart, which stay fjs/project-owned either way. The default host
 * under `.fjs` is disposable, so its pubspec is regenerated every time;
 * its main.dart is only rewritten when missing (see syncHostMain).
 * [forceMain] re-applies the generated main.dart on a host that already
 * has one — what `fjs host sync --force` asks for. */
export function ensureFlutterHost(
  dir: string,
  name: string,
  managed = true,
  { forceMain = false }: { forceMain?: boolean } = {},
): void {
  const pubspec = path.join(dir, 'pubspec.yaml');
  // modules with a Flutter side: their pub dependency and their register()
  // call go into the generated host, the way RN autolinks a native module
  const autolink = autolinkEntries(process.cwd());
  if (!fs.existsSync(pubspec)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const packageName = dartPackageName(name);
    // ohos only when the flutter on PATH is the OpenHarmony fork — the
    // stock tool rejects the platform and would abort host creation
    const platforms = `android,ios${flutterSupportsOhos() ? ',ohos' : ''}`;
    const result = spawnSync('flutter', ['create', `--platforms=${platforms}`, '--project-name', packageName, dir], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error('flutter create failed');
    }
  }
  const libDir = path.join(dir, 'lib');
  if (managed) {
    const appConfig = readAppConfig(process.cwd());
    writeHostPubspec(pubspec, name, autolink, appConfig.version);
    writeHostAutolink(libDir, autolink);
    writeHostAttach(libDir, process.cwd());
    syncHostMain(path.join(libDir, 'main.dart'), name, forceMain);
    patchAndroidAbiFilters(dir);
    patchAndroidToolchain(dir);
    patchOhosEntryDebuggerFilter(dir);
    syncNativeHostConfig(dir, appConfig);
    removeDefaultWidgetTest(dir);
  } else {
    // An ejected host's pubspec and main.dart belong to the user, but the
    // generated lib modules do not: a module added after the eject must
    // autolink without the user redoing manual steps, and src/main.dart
    // stays the single source for the attach point. main.dart only gets
    // an idempotent patch so it keeps calling into them.
    writeHostAutolink(libDir, autolink);
    writeHostAttach(libDir, process.cwd());
    patchHostMain(path.join(libDir, 'main.dart'), name, autolink);
  }
  reportAutolink(autolink, managed);
  fs.mkdirSync(path.join(dir, 'assets', 'fjs', 'pages'), { recursive: true });
  syncModuleAssets(dir);
  const get = spawnSync('flutter', ['pub', 'get'], { cwd: dir, stdio: 'inherit' });
  if (get.status !== 0) throw new Error('flutter pub get failed');
}

/** Keeps the host's main.dart in one of three states, without ever clobbering
 * a user's edits silently:
 *
 * - missing → write the generated version;
 * - present but pre-042 (registers inlined in main()) → rewrite once. The
 *   old template never calls fjsRegisterModules, so leaving it would make
 *   every autolinked module silently stop registering (constitution V);
 * - present and current → keep it. The generated template has no fjs-owned
 *   volatility any more — the module list lives in fjs_autolink.dart and the
 *   project's code in fjs_attach.dart — so there is nothing left to
 *   regenerate over the user's head; `forceMain` (fjs host sync --force)
 *   re-applies the generated version explicitly. */
export function syncHostMain(file: string, appName: string, forceMain: boolean): void {
  if (!fs.existsSync(file)) {
    writeHostMain(file, appName);
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  // "current" needs both calls: a main with only one would keep a dead
  // reference to the other file, so it is treated as an older template.
  const current = text.includes('fjsRegisterModules(') && text.includes('await fjsAttachHost(');
  if (forceMain || !current) {
    writeHostMain(file, appName);
    console.log(
      forceMain
        ? 'host: rewrote lib/main.dart (--force)'
        : 'host: rewrote lib/main.dart (pre-autolink generated version)',
    );
  } else {
    console.log('host: kept lib/main.dart — your edits survive; "fjs host sync --force" regenerates it');
  }
}

/** Copies what the modules' prepare hooks generated into the host's assets.
 *
 * A module's Dart package cannot declare these: they are generated per app,
 * and node_modules is not a place to write. So they ride along as the host's
 * own assets, under a path the module's Dart side knows —
 * `assets/fjs/modules/<name>/<file>`. */
function syncModuleAssets(dir: string): string[] {
  const root = process.cwd();
  const dest = path.join(dir, 'assets', 'fjs', 'modules');
  fs.rmSync(dest, { recursive: true, force: true });
  const names: string[] = [];
  for (const mod of scanModules(root)) {
    const from = moduleDataDir(root, mod.name);
    if (!fs.existsSync(from) || fs.readdirSync(from).length === 0) continue;
    const short = mod.name.replace(/^@[^/]+\//, '');
    // .d.ts files are for the editor, not for the device
    fs.cpSync(from, path.join(dest, short), {
      recursive: true,
      filter: (src) => !src.endsWith('.d.ts'),
    });
    if (fs.readdirSync(path.join(dest, short)).length === 0) {
      fs.rmSync(path.join(dest, short), { recursive: true });
      continue;
    }
    names.push(short);
  }
  return names.sort();
}

/** Every directory under `assets/fjs/public/` that holds a file, as pubspec
 * asset entries.
 *
 * Flutter's asset globs do NOT recurse: `- assets/fjs/public/` picks up the
 * files directly in it and silently ignores `public/images/`. Missing one is
 * not a build error — it is a release build with an image that quietly does
 * not load, which is exactly the failure specs/017-local-image-assets set out
 * to remove, so every level is listed. */
export function publicAssetDirs(dir: string): string[] {
  const rootDir = path.join(dir, 'assets', 'fjs', 'public');
  const found: string[] = [];
  const walk = (abs: string, rel: string): void => {
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile())) found.push(rel);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(abs, entry.name), `${rel}${entry.name}/`);
      }
    }
  };
  if (!fs.existsSync(rootDir)) return found;
  walk(rootDir, 'assets/fjs/public/');
  return found.sort();
}

const ABI_FILTER_MARKER = '// fjs: honour --target-platform for plugin jniLibs';

/** Flutter drops support for old Android toolchains faster than a host
 * generated once by `flutter create` gets regenerated, so a host scaffolded
 * a few Flutter releases ago starts warning (and eventually failing) on
 * Gradle/AGP/KGP versions it was born with. These are the versions the
 * current stable template ships; the patch only ever moves versions up. */
const ANDROID_TOOLCHAIN = {
  gradle: '8.14',
  agp: '8.11.1',
  kotlin: '2.2.20',
};

/** Lift an already-scaffolded host's Android toolchain to ANDROID_TOOLCHAIN.
 * Idempotent, and a no-op on a host that is already newer — a user who
 * bumped past us does not get dragged back down. */
export function patchAndroidToolchain(dir: string): void {
  const android = path.join(dir, 'android');

  const wrapper = path.join(android, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  patchFile(wrapper, (source) =>
    source.replace(
      /(distributionUrl=.*?gradle-)(\d+(?:\.\d+)*)(-(?:all|bin)\.zip)/,
      (whole, head: string, version: string, tail: string) =>
        isOlder(version, ANDROID_TOOLCHAIN.gradle) ? `${head}${ANDROID_TOOLCHAIN.gradle}${tail}` : whole,
    ),
  );

  // The plugins block is `id "x" version "y"` in Groovy and
  // `id("x") version "y"` in the Kotlin DSL — one regex covers both by
  // treating the parentheses as optional.
  const settings = firstExisting([
    path.join(android, 'settings.gradle'),
    path.join(android, 'settings.gradle.kts'),
  ]);
  patchFile(settings, (source) =>
    pinPluginVersion(
      pinPluginVersion(source, 'com.android.application', ANDROID_TOOLCHAIN.agp),
      'org.jetbrains.kotlin.android',
      ANDROID_TOOLCHAIN.kotlin,
    ),
  );

  // AGP 8.11 warns on Java 8, and flutter_angle's own Android code is
  // compiled at 17 — matching it keeps the build quiet.
  patchFile(gradleFileForHost(dir), (source) =>
    source.replace(/JavaVersion\.VERSION_1_8/g, 'JavaVersion.VERSION_17'),
  );
}

function patchFile(file: string | null, patch: (source: string) => string): void {
  if (!file || !fs.existsSync(file)) return;
  const source = fs.readFileSync(file, 'utf8');
  const next = patch(source);
  if (next !== source) fs.writeFileSync(file, next);
}

function firstExisting(files: string[]): string | null {
  return files.find((file) => fs.existsSync(file)) ?? null;
}

function pinPluginVersion(source: string, pluginId: string, floor: string): string {
  const pattern = new RegExp(
    `(id\\s*\\(?\\s*["']${pluginId.replace(/\./g, '\\.')}["']\\s*\\)?\\s+version\\s+["'])(\\d+(?:\\.\\d+)*)(["'])`,
  );
  return source.replace(pattern, (whole, head: string, version: string, tail: string) =>
    isOlder(version, floor) ? `${head}${floor}${tail}` : whole,
  );
}

/** Numeric-segment compare; anything unparseable counts as older, so a host
 * carrying something exotic still gets moved onto a version we know works. */
function isOlder(version: string, floor: string): boolean {
  const left = version.split('.').map(Number);
  const right = floor.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (Number.isNaN(a)) return true;
    if (a !== b) return a < b;
  }
  return false;
}

// spec 115: libfjs_debugger.so (the pluggable CDP inspector) must not reach a
// release or profile HAP. The ohos flutter fork hands plugins to ohpm as
// `file:` SOURCE dependencies, not as HARs assembled with `-p buildMode`, so
// the buildModeBinder in flutter_fjs's own ohos/build-profile.json5 is never
// consulted — a release HAP of 0.1.6 carried the 433 KB module. What packages
// the HAP is the host's entry module, whose nativeLib filter applies to every
// .so merged in, so the filter lives here. Only a file without its own
// buildOptionSet / buildModeBinder is rewritten; merging into a user's
// binder is guesswork, so that case gets the snippet as a warning instead.
const OHOS_DEBUGGER_OPTION = 'fjs_no_debugger';

export function patchOhosEntryDebuggerFilter(
  dir: string,
  warn: (message: string) => void = (m) => console.warn(m),
): void {
  const file = path.join(dir, 'ohos', 'entry', 'build-profile.json5');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(OHOS_DEBUGGER_OPTION)) return;
  // profile only when the project defines that build mode: a binder naming
  // an unknown mode fails the hvigor build
  const root = path.join(dir, 'ohos', 'build-profile.json5');
  const modes = ['release'];
  if (fs.existsSync(root) && /"name"\s*:\s*"profile"/.test(fs.readFileSync(root, 'utf8'))) modes.push('profile');
  const anchor = text.search(/"targets"\s*:/);
  if (/"buildOptionSet"|"buildModeBinder"/.test(text) || anchor < 0) {
    warn(
      `fjs: ohos/entry/build-profile.json5 has its own build options, so release/profile HAPs may ` +
        `still ship libfjs_debugger.so. Add this to it (spec 115):\n${ohosDebuggerFilterSnippet(modes, '  ')}`,
    );
    return;
  }
  const lineStart = text.lastIndexOf('\n', anchor) + 1;
  const indent = text.slice(lineStart, anchor);
  fs.writeFileSync(file, text.slice(0, lineStart) + ohosDebuggerFilterSnippet(modes, indent) + text.slice(lineStart));
}

function ohosDebuggerFilterSnippet(modes: string[], indent: string): string {
  const i = indent;
  const binders = modes
    .map(
      (mode) =>
        `${i}  {\n${i}    "buildModeName": "${mode}",\n` +
        `${i}    "mappings": [{ "targetName": "default", "buildOptionName": "${OHOS_DEBUGGER_OPTION}" }]\n${i}  }`,
    )
    .join(',\n');
  return (
    `${i}// fjs (spec 115): release/profile HAPs leave the debugger module out\n` +
    `${i}"buildOptionSet": [\n` +
    `${i}  {\n${i}    "name": "${OHOS_DEBUGGER_OPTION}",\n` +
    `${i}    "nativeLib": { "filter": { "excludes": ["**/libfjs_debugger.so"] } }\n${i}  }\n` +
    `${i}],\n` +
    `${i}"buildModeBinder": [\n${binders}\n${i}],\n`
  );
}

// `flutter build apk --target-platform android-arm64` only selects which Flutter
// engine/app libraries are packaged; jniLibs coming from plugin AARs (libfjs.so,
// libdartjni.so) are still packaged for every ABI. Flutter passes the same value
// to Gradle as `-Ptarget-platform`, so drop the unwanted ABIs in the host.
//
// This has to be `packaging.jniLibs.excludes`, not `defaultConfig.ndk.abiFilters`:
// abiFilters governs what the app module's own native build produces, and leaves
// prebuilt .so files — the ones that come in from plugins — untouched. (AGP 8.11
// packaged all three ABIs with abiFilters correctly set to just arm64-v8a.)
//
// Which DSL the host speaks depends on the Flutter that scaffolded it: the
// template switched to Kotlin in 3.38, so both shapes are in the wild and a
// snippet in the wrong language would not even parse.
export function patchAndroidAbiFilters(dir: string): void {
  const file = gradleFileForHost(dir);
  if (!file) return;
  const kts = file.endsWith('.kts');
  // strip first, so a host carrying the older abiFilters snippet is migrated
  // rather than left with two blocks that disagree
  const source = removeMarkedBlock(fs.readFileSync(file, 'utf8'), ABI_FILTER_MARKER);
  const anchor = source.indexOf('android {');
  if (anchor < 0) return;
  const insertAt = source.indexOf('\n', anchor) + 1;
  const snippet = kts ? ABI_FILTER_SNIPPET_KTS : ABI_FILTER_SNIPPET_GROOVY;
  fs.writeFileSync(file, source.slice(0, insertAt) + snippet + source.slice(insertAt));
}

const ABI_FILTER_SNIPPET_GROOVY = `    ${ABI_FILTER_MARKER}
    if (project.hasProperty("target-platform")) {
        def fjsAbis = [
            "android-arm": "armeabi-v7a",
            "android-arm64": "arm64-v8a",
            "android-x64": "x86_64",
            "android-x86": "x86",
        ]
        def fjsKeep = project.property("target-platform").split(",")
            .collect { fjsAbis[it.trim()] }.findAll { it != null }
        if (!fjsKeep.isEmpty()) {
            packaging {
                jniLibs {
                    excludes += fjsAbis.values().findAll { !fjsKeep.contains(it) }
                        .collect { "lib/" + it + "/**" }
                }
            }
        }
    }

`;

const ABI_FILTER_SNIPPET_KTS = `    ${ABI_FILTER_MARKER}
    if (project.hasProperty("target-platform")) {
        val fjsAbis = mapOf(
            "android-arm" to "armeabi-v7a",
            "android-arm64" to "arm64-v8a",
            "android-x64" to "x86_64",
            "android-x86" to "x86",
        )
        val fjsKeep = (project.property("target-platform") as String)
            .split(",").mapNotNull { fjsAbis[it.trim()] }
        if (fjsKeep.isNotEmpty()) {
            packaging {
                jniLibs {
                    excludes += fjsAbis.values.filterNot { it in fjsKeep }.map { "lib/" + it + "/**" }
                }
            }
        }
    }

`;

/** Cuts out a `<marker>` line and the brace-balanced block that follows it,
 * so the snippet can be reshaped between releases without the host keeping a
 * stale copy. Returns the source unchanged when the marker is absent. */
function removeMarkedBlock(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) return source;
  const lineStart = source.lastIndexOf('\n', at) + 1;
  let depth = 0;
  let i = source.indexOf('{', at);
  if (i < 0) return source;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  let cut = source.indexOf('\n', i);
  cut = cut < 0 ? source.length : cut + 1;
  while (source.slice(cut).startsWith('\n')) cut += 1;
  return source.slice(0, lineStart) + source.slice(cut);
}

const ANDROID_CONFIG_START = '    <!-- fjs: configured permissions -->';
const ANDROID_CONFIG_END = '    <!-- fjs: end configured permissions -->';
const PLIST_CONFIG_START = '\t<!-- fjs: configured values -->';
const PLIST_CONFIG_END = '\t<!-- fjs: end configured values -->';

// sensorLandscape (not plain `landscape`) so a phone held the other way up
// still reads correctly — the iOS list below allows both directions too.
const ANDROID_ORIENTATION: Record<AppOrientation, string> = {
  portrait: 'portrait',
  landscape: 'sensorLandscape',
};

const IOS_ORIENTATIONS: Record<AppOrientation, string[]> = {
  portrait: ['UIInterfaceOrientationPortrait'],
  landscape: [
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ],
};

/** Upserts android:screenOrientation on the MainActivity <activity> opening
 * tag. An XML comment block cannot annotate an attribute, so — like the
 * Gradle applicationId — the template line is edited in place. A missing
 * activity is an error, not a silent skip: a racing game that ships
 * unlocked is broken in a way no one will trace back to the config. */
function patchManifestOrientation(source: string, orientation: AppOrientation): string {
  const value = ANDROID_ORIENTATION[orientation];
  let tagStart = source.indexOf('<activity');
  while (tagStart >= 0) {
    const tagEnd = source.indexOf('>', tagStart);
    if (tagEnd < 0) break;
    const tag = source.slice(tagStart, tagEnd + 1);
    if (/android:name="(?:[^"]*\.)?MainActivity"/.test(tag)) {
      const attr = `android:screenOrientation="${value}"`;
      if (/android:screenOrientation="[^"]*"/.test(tag)) {
        const next = tag.replace(/android:screenOrientation="[^"]*"/, attr);
        return source.slice(0, tagStart) + next + source.slice(tagEnd + 1);
      }
      // match the template's per-line attribute indent, whatever create used
      const indent = /\n([ \t]*)[^\n]*$/.exec(tag)?.[1] ?? '    ';
      const next = tag.replace(/(\/?)>$/, (_match, selfClose: string) =>
        `\n${indent}${attr}${selfClose}>`);
      return source.slice(0, tagStart) + next + source.slice(tagEnd + 1);
    }
    tagStart = source.indexOf('<activity', tagEnd);
  }
  throw new Error('could not find the MainActivity <activity> in AndroidManifest.xml while applying app.config orientation');
}

/** Rewrites the orientation arrays flutter create emits. They live outside
 * the managed block, and a plist with duplicate keys has undefined
 * behaviour — so the template arrays are edited in place, never appended
 * through the block channel. */
function patchPlistOrientations(source: string, orientation: AppOrientation): string {
  const entries = IOS_ORIENTATIONS[orientation]
    .map((name) => `\t\t<string>${name}</string>`)
    .join('\n');
  let replaced = 0;
  // the emitted block is normalized to tab indentation rather than echoing
  // the captured whitespace, so a re-sync also heals a mangled earlier pass
  const next = source.replace(
    /(<key>UISupportedInterfaceOrientations(~ipad)?<\/key>\s*<array>)([\s\S]*?)\s*<\/array>/g,
    (_match, head: string, _ipad: string, _body: string) => {
      replaced += 1;
      return `${head}\n${entries}\n\t</array>`;
    },
  );
  if (replaced === 0) {
    throw new Error('could not find UISupportedInterfaceOrientations in Info.plist while applying app.config orientation');
  }
  return next;
}

/** Applies only the native declarations owned by app.config.ts. Markers make
 * repeated managed-host generation deterministic while leaving Flutter's
 * generated files and user-owned declarations alone. */
export function syncNativeHostConfig(dir: string, config: AppConfig): void {
  const androidManifest = path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(androidManifest)) {
    let source = fs.readFileSync(androidManifest, 'utf8');
    if (config.orientation) {
      source = patchManifestOrientation(source, config.orientation);
    }
    const permissions = config.android?.permissions ?? [];
    const block = permissions.length > 0
      ? [
          ANDROID_CONFIG_START,
          ...permissions.map((permission) =>
            `    <uses-permission android:name="${escapeXml(permission)}"/>`,
          ),
          ANDROID_CONFIG_END,
        ].join('\n')
      : '';
    fs.writeFileSync(androidManifest, replaceManagedBlock(
      source,
      ANDROID_CONFIG_START,
      ANDROID_CONFIG_END,
      block,
      '</manifest>',
    ));
  }

  const gradle = gradleFileForHost(dir);
  if (config.android?.applicationId && gradle) {
    const source = fs.readFileSync(gradle, 'utf8');
    const next = source.replace(
      /(applicationId\s*=?\s*)(["'])[^"']+\2/,
      (_match, head: string, quote: string) =>
        `${head}${quote}${config.android!.applicationId}${quote}`,
    );
    if (next !== source) fs.writeFileSync(gradle, next);
  }

  const pbxproj = path.join(dir, 'ios', 'Runner.xcodeproj', 'project.pbxproj');
  if (config.ios?.bundleIdentifier && fs.existsSync(pbxproj)) {
    const source = fs.readFileSync(pbxproj, 'utf8');
    const next = source.replace(
      /(PRODUCT_BUNDLE_IDENTIFIER = )([^;]+)(;)/g,
      (_match, head: string, value: string, tail: string) =>
        `${head}${value.trim().endsWith('.RunnerTests')
          ? `${config.ios!.bundleIdentifier}.RunnerTests`
          : config.ios!.bundleIdentifier}${tail}`,
    );
    if (next !== source) fs.writeFileSync(pbxproj, next);
  }

  const plist = path.join(dir, 'ios', 'Runner', 'Info.plist');
  if (fs.existsSync(plist)) {
    let source = fs.readFileSync(plist, 'utf8');
    if (config.orientation) {
      source = patchPlistOrientations(source, config.orientation);
    }
    // iOS 14+ gates every connection to a LAN address behind the local
    // network permission, and an app WITHOUT this key is not prompted — the
    // system denies it outright and the connect fails as "No route to host"
    // (errno 65), which reads exactly like a wrong IP or a firewall. That is
    // the dev server's whole transport, so the key belongs to the toolchain,
    // not to each project's app.config.ts (which can still override it).
    const values: Record<string, PlistValue> = {
      NSLocalNetworkUsageDescription:
        'Connects to the fjs dev server on your local network to load and ' +
        'hot-reload the app bundle.',
      // iPad multitasking ignores orientation restrictions unless the app
      // opts out through UIRequiresFullScreen — without this key the lock
      // patched above silently does nothing on iPads (the generated host
      // keeps TARGETED_DEVICE_FAMILY "1,2"). A user-set key keeps winning.
      ...(config.orientation ? { UIRequiresFullScreen: true } : {}),
      ...(config.ios?.infoPlist ?? {}),
    };
    const block = Object.keys(values).length > 0
      ? [
          PLIST_CONFIG_START,
          ...Object.entries(values).flatMap(([key, value]) => [
            `\t<key>${escapeXml(key)}</key>`,
            `\t${plistXmlValue(value)}`,
          ]),
          PLIST_CONFIG_END,
        ].join('\n')
      : '';
    fs.writeFileSync(plist, replaceManagedBlock(source, PLIST_CONFIG_START, PLIST_CONFIG_END, block, '</dict>'));
  }
}

function gradleFileForHost(dir: string): string | null {
  return [
    path.join(dir, 'android', 'app', 'build.gradle'),
    path.join(dir, 'android', 'app', 'build.gradle.kts'),
  ].find((file) => fs.existsSync(file)) ?? null;
}

function replaceManagedBlock(
  source: string,
  start: string,
  end: string,
  block: string,
  before: string,
): string {
  let next = source;
  while (true) {
    const startAt = next.indexOf(start);
    if (startAt < 0) break;
    const lineStart = next.lastIndexOf('\n', startAt - 1) + 1;
    const endAt = next.indexOf(end, startAt);
    if (endAt < 0) break;
    const lineEnd = next.indexOf('\n', endAt);
    next = next.slice(0, lineStart) + next.slice(lineEnd < 0 ? next.length : lineEnd + 1);
  }
  if (!block) return next;
  const insertAt = next.lastIndexOf(before);
  if (insertAt < 0) throw new Error(`could not find ${before} while updating Flutter host`);
  const prefix = next.slice(0, insertAt).replace(/\s*$/, '');
  return `${prefix}\n${block}\n${next.slice(insertAt)}`;
}

function plistXmlValue(value: PlistValue): string {
  if (typeof value === 'string') return `<string>${escapeXml(value)}</string>`;
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (typeof value === 'number') return Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`;
  const entries = value.map((entry) => `\t\t${plistXmlValue(entry)}`).join('\n');
  return `<array>\n${entries}\n\t</array>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function removeDefaultWidgetTest(dir: string): void {
  fs.rmSync(path.join(dir, 'test', 'widget_test.dart'), { force: true });
}

/** What the autolink did — and, for a host the user owns, what still got
 * written: the generated lib modules are machine-owned either way, only
 * pubspec and main.dart are. */
function reportAutolink(entries: AutolinkEntry[], managed: boolean): void {
  if (entries.length === 0) return;
  if (managed) {
    for (const entry of entries) {
      console.log(`autolink: ${entry.flutter.package} <- module ${entry.module.name}`);
    }
    return;
  }
  console.log('autolink: rewrote lib/fjs_autolink.dart — the module list lives there, not in your main.dart');
  for (const entry of entries) {
    console.log(`  ${entry.flutter.package} <- module ${entry.module.name}`);
  }
}

/** The generated `lib/fjs_autolink.dart`: the module list's imports and
 * register() calls, rewritten on every run (managed or not). */
function writeHostAutolink(libDir: string, autolink: AutolinkEntry[]): void {
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, 'fjs_autolink.dart'), autolinkDartModule(autolink));
}

const DEFAULT_ATTACH = `// generated by fjs — do not edit.
//
// The project owns this file's content: a src/main.dart at the project root
// defining
//   Future<void> fjsAttachHost(FjsEngine engine) async { ... }
// is copied here verbatim on every run. This default is written when the
// project has no such file.
import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> fjsAttachHost(FjsEngine engine) async {}
`;

/** The generated `lib/fjs_attach.dart`: the project's src/main.dart when it
 * has one, the no-op default otherwise. Written on every run — the project
 * file is the single source of truth, for ejected hosts too. */
function writeHostAttach(libDir: string, root: string): void {
  fs.mkdirSync(libDir, { recursive: true });
  const from = path.join(root, 'src', 'main.dart');
  const dest = path.join(libDir, 'fjs_attach.dart');
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, dest);
  } else {
    fs.writeFileSync(dest, DEFAULT_ATTACH);
  }
}

/** Idempotently makes an ejected main.dart call the generated modules.
 *
 * Covers hosts generated before the autolink module existed: their register
 * calls were inlined in main(), so the patch removes those exact lines
 * (leaving both would register every module twice) and adds the import plus
 * the calls before the dev-environment read. A main.dart that is already
 * current — or one hand-written from scratch with no recognizable anchor —
 * is left alone. */
export function patchHostMain(file: string, appName: string, autolink: AutolinkEntry[]): void {
  if (!fs.existsSync(file)) {
    writeHostMain(file, appName);
    return;
  }
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes('fjsRegisterModules(') && text.includes('await fjsAttachHost(')) return;
  for (const entry of autolink) {
    if (!entry.register) continue;
    const line = `  ${entry.register.replace(/;\s*$/, '')};\n`;
    if (text.includes(line)) text = text.replace(line, '');
  }
  const imports = [...text.matchAll(/^import .*?;\n/gm)];
  if (imports.length === 0) {
    console.log('autolink: could not patch lib/main.dart — add "import \'fjs_autolink.dart\';" and a fjsRegisterModules(engine) call by hand');
    return;
  }
  const afterLastImport = imports[imports.length - 1].index! + imports[imports.length - 1][0].length;
  text = `${text.slice(0, afterLastImport)}import 'fjs_autolink.dart';\nimport 'fjs_attach.dart';\n${text.slice(afterLastImport)}`;
  const devAnchor = text.indexOf("  const dev = String.fromEnvironment('FJS_DEV');");
  const runAppAnchor = devAnchor >= 0 ? -1 : text.indexOf('  runApp(');
  const anchor = devAnchor >= 0 ? devAnchor : runAppAnchor;
  if (anchor < 0) {
    console.log('autolink: could not find a spot for fjsRegisterModules(engine) in lib/main.dart — call it before runApp');
    return;
  }
  const calls = '  fjsRegisterModules(engine);\n  await fjsAttachHost(engine);\n';
  text = `${text.slice(0, anchor)}${calls}${text.slice(anchor)}`;
  fs.writeFileSync(file, text);
  console.log('autolink: patched lib/main.dart to call fjsRegisterModules / fjsAttachHost');
}

export function writeHostPubspec(
  pubspec: string,
  appName: string,
  autolink: AutolinkEntry[] = [],
  version = '1.0.0+1',
): void {
  const flutterFjsPath = findFlutterFjsPackage();
  const dependency = flutterFjsPath
    ? `  flutter_fjs:\n    path: ${relativeYamlPath(path.dirname(pubspec), flutterFjsPath)}\n`
    : '  flutter_fjs: ^0.1.7\n';
  const linked = autolinkPubspecDeps(path.dirname(pubspec), autolink);
  // one entry per module directory: Flutter's asset globs are per directory,
  // and an empty one would fail `pub get`
  const moduleAssets = syncModuleAssets(path.dirname(pubspec))
    .map((name) => `    - assets/fjs/modules/${name}/\n`)
    .join('');
  // public/ and the bundler's emitted assets were copied in before this ran
  // (bundler/build.ts syncPublicAssets); list every level, glob is not
  // recursive
  const publicAssets = publicAssetDirs(path.dirname(pubspec))
    .map((rel) => `    - ${rel}\n`)
    .join('');
  // In a checkout the host depends on flutter_fjs by path, while a module's
  // Flutter package depends on the published one — two sources for the same
  // package, which pub refuses. The override says which copy wins, and only
  // exists while both are in play.
  const override =
    flutterFjsPath && autolink.length > 0
      ? `\ndependency_overrides:\n  flutter_fjs:\n    path: ${relativeYamlPath(
          path.dirname(pubspec),
          flutterFjsPath,
        )}\n`
      : '';
  fs.writeFileSync(
    pubspec,
    `name: ${dartPackageName(appName)}_host
description: "Generated Flutter host for ${appName}."
publish_to: 'none'
version: ${version}

environment:
  sdk: ^3.5.4

dependencies:
  flutter:
    sdk: flutter
${dependency}${linked}

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/fjs/
    - assets/fjs/pages/
${moduleAssets}${publicAssets}${override}`,
  );
}

/** The generated host's main.dart. Deliberately static: everything that
 * varies with the module list or the project lives in fjs_autolink.dart and
 * fjs_attach.dart, so this file can be "written when missing" and a user's
 * hand edits (extra host.register, plugin init) are never regenerated away. */
export function writeHostMain(file: string, appName: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:typed_data' show ByteData;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_fjs/flutter_fjs.dart';
import 'fjs_autolink.dart';
import 'fjs_attach.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final engine = FjsEngine();
  engine.onLog = (level, message) =>
      debugPrint('[js:\${FjsLogLevel.of(level).name}] $message');
  engine.host.register('device', (args) => {
        'platform': Platform.operatingSystem,
        'locale': Platform.localeName,
        'args': args,
      });
  fjsRegisterModules(engine);
  await fjsAttachHost(engine);
  const dev = String.fromEnvironment('FJS_DEV');
  if (dev.isEmpty) {
    // Release: assets, no network, no waiting worth showing a spinner for.
    await engine.loadReleaseAssets();
    runApp(_FjsHostApp(engine: engine, dev: ''));
    return;
  }
  // Dev: PAINT FIRST, connect after.
  //
  // Not a nicety. The bootstrap used to be awaited here, so a failed fetch
  // threw before runApp ever ran and the app was a black screen with one
  // uncaught SocketException in the console — nothing on the device said
  // anything at all. And on iOS it could not have succeeded anyway: the
  // first outbound request raises a system permission sheet, and a sheet
  // needs an app that is foregrounded WITH A UI. Painting first is what
  // lets the user answer it; DevClient's backoff is what picks the bundle
  // up afterwards, with no relaunch.
  runApp(_FjsHostApp(engine: engine, dev: dev));
  // Deliberately not awaited. Future.ignore() rather than unawaited(): the
  // latter needs a dart:async import that is not in scope in every host.
  engine.connectDevString(dev).ignore();
}

class _FjsHostApp extends StatelessWidget {
  const _FjsHostApp({required this.engine, required this.dev});

  final FjsEngine engine;
  final String dev;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${escapeDart(appName)}',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
      home: Scaffold(
        body: FjsApp(
          engine: engine,
          placeholder: _FjsPlaceholder(dev: dev),
        ),
      ),
    );
  }
}

/// Shown until the bundle arrives. In dev it names the server it is waiting
/// on: a spinner alone cannot tell "still starting" from "cannot reach the
/// dev server", and a failure nobody can see is a bug (constitution V).
class _FjsPlaceholder extends StatelessWidget {
  const _FjsPlaceholder({required this.dev});

  final String dev;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          if (dev.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(
              '连接 dev server \$dev 中…\\n连不上会自动重试，无需重启',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: Colors.black54),
            ),
          ],
        ],
      ),
    );
  }
}

extension on FjsEngine {
  Future<void> connectDevString(String value) async {
    final uri = Uri.parse(value.contains('://') ? value : 'http://$value');
    final host = uri.host;
    final port = uri.hasPort ? uri.port : 38900;
    if (host.isEmpty) {
      throw ArgumentError('FJS_DEV must be host:port, got "$value"');
    }
    await connectDev(host, port);
  }

  Future<ByteData> _loadFjsAsset(String path) => rootBundle.load(path);

  Future<Map<String, Object?>?> _loadReleaseManifest() async {
    try {
      final data = await rootBundle.loadString('assets/fjs/manifest.json');
      return (jsonDecode(data) as Map).cast<String, Object?>();
    } catch (_) {
      return null;
    }
  }

  Future<ByteData?> _tryLoadFjsAsset(String? path) async {
    if (path == null || path.isEmpty) return null;
    try {
      return await _loadFjsAsset(path);
    } catch (_) {
      return null;
    }
  }

  Future<void> loadReleaseAssets() async {
    final manifest = await _loadReleaseManifest();
    final pages = (manifest?['pages'] as Map?)?.cast<String, Object?>();
    chunkLoader = (chunk) async {
      final path = pages?[chunk]?.toString() ?? 'assets/fjs/pages/$chunk.fjsbundle';
      final data = await _tryLoadFjsAsset(path);
      return data?.toUint8List();
    };
    final shared = await _tryLoadFjsAsset(manifest?['shared']?.toString()) ??
        await _tryLoadFjsAsset('assets/fjs/shared.fjsbundle');
    if (shared != null) {
      addPrelude(shared.toUint8List());
    } else {
      // Single-bundle release, used by the pure TypeScript template.
    }
    final bundlePath = manifest?['bundle']?.toString() ?? 'assets/fjs/bundle.fjsbundle';
    final bundle = await _loadFjsAsset(bundlePath);
    runBundle(bundle.toUint8List());
    startEventLoop();
  }
}
`,
  );
}

export interface DevServerHandle {
  child: ChildProcess;
  port: number;
}

export interface DevPortProbe {
  fjsDevServerRoot(port: number): Promise<string | null>;
  canConnect(host: string, port: number): Promise<boolean>;
}

export interface DevPortSkip {
  port: number;
  reason: string;
}

export interface DevPortSelection {
  port: number;
  reuseExisting: boolean;
  skipped: DevPortSkip[];
}

// Keep the fallback finite so a broken local network stack fails with a useful range.
const DEV_PORT_MAX_ATTEMPTS = 50;

export async function selectDevServerPort(
  requestedPort: number,
  root = process.cwd(),
  probe: DevPortProbe = { fjsDevServerRoot, canConnect },
  maxAttempts = DEV_PORT_MAX_ATTEMPTS,
): Promise<DevPortSelection> {
  const skipped: DevPortSkip[] = [];
  const resolvedRoot = path.resolve(root);
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = requestedPort + offset;
    const existing = await probe.fjsDevServerRoot(port);
    if (existing && path.resolve(existing) === resolvedRoot) {
      return { port, reuseExisting: true, skipped };
    }
    if (existing) {
      skipped.push({
        port,
        reason: `already used by another fjs dev project: ${existing}`,
      });
      continue;
    }
    if (await probe.canConnect('127.0.0.1', port)) {
      skipped.push({ port, reason: 'already in use by another process' });
      continue;
    }
    return { port, reuseExisting: false, skipped };
  }
  const last = requestedPort + maxAttempts - 1;
  throw new Error(`no free fjs dev port found from ${requestedPort} to ${last}`);
}

async function startDevServer(port: number, host: string): Promise<DevServerHandle> {
  const selection = await selectDevServerPort(port);
  for (const skipped of selection.skipped) {
    console.warn(`fjs: port ${skipped.port} is ${skipped.reason}; trying ${skipped.port + 1}`);
  }
  port = selection.port;
  if (selection.reuseExisting) {
    console.log(`using existing fjs dev server on port ${port}`);
    return { child: { killed: true, kill: () => true } as ChildProcess, port };
  }

  const cli = process.argv[1];
  const child = spawn(process.execPath, [cli, 'dev', '--pages', '--port', String(port), '--host', host, '--no-qr'], {
    cwd: process.cwd(),
    // `fjs run` has already materialized the flavor (FJS_JS_ENGINE is in
    // this env); without the marker the child runs the engine runner a
    // second time and prints the same flavor line again
    env: { ...process.env, FJS_ENGINE_MATERIALIZED: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForPort(port, child);
  return { child, port };
}

function fjsDevServerRoot(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/manifest.json', timeout: 500 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const manifest = JSON.parse(body) as { entry?: unknown; root?: unknown };
            resolve(
              res.statusCode === 200 &&
                typeof manifest.entry === 'string' &&
                typeof manifest.root === 'string'
                ? path.resolve(manifest.root)
                : null,
            );
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

function waitForPort(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30000;
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (child.exitCode != null) {
        clearInterval(timer);
        reject(new Error(`fjs dev exited with ${child.exitCode}`));
        return;
      }
      canConnect('127.0.0.1', port).then((ok) => {
        if (ok) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`timed out waiting for fjs dev on port ${port}`));
        }
      }, reject);
    }, 200);
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** A device row from `flutter devices --machine`. */
export interface FlutterDevice {
  id: string;
  name: string;
  isSupported?: boolean;
  targetPlatform?: string;
  emulator?: boolean;
  sdk?: string;
}

/** Everything `flutter devices` knows, or [] when it could not be asked.
 * "no devices" and "no flutter" are the same answer to every caller here:
 * there is nothing to run on. */
export function listDevices(): FlutterDevice[] {
  const probe = spawnSync('flutter', ['devices', '--machine'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (probe.status !== 0 || !probe.stdout) return [];
  try {
    const parsed: unknown = JSON.parse(probe.stdout);
    return Array.isArray(parsed) ? (parsed as FlutterDevice[]) : [];
  } catch {
    return [];
  }
}

/** The devices `fjs run <platform>` will consider, most preferred first:
 * an emulator/simulator reaches the dev server on a host-local address,
 * while a physical device depends on the LAN being routable. */
export function devicesFor(platform: Platform, devices = listDevices()): FlutterDevice[] {
  return devices
    .filter(
      (d) =>
        d.isSupported !== false &&
        (platform === 'android'
          ? (d.targetPlatform ?? '').startsWith('android')
          : // the ohos fork reports 'ohos-arm64' (and 'ohos-x64' for its x86
            // emulator); prefix keeps both working
            platform === 'ohos'
            ? (d.targetPlatform ?? '').startsWith('ohos')
            : d.targetPlatform === 'ios'),
    )
    .sort((a, b) => Number(b.emulator === true) - Number(a.emulator === true));
}

/** Resolves the `-d` argument for `flutter run`.
 *
 * `flutter run -d ios` does not work: flutter matches -d against a device id or
 * name, and no iOS device is called "ios". So when the caller did not pass
 * --device we ask flutter for the device list and pick one on the requested
 * platform ourselves. */
export function resolveDevice(platform: Platform, explicit?: string): FlutterDevice {
  const devices = listDevices();

  if (explicit) {
    // trust the id the caller gave us even if the listing failed; looking it up
    // only tells us whether FJS_DEV can stay on a host-local address
    return devices.find((d) => d.id === explicit) ?? { id: explicit, name: explicit };
  }

  const onPlatform = devicesFor(platform, devices);

  if (onPlatform.length === 0) {
    const label =
      platform === 'android'
        ? 'Android emulator or device'
        : platform === 'ohos'
          ? 'HarmonyOS emulator or device'
          : 'iOS simulator or device';
    throw new Error(
      `no ${platform} device found. Start an ${label} (\`flutter emulators\`, ` +
        `\`open -a Simulator\`), or pass one explicitly:\n` +
        `  fjs run ${platform} -d <device-id>   (\`flutter devices\` lists them)`,
    );
  }

  // devicesFor already put emulators first
  const chosen = onPlatform[0];
  if (onPlatform.length > 1) {
    console.log(
      `fjs: ${onPlatform.length} ${platform} devices found, using ${chosen.name} (${chosen.id})`,
    );
    console.log(`     pass -d <device-id> to pick another`);
  }
  return chosen;
}

/** Force-stops a still-running instance of this app on the device before
 * `flutter run` reinstalls it (spec 088 regression: a `flutter run` that
 * died — terminal closed hard, "Lost connection to device" — leaves the app
 * process alive on Android, and the zombie keeps its `fjs debug` channel:
 * the relay serves one VM at a time, so the freshly launched app's attach is
 * rejected with an empty error and the session looks broken. The zombie also
 * fights the live app over dev-server reloads.) Best effort on purpose:
 * without a locatable adb (see dev/adb.ts) the debugger's attach retry
 * covers a surviving instance, so this just skips silently. */
function stopStaleApp(platform: Platform, deviceId: string, flutterDir: string): void {
  const id = hostBundleId(flutterDir);
  const adb = platform === 'android' ? resolveAdb() : null;
  if (!id || platform === 'ohos') return;
  if (platform === 'android' && adb) {
    spawnSync(adb, ['-s', deviceId, 'shell', 'am', 'force-stop', id], { stdio: 'ignore' });
  } else if (platform === 'ios' && process.platform === 'darwin') {
    spawnSync('xcrun', ['simctl', 'terminate', deviceId, id], { stdio: 'ignore' });
  }
}

/** The host app's applicationId / bundle identifier, read back from the
 * generated project — the same values `fjs host id` reports. */
function hostBundleId(flutterDir: string): string | null {
  for (const gradle of [
    path.join(flutterDir, 'android', 'app', 'build.gradle'),
    path.join(flutterDir, 'android', 'app', 'build.gradle.kts'),
  ]) {
    if (!fs.existsSync(gradle)) continue;
    const found = /applicationId\s*=?\s*["']([^"']+)["']/.exec(fs.readFileSync(gradle, 'utf8'));
    if (found) return found[1];
  }
  const pbxproj = path.join(flutterDir, 'ios', 'Runner.xcodeproj', 'project.pbxproj');
  if (fs.existsSync(pbxproj)) {
    for (const m of fs.readFileSync(pbxproj, 'utf8').matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)) {
      const value = m[1].trim();
      if (!value.endsWith('.RunnerTests')) return value;
    }
  }
  return null;
}

/** Where the app should look for `fjs dev`. An emulator reaches the host
 * through a fixed alias; a physical device has to come back over the LAN.
 * ohos gets no alias at all — its emulator dials the host like a physical
 * device would, so the LAN address is the only answer there. */function deviceAddress(platform: Platform, port: number, device: FlutterDevice): string {
  if (platform === 'ohos') {
    const lan = lanAddresses()[0];
    if (lan) return `${lan}:${port}`;
    console.warn('fjs: no LAN address found; the ohos device may not reach the dev server');
    return `127.0.0.1:${port}`;
  }
  if (device.emulator === false) {
    const lan = lanAddresses()[0];
    if (lan) return `${lan}:${port}`;
    console.warn('fjs: no LAN address found; a physical device may not reach the dev server');
  }
  if (platform === 'android') return `10.0.2.2:${port}`;
  return `127.0.0.1:${port}`;
}

/** True when the flutter on PATH is an OpenHarmony fork, i.e. understands
 * `flutter create --platforms=ohos`. Detected from the tool's own source
 * tree (only the fork adds packages/flutter_tools/lib/src/ohos) rather than
 * by invoking flutter — that would bootstrap the whole tool just to answer
 * a question about it. Anything unresolvable (version-manager shims, missing
 * flutter) answers false and every existing platform behaves as before. */
function flutterSupportsOhos(): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const probe = spawnSync(cmd, ['flutter'], { encoding: 'utf8' });
  const bin = probe.stdout?.split(/\r?\n/)[0]?.trim();
  if (!bin) return false;
  try {
    let dir = path.dirname(fs.realpathSync(bin));
    if (path.basename(dir) === 'bin') dir = path.dirname(dir);
    return fs.existsSync(path.join(dir, 'packages', 'flutter_tools', 'lib', 'src', 'ohos'));
  } catch {
    return false;
  }
}

function findFlutterFjsPackage(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', '..', 'flutter_fjs'),
    path.resolve(here, '..', '..', '..', 'packages', 'flutter_fjs'),
    path.resolve(process.cwd(), 'packages', 'flutter_fjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'pubspec.yaml'))) return candidate;
  }
  return null;
}

export function projectName(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name;
  } catch {
    // directory name fallback
  }
  return path.basename(root);
}

function dartPackageName(name: string): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  const prefixed = /^[a-z]/.test(safe) ? safe : `fjs_${safe}`;
  return prefixed || 'fjs_app';
}

function relativeYamlPath(from: string, to: string): string {
  let rel = path.relative(from, to).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('-')) throw new Error(`${flag} needs a value`);
  return value;
}

function escapeDart(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
