// fjs build — esbuild bundling + optional bytecode compilation via fjsc.
//
// Build shapes:
//   default           one self-contained bundle (runtime + app + pages)
//   --pages           split build: shared.js (prelude: vue + fjs + the app
//                     shell) + bundle.js (app entry) + pages/<id>.js, one
//                     chunk per route, so a page never re-ships the runtime
//   --web             browser build: DOM tag adapter + vue-router, one
//                     esbuild chunk per page, plus an index.html
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import { mpBuild } from '../mp/build.js';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import esbuild from 'esbuild';
import { WORKERS_DIR, writeWorkers } from '../project/workers.js';
import { ensureFlutterHost, projectName } from '../commands/run.js';
import {
  vueSfcPlugin,
  flutterAliases,
  webAliases,
  moduleDataPlugin,
  vuePinPlugin,
  webPinPlugin,
  pagesPlugin,
  pluginsPlugin,
  sharedBare,
  SHARED_BARE_BUILTIN,
  sharedStubPlugin,
  srcAliasPlugin,
} from './vue-plugin.js';
import { loadViteAppHooks, viteAppHooksPlugin } from '../project/vite-plugins.js';
import { pageChunkSource, pagesFor, writeRouteTypes, type PageRoute } from '../project/pages.js';
import { writeAssetTypes } from '../project/assets.js';
import { pluginsFor } from '../project/plugins.js';
import {
  moduleAliases,
  moduleDataDir,
  moduleNames,
  runModulePrepare,
  scanModules,
  widgetNativeTags,
  writeModuleTypes,
  type FjsModule,
} from '../project/modules.js';
import { printAnalysis } from './analyze.js';
import { firstFrameNodeWarnings } from './node-budget.js';
import { assetSourceWarnings } from './asset-check.js';
import { flutterDir as configuredFlutterDir, isEjected } from '../project/config.js';
import { formatLog } from '../terminal/colors.js';
import type { Loader, Metafile } from 'esbuild';

// ---- local assets ----------------------------------------------------------
//
// A page has three ways to name a file that ships with the repo, and all
// three end up as ONE shape so the Dart side needs only one rule
// (specs/017-local-image-assets):
//
//   import png from '@/assets/x.png'   -> '/assets/x-<hash>.png'
//   <image src="/images/x.png" />      -> '/images/x.png'   (public/, verbatim)
//   <image src="asset://images/x.png"/>-> '/images/x.png'   (the older spelling)
//
// i.e. **a root-absolute path**. Root-absolute and not relative: a relative
// src resolves against the current route, so `/comp/image` would ask for
// `/comp/images/x.png` and get the SPA's index.html back — a broken image
// with no error anywhere (constitution V).
//
// Where that path is fetched from is the host's business, not the page's:
// the browser serves it from the site root, and Flutter either asks the dev
// server for it or reads it out of `assets/fjs/public/` in a release build
// (lib/src/widgets/image.dart).
export const ASSET_LOADERS: Record<string, Loader> = {
  '.png': 'file',
  '.jpg': 'file',
  '.jpeg': 'file',
  '.gif': 'file',
  '.webp': 'file',
  '.svg': 'file',
  '.woff2': 'file',
  // glTF binary — three.js/GLTFLoader models (spec 023)
  '.glb': 'file',
};

/** Where the `file` loader writes, and what the importing code sees.
 *
 * `publicPath` and `assetNames` are concatenated, so the URL is exactly
 * `/assets/<name>-<hash>.<ext>`. That also forces `outdir` + `entryNames`
 * on every build that uses this: with `outfile`, `assetNames` is resolved
 * against the *outfile's* directory, so a page chunk at
 * `dist/pages/comp-image.js` would drop its images in `dist/pages/assets/`,
 * and spelling it `'../assets/[name]-[hash]'` only moves the `..` into the
 * URL (`/../assets/x.png`). */
export function assetOutputOptions(): {
  loader: Record<string, Loader>;
  assetNames: string;
  publicPath: string;
} {
  return {
    loader: { ...ASSET_LOADERS },
    assetNames: 'assets/[name]-[hash]',
    publicPath: '/',
  };
}

/** Flutter / QuickJS is neither Node nor a browser. `platform: 'neutral'`
 * turns off both default sets — including `mainFields`. Without putting
 * `module` / `main` back, a package that only declares those (no root
 * `index.js`) dies with `Could not resolve`. echarts happens to ship
 * `index.js`; `@antv/f2` only has `es/index.js` via `"module"`. */
export function flutterEsbuildPlatform(): {
  platform: 'neutral';
  mainFields: string[];
} {
  return { platform: 'neutral', mainFields: ['module', 'main'] };
}

// One name per line is fine — the list only changes when node itself does.
const BUILTIN_STUB_JS = `
module.exports = new Proxy({}, {
  get: function (_target, prop) {
    if (prop === '__esModule') return false;
    return function () {
      throw new Error(
        'node built-in "' + String(prop) + '" is not available on the fjs host',
      );
    };
  },
});
`.trim();

/** Stub every node built-in so npm deps that reach for one still bundle
 * (spec 058). `platform: 'neutral'` refuses to resolve builtins at all, so a
 * single deep `require('util')` — @pixi/utils → url → qs → side-channel →
 * object-inspect — failed the whole app build, and the web target's
 * `platform: 'browser'` rejects them just the same (the QuickJS host offers
 * none of them either way). Real polyfills are out of scope: every property
 * read hands back a call-time-throwing function, which keeps the common
 * patterns working — eager named re-exports, feature sniffing,
 * `require('util').inspect` stored but never called — while actual use fails
 * loudly instead of silently misbehaving (constitution V). */
export function nodeBuiltinStubs(): esbuild.Plugin {
  const names = builtinModules.filter((name) => !name.startsWith('_'));
  const filter = new RegExp(
    `^(?:node:)?(?:${names.join('|')})(?:/.*)?$`,
  );
  return {
    name: 'fjs-node-builtin-stubs',
    setup(build) {
      build.onResolve({ filter }, (args) => ({
        path: args.path,
        namespace: 'fjs-builtin-stub',
      }));
      build.onLoad({ filter: /.*/, namespace: 'fjs-builtin-stub' }, () => ({
        contents: BUILTIN_STUB_JS,
        loader: 'js',
      }));
    },
  };
}

/** The directory `assetOutputOptions()` writes into, under a build's outDir. */
export const ASSET_DIR = 'assets';

export type FlutterMode = 'debug' | 'profile' | 'release';

/** `--<mode>` for a `flutter build`/`flutter run`, unless the caller
 * already passed one after `--`. Flutter refuses more than one build-mode
 * flag, so injecting ours unconditionally would break the documented
 * `npm run build:apk -- --debug` passthrough. */
export function flutterModeArgs(mode: FlutterMode, flutterArgs: string[]): string[] {
  const explicit = ['--debug', '--profile', '--release', '--jit-release'];
  return flutterArgs.some((arg) => explicit.includes(arg)) ? [] : [`--${mode}`];
}

export interface BuildOptions {
  entry?: string;
  outDir: string;
  /** Minify the bundles. Default true for `fjs build`; `fjs dev` turns it
   * off so the served bundle stays readable in a stack trace. */
  minify: boolean;
  bytecode: boolean;
  /** '--pages': shared prelude + app entry + one chunk per route. */
  pages: boolean;
  /** '--web': browser build (DOM adapter + vue-router). */
  web: boolean;
  /** '--mp': WeChat mini-program build (skyline + glass-easel). */
  mp: boolean;
  /** Production build: bytecode + copy split assets into Flutter. */
  release: boolean;
  /** Build mode handed to `flutter build`. --profile bakes the same
   * release assets as --release and only changes this. */
  mode: FlutterMode;
  /** With --release, gzip .fjsbundle assets copied into Flutter. */
  gz: boolean;
  /** With --release, the prefix the manifest writes before each program
   * file. `assets/fjs/` (the default) is the Flutter asset key an embedded
   * host loads; `--root-path .` writes paths relative to the manifest
   * itself, for serving assets/fjs from a web server (fjs go's hosted
   * mode, the showcase). */
  rootPath?: string;
  /** With --release, also run `flutter build apk`. */
  apk: boolean;
  /** With --release, also run `flutter build hap` (OpenHarmony fork only). */
  hap: boolean;
  /** With --release, also run `flutter build ipa` (macOS only; export
   * needs signing config — a failed export leaves the .xcarchive behind). */
  ipa: boolean;
  /** With --release, also run `flutter build appbundle` (.aab for Play). */
  aab: boolean;
  /** Flutter host project dir used by --release/--apk. */
  flutterDir: string;
  /** Extra args passed to `flutter build apk` after `--`. */
  flutterArgs: string[];
  /** '--analyze': keep esbuild's metafile and print a size report. */
  analyze?: boolean;
  /** Dev split builds only (spec 037): build one file per shared app
   * module — the "units" — so `fjs dev` can hot-swap a module in the
   * running VM instead of rebuilding it. Never set for release: the
   * bytecode/asset pipeline stays exactly the shape it always was. */
  units?: boolean;
  /** spec 090: bundle the DevTools data plane (`__fjsDevtools` — element
   * tree / fetch rows the `fjs debug` relay evaluates for the Elements and
   * Network panels). `fjs dev` sets it; `fjs build` opts in with
   * `--devtools`. Without it the define is false and esbuild drops the
   * whole data plane from the output. */
  devtools?: boolean;
}

/** An entry esbuild reads straight from memory.
 *
 * The shared chunk and every page chunk are built from a few generated
 * lines. Writing those into outDir as `.<name>-entry.ts` files made two
 * concurrent builds — a second `fjs dev` on the same project, or several
 * dev requests at once — delete each other's entry mid-build
 * (`Could not resolve ".../.<name>-entry.ts"`). Feeding the source in
 * directly also keeps a chunk byte-identical between builds, which is what
 * lets `fjs dev` tell which chunks an edit really changed.
 *
 * [name] only names the module in the bundle's comments, so it must stay
 * stable across builds.
 */
function generatedEntry(
  contents: string,
  resolveDir: string,
  name: string,
): esbuild.StdinOptions {
  return { contents, resolveDir, sourcefile: `fjs-entry/${name}.ts`, loader: 'ts' };
}

/** Where an embedded host finds the release program: its Flutter assets. */
export const RELEASE_ROOT_PATH = 'assets/fjs/';

/** `--root-path` as the prefix the manifest paths start with: `.` (or an
 * empty value) means relative to the manifest, anything else gets exactly
 * one trailing slash. */
export function releasePathPrefix(rootPath: string): string {
  const trimmed = rootPath.trim().replace(/^\.\/?$/, '').replace(/\/+$/, '');
  return trimmed ? `${trimmed}/` : '';
}

export function parseBuildArgs(argv: string[]): BuildOptions {
  const opts: BuildOptions = {
    outDir: 'dist',
    // on by default, like `vite build`; `fjs dev` passes minify: false
    minify: true,
    bytecode: false,
    pages: false,
    web: false,
    mp: false,
    release: false,
    mode: 'release',
    gz: false,
    rootPath: RELEASE_ROOT_PATH,
    apk: false,
    hap: false,
    ipa: false,
    aab: false,
    flutterDir: configuredFlutterDir(),
    flutterArgs: [],
    analyze: false,
    devtools: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts.flutterArgs = argv.slice(i + 1);
      break;
    }
    if (a === '--bytecode') opts.bytecode = true;
    else if (a === '--release') opts.release = true;
    else if (a === '--profile') {
      // same assets as --release; only the Flutter step differs
      opts.release = true;
      opts.mode = 'profile';
    }
    else if (a === '--apk') opts.apk = true;
    else if (a === '--hap') opts.hap = true;
    else if (a === '--ipa') opts.ipa = true;
    else if (a === '--aab') opts.aab = true;
    else if (a === '--minify') opts.minify = true;
    else if (a === '--no-minify') opts.minify = false;
    else if (a === '--gz') opts.gz = true;
    else if (a === '--root-path' || a === '--rootPath') {
      opts.rootPath = argv[++i] ?? RELEASE_ROOT_PATH;
    }
    else if (a === '--out') opts.outDir = argv[++i] ?? opts.outDir;
    else if (a === '--flutter-dir') opts.flutterDir = argv[++i] ?? opts.flutterDir;
    else if (a === '--analyze') opts.analyze = true;
    else if (a === '--pages') opts.pages = true;
    else if (a === '--devtools') opts.devtools = true;
    else if (a === '--web') opts.web = true;
    else if (a === '--mp') opts.mp = true;
    else if (a === '--shared-runtime' || a === '--shared') {
      throw new Error(`${a} was removed; use --pages --release for app release builds`);
    }
    else if (!a.startsWith('-')) opts.entry = a;
  }
  // spec 090: the DevTools data plane ships only where the build opts in
  setDevtoolsBundling(opts.devtools === true);
  // Per-target output layout (spec 047): app builds land in <outDir>/app and
  // web builds in <outDir>/web (buildWeb appends it), so the two targets
  // never clobber each other's artifacts — and a third target (miniprogram,
  // dist/mp) has a slot to grow into. --out sets the root, not the exact dir.
  // Here rather than in buildCommand because `fjs dev` shares this parser:
  // its output must land where `fjs build` puts it, or `fjs run` (which
  // spawns dev) would still scatter pages into dist/ next to dist/app.
  // --mp is exempt the same way: it emits <out>/mp (spec 046).
  if (!opts.web && !opts.mp) opts.outDir = path.join(opts.outDir, 'app');
  return opts;
}

const VUE_DEFINES = {
  'process.env.NODE_ENV': '"production"',
  __VUE_OPTIONS_API__: 'true',
  __VUE_PROD_DEVTOOLS__: 'false',
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
};

/** spec 090: set from the build options before any esbuild call — the
 * DevTools data plane is bundled only where this is true. */
let devtoolsBundling = false;
export function setDevtoolsBundling(v: boolean): void {
  devtoolsBundling = v;
}
/** Per-build define set: VUE_DEFINES plus the devtools gate. The web build
 * forces the gate off (the browser has its own DevTools). */
function fjsDefines(forceOff = false): Record<string, string> {
  return {
    ...VUE_DEFINES,
    __FJS_DEVTOOLS__: String(devtoolsBundling && !forceOff),
  };
}

export interface BuildResult {
  jsPath: string;
  bytecodePath?: string;
  /** Split builds: the shared prelude and the per-page chunks. */
  sharedPath?: string;
  sharedBytecodePath?: string;
  pageChunks?: Record<string, string>;
  pageBytecodeChunks?: Record<string, string>;
  /** Dev split builds with `units` (spec 037): the per-module files and
   * the import graph the dev server hot-swaps against. */
  devUnits?: DevUnitsInfo;
  /** '--analyze' only: esbuild metafiles keyed by the js file they built. */
  metafiles?: Record<string, Metafile>;
  warnings: string[];
}

/** The dev unit graph (spec 037). A unit id is the module's path relative
 * to the project root, posix separators ('src/components/panel.vue').
 *
 * `importers`/`pageDeps`/`order` drive `changeMessage()`: which units a
 * swap has to re-evaluate, which page chunks have to re-evaluate (their
 * bundled code captured the old exports at eval time), and in which order
 * to list them so dependencies come first. */
export interface DevUnitsInfo {
  /** unit id -> built file (absolute). */
  files: Record<string, string>;
  /** direct importers per unit: other unit ids, 'bundle', 'page:<chunk>'. */
  importers: Record<string, string[]>;
  /** transitive unit closure per page chunk (dependencies first). */
  pageDeps: Record<string, string[]>;
  /** every unit, dependencies first. */
  order: string[];
}

export async function buildBundle(opts: BuildOptions): Promise<BuildResult> {
  const root = process.cwd();
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  // the modules' own build steps first: they generate what the bundle then
  // imports, and what the generated types describe
  await runModulePrepare(process.cwd(), opts.web ? 'web' : 'app');
  // route names and module surfaces as types, before anything reads them
  writeRouteTypes(process.cwd());
  writeModuleTypes(process.cwd());
  // what public/ and html/ hold, as types the editor can complete
  writeAssetTypes(process.cwd());

  const exclusive = [opts.pages, opts.web].filter(Boolean);
  if (exclusive.length > 1) {
    throw new Error('--web and --pages are mutually exclusive');
  }
  const targetPages = pagesFor(root, opts.web ? 'web' : 'app');
  const perfWarnings = [
    ...firstFrameNodeWarnings(root, targetPages),
    // a literal local src that names no file: the types cannot catch this
    // one, see bundler/asset-check.ts
    ...assetSourceWarnings(root, targetPages),
  ];
  if (opts.web) {
    const res = await buildWeb(opts, outDir);
    res.warnings.unshift(...perfWarnings);
    // worker scripts next to the page, at the root path `new Worker` takes
    await writeWorkers(root, path.join(outDir, 'web'), { minify: opts.minify });
    return res;
  }
  // Flutter fetches a worker by its root path: from the dev server, or from
  // assets/fjs/public once syncPublicAssets has copied <outDir>/workers
  await writeWorkers(root, outDir, { minify: opts.minify });
  // Nothing to split when the project has no routes: the shared prelude is
  // defined as "vue + fjs + the app's own modules", so a page-less project
  // (a plain-JS app like `examples/hello-js`) would get all of Vue bundled
  // into a chunk it never calls. Fall through to the single bundle instead.
  if (opts.pages && pagesFor(root, 'app').length > 0) {
    const res = await buildPages(opts, outDir);
    res.warnings.unshift(...perfWarnings);
    return res;
  }

  const baseName = 'bundle';
  const jsPath = path.join(outDir, `${baseName}.js`);
  const entry = path.resolve(opts.entry ?? 'src/main.ts');
  const modules = scanModules(root);
  const appHooks = await loadViteAppHooks(root);
  // single bundle: every page is imported straight into it
  const plugins = [
    nodeBuiltinStubs(),
    pagesPlugin(pagesFor(root, 'app'), 'app', true),
    pluginsPlugin(pluginsFor(root, 'app'), modules),
    vueSfcPlugin({ nativeTags: widgetNativeTags(modules, 'app') }),
    vuePinPlugin(),
    viteAppHooksPlugin(appHooks),
    srcAliasPlugin(root),
    moduleDataPlugin(root, modules),
  ];
  const alias = { ...flutterAliases(), ...moduleAliases(root, modules) };
  if (!fs.existsSync(entry)) {
    throw new Error(`entry not found: ${entry}`);
  }

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    // outdir + entryNames rather than `outfile`, so imported assets land in
    // <outDir>/assets and the URL stays /assets/… — see assetOutputOptions()
    outdir: outDir,
    entryNames: baseName,
    format: 'iife',
    target: 'es2019', /* PrimJS engine (spec 088) */
    ...flutterEsbuildPlatform(),
    minify: opts.minify,
    alias,
    plugins,
    define: fjsDefines(),
    ...assetOutputOptions(),
    metafile: opts.analyze,
    logLevel: 'warning',
    legalComments: 'none',
  });
  const warnings = [...perfWarnings, ...result.warnings.map((w) => w.text)];

  const res: BuildResult = { jsPath, warnings };
  if (result.metafile) res.metafiles = { [jsPath]: result.metafile };
  if (opts.bytecode) {
    res.bytecodePath = compileBytecode(jsPath, outDir, baseName);
  }
  return res;
}

// ---- split build (--pages) -------------------------------------------------

/** Source of the shared-chunk entry. [appModules] are the project's own
 * modules that the app entry pulls in (shell, components, stores): putting
 * them in the shared chunk is what keeps a page chunk down to the page. */
function sharedEntrySource(
  appModules: Map<string, string> = new Map(),
  extraShared: string[] = [],
): string {
  const lines = [
    "import * as vue from 'vue';",
    "import * as fjs from 'fjs';",
    "import * as fjsVue from 'fjs/vue';",
    "import * as fjsRouter from 'fjs/router';",
    "import * as fjsApp from 'fjs/app';",
    "import * as fjsPages from 'fjs/pages';",
    "import * as fjsPlugins from 'fjs/plugins';",
    "import * as runtimeCore from '@vue/runtime-core';",
    "import * as reactivity from '@vue/reactivity';",
    "import * as shared from '@vue/shared';",
  ];
  const registrations = [
    "  vue, fjs, 'fjs/vue': fjsVue, 'fjs/router': fjsRouter,",
    "  'fjs/app': fjsApp, 'fjs/pages': fjsPages, 'fjs/plugins': fjsPlugins,",
    "  '@vue/runtime-core': runtimeCore, '@vue/reactivity': reactivity,",
    "  '@vue/shared': shared,",
  ];
  // `fjs.shared` from package.json: third-party packages that page chunks
  // import directly and that must stay a single module instance.
  const extra: string[] = [];
  extraShared.forEach((id, n) => {
    lines.push(`import * as __s${n} from ${JSON.stringify(id)};`);
    extra.push(
      `S[${JSON.stringify(id)}] = Object.assign({ __esModule: true }, __s${n});`,
    );
  });
  let i = 0;
  for (const [key, abs] of appModules) {
    lines.push(`import * as __m${i} from ${JSON.stringify(abs)};`);
    // __esModule marks the namespace copy as ESM so a `import X from` in a
    // page chunk gets X, not { default: X }
    extra.push(
      `S[${JSON.stringify(key)}] = Object.assign({ __esModule: true }, __m${i});`,
    );
    i++;
  }
  return `${lines.join('\n')}\nconst S = {\n${registrations.join(
    '\n',
  )}\n};\n${extra.join('\n')}\n(globalThis).__FJS_SHARED = S;\n`;
}

/** Decides which of the app's own modules belong in the shared chunk.
 *
 * A module goes in when the app entry pulls it in (the shell, its
 * components, stores) or when two or more pages import it (Panel.vue in
 * hello-fjs) — those are exactly the modules that would otherwise be
 * duplicated into every page chunk. Page files themselves never go in:
 * they *are* the chunks.
 *
 * One probe build with every entry point at once gives esbuild's metafile
 * an inputs list per output, which is all this needs.
 */
async function appModuleGraph(
  entry: string,
  root: string,
  pages: PageRoute[],
  fjsModules: FjsModule[],
): Promise<Map<string, string>> {
  const pageFiles = new Set(pages.map((p) => p.file));
  const appHooks = await loadViteAppHooks(root);
  const probe = await esbuild.build({
    entryPoints: [entry, ...pages.map((p) => p.file)],
    bundle: true,
    write: false,
    metafile: true,
    outdir: path.join(root, '.fjs-probe'),
    // pin esbuild's cwd: the metafile's input paths are read back relative
    // to it, and the esbuild service may outlive a chdir (a test worker, a
    // long-lived dev server) — without this, isAppModule's path.resolve
    // against the Node cwd silently mismatches and the graph comes out empty
    absWorkingDir: root,
    format: 'iife',
    target: 'es2019', /* PrimJS engine (spec 088) */
    ...flutterEsbuildPlatform(),
    alias: { ...flutterAliases(), ...moduleAliases(root, fjsModules) },
    plugins: [
      nodeBuiltinStubs(),
      pagesPlugin(pages, 'app', false),
      pluginsPlugin(pluginsFor(root, 'app'), fjsModules),
      vueSfcPlugin({ nativeTags: widgetNativeTags(fjsModules, 'app') }),
      vuePinPlugin(),
      viteAppHooksPlugin(appHooks),
      srcAliasPlugin(root),
      moduleDataPlugin(root, fjsModules),
    ],
    define: fjsDefines(),
    // write:false, so this never emits an asset — but without the loaders it
    // fails on the first `import png from …` and the split build dies before
    // it starts
    loader: { ...ASSET_LOADERS },
    logLevel: 'silent',
  });

  // Code extensions only: anything else (imported assets — .glb/.png/… —
  // JSON data) must stay INLINE where it is imported, exactly like the
  // classic build. A pure-asset module must never become a unit: esbuild's
  // CJS output for a file-loader entry assigns no `module.exports` at all,
  // so the factory would return undefined and the importer would fetch
  // `undefined` as a URL (spec 038: the glTF viewer shipped "bad magic").
  const CODE_EXTS = new Set([
    '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue',
  ]);

  const isAppModule = (input: string): string | null => {
    // esbuild reports virtual modules as "<namespace>:<path>" — the
    // generated route table and the shared stubs, not app files
    if (input.includes(':')) return null;
    const abs = path.resolve(input);
    if (!abs.startsWith(root + path.sep)) return null;
    if (abs.includes(`${path.sep}node_modules${path.sep}`)) return null;
    if (abs === entry || pageFiles.has(abs)) return null;
    if (!CODE_EXTS.has(path.extname(abs))) return null;
    return fs.existsSync(abs) ? abs : null;
  };

  const shared = new Set<string>();
  const pageUse = new Map<string, number>();
  for (const output of Object.values(probe.metafile.outputs)) {
    const fromEntry = output.entryPoint && path.resolve(output.entryPoint) === entry;
    for (const input of Object.keys(output.inputs)) {
      const abs = isAppModule(input);
      if (!abs) continue;
      if (fromEntry) shared.add(abs);
      else pageUse.set(abs, (pageUse.get(abs) ?? 0) + 1);
    }
  }
  for (const [abs, uses] of pageUse) {
    if (uses > 1) shared.add(abs);
  }

  const modules = new Map<string, string>();
  for (const abs of [...shared].sort()) {
    modules.set('./' + path.relative(root, abs).replace(/\\/g, '/'), abs);
  }
  return modules;
}

async function buildPages(opts: BuildOptions, outDir: string): Promise<BuildResult> {
  const root = process.cwd();
  const entry = path.resolve(opts.entry ?? 'src/main.ts');
  if (!fs.existsSync(entry)) throw new Error(`entry not found: ${entry}`);
  const pages = pagesFor(root, 'app');
  const warnings: string[] = [];
  const modules = scanModules(root);
  const appHooks = await loadViteAppHooks(root);
  const unitsMode = opts.units === true;

  // 1) which of the app's modules belong in the shared chunk
  const appModules = await appModuleGraph(entry, root, pages, modules);
  // an fjs module is shared by name like any other stateful library: page
  // chunks import 'test', the shared chunk owns the one instance of it
  const shared = [...sharedBare(root), ...moduleNames(modules)];
  const extraShared = shared.filter((id) => !SHARED_BARE_BUILTIN.includes(id));

  // dev units bookkeeping (spec 037): sharedStubPlugin reports every
  // app-module stub it materializes, tagged with the build that made it —
  // that is the import graph the dev server hot-swaps against. In units
  // mode the shared chunk stops carrying app modules; each becomes its own
  // unit file instead (built after the pages below).
  const depsOf = new Map<string, Set<string>>();
  const addDep = (owner: string, dep: string) => {
    if (owner === dep) return;
    const set = depsOf.get(owner) ?? new Set<string>();
    set.add(dep);
    depsOf.set(owner, set);
  };
  const absToId = new Map(
    [...appModules].map(([key, abs]) => [abs, key.slice('./'.length)] as const),
  );
  const pageToChunk = new Map(pages.map((p) => [p.file, p.chunk] as const));
  const ownerFallback = { current: 'bundle' };
  const recordStub = (importer: string, id: string) => {
    const abs = path.resolve(importer);
    let owner: string | undefined = absToId.get(abs);
    if (!owner && abs === entry) owner = 'bundle';
    if (!owner) {
      const chunk = pageToChunk.get(abs);
      if (chunk) owner = `page:${chunk}`;
    }
    // a real file none of the maps know is one the owning build bundled
    // (a page's exclusive submodule) — the fallback names that build
    addDep(owner ?? ownerFallback.current, id);
  };
  const stubbed = (): esbuild.Plugin[] => [
    nodeBuiltinStubs(),
    vueSfcPlugin({ nativeTags: widgetNativeTags(modules, 'app') }),
    viteAppHooksPlugin(appHooks),
    sharedStubPlugin(appModules, shared, unitsMode ? { record: recordStub } : undefined),
    srcAliasPlugin(root),
    moduleDataPlugin(root, modules),
  ];

  // 2) the shared chunk itself (the prelude every page runs on top of)
  const sharedPath = path.join(outDir, 'shared.js');
  const sharedResult = await esbuild.build({
    stdin: generatedEntry(
      sharedEntrySource(unitsMode ? new Map() : appModules, extraShared),
      root,
      'fjs-shared',
    ),
    bundle: true,
    // outdir + entryNames everywhere in this function: assetNames is relative
    // to the outfile's directory, so a page chunk under dist/pages would
    // otherwise scatter its images into dist/pages/assets (assetOutputOptions)
    outdir: outDir,
    entryNames: 'shared',
    format: 'iife',
    target: 'es2019', /* PrimJS engine (spec 088) */
    ...flutterEsbuildPlatform(),
    minify: opts.minify,
    alias: { ...flutterAliases(), ...moduleAliases(root, modules) },
    plugins: [
      nodeBuiltinStubs(),
      pagesPlugin(pages, 'app', false),
      pluginsPlugin(pluginsFor(root, 'app'), modules),
      vueSfcPlugin({ nativeTags: widgetNativeTags(modules, 'app') }),
      vuePinPlugin(),
      viteAppHooksPlugin(appHooks),
      srcAliasPlugin(root),
      moduleDataPlugin(root, modules),
    ],
    define: fjsDefines(),
    ...assetOutputOptions(),
    metafile: opts.analyze,
    logLevel: 'warning',
    legalComments: 'none',
  });
  warnings.push(...sharedResult.warnings.map((w) => w.text));
  const metafiles: Record<string, Metafile> = {};
  if (sharedResult.metafile) metafiles[sharedPath] = sharedResult.metafile;

  // 3) the app entry and every page, all reading from __FJS_SHARED
  const jsPath = path.join(outDir, 'bundle.js');
  ownerFallback.current = 'bundle';
  const appResult = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outdir: outDir,
    entryNames: 'bundle',
    format: 'iife',
    target: 'es2019', /* PrimJS engine (spec 088) */
    ...flutterEsbuildPlatform(),
    minify: opts.minify,
    plugins: stubbed(),
    define: fjsDefines(),
    ...assetOutputOptions(),
    metafile: opts.analyze,
    logLevel: 'warning',
    legalComments: 'none',
  });
  warnings.push(...appResult.warnings.map((w) => w.text));
  if (appResult.metafile) metafiles[jsPath] = appResult.metafile;

  const pagesOut = path.join(outDir, 'pages');
  fs.mkdirSync(pagesOut, { recursive: true });
  const pageChunks: Record<string, string> = {};
  for (const page of pages) {
    const chunkPath = path.join(pagesOut, `${page.chunk}.js`);
    ownerFallback.current = `page:${page.chunk}`;
    const pageResult = await esbuild.build({
      stdin: generatedEntry(pageChunkSource(page), root, `page-${page.chunk}`),
      bundle: true,
      outdir: outDir,
      entryNames: `pages/${page.chunk}`,
      format: 'iife',
      target: 'es2019', /* PrimJS engine (spec 088) */
      ...flutterEsbuildPlatform(),
      minify: opts.minify,
      plugins: stubbed(),
      define: fjsDefines(),
      ...assetOutputOptions(),
      metafile: opts.analyze,
      logLevel: 'warning',
      legalComments: 'none',
    });
    warnings.push(...pageResult.warnings.map((w) => w.text));
    if (pageResult.metafile) metafiles[chunkPath] = pageResult.metafile;
    pageChunks[page.chunk] = chunkPath;
  }

  // 4) dev units (spec 037): one file per shared app module + the import
  // graph. Release builds never see this — bytecode compiles the same
  // split layout it always has.
  let devUnits: DevUnitsInfo | undefined;
  if (unitsMode) {
    devUnits = await buildDevUnits({
      opts,
      root,
      outDir,
      pages,
      appModules,
      shared,
      modules,
      warnings,
      depsOf,
      ownerFallback,
    });
  }

  const res: BuildResult = { jsPath, sharedPath, pageChunks, warnings, devUnits };
  if (opts.analyze) res.metafiles = metafiles;
  if (opts.bytecode) {
    res.bytecodePath = compileBytecode(jsPath, outDir, 'bundle');
    res.sharedBytecodePath = compileBytecode(sharedPath, outDir, 'shared');
    res.pageBytecodeChunks = {};
    for (const [chunk, file] of Object.entries(pageChunks)) {
      res.pageBytecodeChunks[chunk] = compileBytecode(file, pagesOut, chunk);
    }
  }
  return res;
}

// ---- dev units (spec 037) ---------------------------------------------------

/** Per-unit build cache across `fjs dev` rebuilds. A unit's build reads its
 * own source plus stubs (every dependency is stubbed away), so the output
 * can only change when one of the real input files does — checking their
 * mtimes skips the esbuild run for untouched modules, keeping an edit to
 * one file from paying for the whole app's unit graph. The stamps cover
 * every real input esbuild read (the module's own file, assets it imports),
 * not just the entry. Lives at module scope: it is a dev-server-process
 * cache, and `fjs build` runs are separate processes. */
const unitBuildCache = new Map<
  string,
  { stamps: string; file: string; definePart: string; records: Array<{ importer: string; id: string }> }
>();

function inputStamps(metafile: Metafile): string {
  const parts: string[] = [];
  for (const input of Object.keys(metafile.inputs)) {
    if (input.includes(':')) continue; // virtual: the stub graph, not the disk
    try {
      const st = fs.statSync(path.resolve(input));
      parts.push(`${input}:${st.mtimeMs}:${st.size}`);
    } catch {
      // gone between build and stat — the next build rebuilds
    }
  }
  return parts.sort().join('\n');
}

function stampsUnchanged(stamps: string): boolean {
  if (!stamps) return false;
  for (const line of stamps.split('\n')) {
    const ext = line.lastIndexOf(':');
    const dir = line.lastIndexOf(':', ext - 1);
    if (dir < 0) return false;
    try {
      const st = fs.statSync(line.slice(0, dir));
      if (`${st.mtimeMs}` !== line.slice(dir + 1, ext)) return false;
      if (`${st.size}` !== line.slice(ext + 1)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function buildDevUnits(args: {
  opts: BuildOptions;
  root: string;
  outDir: string;
  pages: PageRoute[];
  appModules: Map<string, string>;
  shared: string[];
  modules: FjsModule[];
  warnings: string[];
  depsOf: Map<string, Set<string>>;
  ownerFallback: { current: string };
}): Promise<DevUnitsInfo> {
  const { opts, root, outDir, pages, appModules, shared, modules, warnings, depsOf, ownerFallback } = args;
  const appHooks = await loadViteAppHooks(root);
  const unitsDir = path.join(outDir, 'units');
  fs.mkdirSync(unitsDir, { recursive: true });
  const files: Record<string, string> = {};
  const parts: string[] = [];

  for (const [key, abs] of appModules) {
    const id = key.slice('./'.length);
    const file = path.join(unitsDir, `${id}.js`);
    files[id] = file;
    const cached = unitBuildCache.get(abs);
    if (cached && cached.file === file && stampsUnchanged(cached.stamps) && fs.existsSync(file)) {
      parts.push(cached.definePart);
      // replay the records a fresh build would have produced: the import
      // graph must be complete even when nothing rebuilt
      for (const record of cached.records) addDep(depsOf, id, record.id);
      continue;
    }
    const records: Array<{ importer: string; id: string }> = [];
    ownerFallback.current = id;
    // the unit's own file must NOT be stubbed in its own build: the SFC
    // compiler's part imports (script/style blocks) re-enter resolution
    // through the same relative filter, and stubbing them would make the
    // unit import itself from the registry
    const others = new Map(
      [...appModules].filter(([key]) => key.slice('./'.length) !== id),
    );
    const result = await esbuild.build({
      entryPoints: [abs],
      bundle: true,
      outdir: outDir,
      entryNames: `units/${id}`,
      // same reason as the probe: inputStamps() reads metafile paths back
      absWorkingDir: root,
      format: 'cjs',
      target: 'es2019', /* PrimJS engine (spec 088) */
      ...flutterEsbuildPlatform(),
      minify: opts.minify,
      plugins: [
        nodeBuiltinStubs(),
        vueSfcPlugin({ nativeTags: widgetNativeTags(modules, 'app') }),
        viteAppHooksPlugin(appHooks),
        sharedStubPlugin(others, shared, { record: (importer, dep) => records.push({ importer, id: dep }) }),
        srcAliasPlugin(root),
        moduleDataPlugin(root, modules),
      ],
      define: fjsDefines(),
      ...assetOutputOptions(),
      metafile: true,
      logLevel: 'warning',
      legalComments: 'none',
    });
    warnings.push(...result.warnings.map((w) => w.text));
    // esbuild's CJS entry is already a module body over `module.exports`
    // (live getters, so cycle partners see partial exports) — the wrapper
    // just turns it into a registry factory. The file stays define-only:
    // factories run lazily on first require, which is what makes cycles
    // and the define-then-trigger hot swap both behave like a fresh start.
    const raw = fs.readFileSync(file, 'utf8');
    const definePart = `__fjsDefineUnit(${JSON.stringify(id)}, function(require, module, exports) {\n${raw}\n});`;
    fs.writeFileSync(file, `${definePart}\n`);
    parts.push(definePart);
    for (const record of records) {
      // every stub in a unit build belongs to the unit's own file
      addDep(depsOf, id, record.id);
    }
    unitBuildCache.set(abs, {
      stamps: result.metafile ? inputStamps(result.metafile) : '',
      file,
      definePart,
      records,
    });
  }

  fs.writeFileSync(path.join(outDir, 'units.js'), `${parts.join('\n')}\n`);

  const importers: Record<string, string[]> = {};
  for (const [owner, deps] of depsOf) {
    for (const dep of deps) (importers[dep] ??= []).push(owner);
  }
  // transitive closures, dependencies first (post-order DFS); cycles come
  // out in a workable order because factories only run on require
  const pageDeps: Record<string, string[]> = {};
  for (const page of pages) {
    const seen: string[] = [];
    const visited = new Set<string>();
    const visit = (owner: string) => {
      for (const dep of depsOf.get(owner) ?? []) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        visit(dep);
        seen.push(dep);
      }
    };
    visit(`page:${page.chunk}`);
    pageDeps[page.chunk] = seen;
  }
  const order: string[] = [];
  {
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const dep of args.depsOf.get(id) ?? []) visit(dep);
      order.push(id);
    };
    for (const id of Object.keys(files)) visit(id);
  }
  return { files, importers, pageDeps, order };
}

function addDep(depsOf: Map<string, Set<string>>, owner: string, dep: string): void {
  if (owner === dep) return;
  const set = depsOf.get(owner) ?? new Set<string>();
  set.add(dep);
  depsOf.set(owner, set);
}

// ---- web build (--web) -----------------------------------------------------

const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>__TITLE__</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="/main.js"></script>
</body>
</html>
`;

/** `public/` is vite's contract: whatever is in it is served from the site
 * root, unprocessed. The vite dev server does this on its own; `fjs build
 * --web` and the Flutter host have to copy it (see releaseBuild). */
export function copyPublicDir(root: string, dest: string): void {
  copyLocalDir(path.join(root, 'public'), dest);
}

/** The project's own html pages, the only place `<web-view src="/html/…">`
 * reads from (specs/018-src-hints-and-html-dir). */
export const HTML_DIR = 'html';

/** Copies a whole directory if it exists; a no-op otherwise. */
export function copyLocalDir(from: string, dest: string): void {
  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) return;
  fs.cpSync(from, dest, { recursive: true });
}

/** The web targets' copy of what each module's prepare hook generated.
 *
 * The one copy of a module's files lives in `.fjs/modules/<name>/`. The app
 * dev server already serves it at `/modules/<name>/…`; a browser wants it at
 * `/fjs-modules/<name>/…`, which is what the published `resolveSrc` returns.
 * Giving it that URL is the toolchain's job — the module used to write a
 * SECOND copy into the app's own `public/`, which then rode into the Flutter
 * bundle as a duplicate (specs/018-src-hints-and-html-dir). */
export function copyModuleDataForWeb(root: string, webOut: string): void {
  for (const mod of scanModules(root)) {
    const from = moduleDataDir(root, mod.name);
    if (!fs.existsSync(from)) continue;
    const short = mod.name.replace(/^@[^/]+\//, '');
    copyLocalDir(from, path.join(webOut, 'fjs-modules', short));
  }
}

export function webTitle(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name;
  } catch {
    // no package.json — the directory name is a fine title
  }
  return path.basename(root);
}

async function buildWeb(opts: BuildOptions, outDir: string): Promise<BuildResult> {
  const root = process.cwd();
  const entry = path.resolve(opts.entry ?? 'src/main.ts');
  if (!fs.existsSync(entry)) throw new Error(`entry not found: ${entry}`);
  const webModules = scanModules(root);
  const webOut = path.join(outDir, 'web');
  fs.rmSync(webOut, { recursive: true, force: true });
  fs.mkdirSync(webOut, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outdir: webOut,
    entryNames: 'main',
    // ESM + splitting: each `() => import(page)` in the generated route
    // table becomes its own chunk, mirroring one .fjsbundle per page
    format: 'esm',
    splitting: true,
    target: 'es2020',
    platform: 'browser',
    minify: opts.minify,
    alias: { ...webAliases(), ...moduleAliases(root, webModules) },
    plugins: [
      nodeBuiltinStubs(),
      pagesPlugin(pagesFor(root, 'web'), 'web', false),
      pluginsPlugin(pluginsFor(root, 'web'), webModules, 'web'),
      vueSfcPlugin({ web: true, nativeTags: widgetNativeTags(webModules, 'web') }),
      webPinPlugin(),
      srcAliasPlugin(root),
      moduleDataPlugin(root, webModules),
    ],
    define: fjsDefines(true),
    ...assetOutputOptions(),
    metafile: opts.analyze,
    logLevel: 'warning',
    legalComments: 'none',
  });

  fs.writeFileSync(
    path.join(webOut, 'index.html'),
    INDEX_HTML.replace('__TITLE__', webTitle(root)),
  );
  copyPublicDir(root, webOut);
  copyLocalDir(path.join(root, HTML_DIR), path.join(webOut, HTML_DIR));
  copyModuleDataForWeb(root, webOut);
  const jsPath = path.join(webOut, 'main.js');
  return {
    jsPath,
    metafiles: result.metafile ? { [jsPath]: result.metafile } : undefined,
    warnings: result.warnings.map((w) => w.text),
  };
}

// ---- bytecode --------------------------------------------------------------

/** npm package carrying the prebuilt fjsc for the machine we are running on.
 * Installed as an optional dependency of @ufjs/cli; os/cpu in its manifest make
 * npm skip every package that does not match. */
export function fjscPackageName(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
  return `@ufjs/fjsc-${process.platform}-${arch}`;
}

/** Locates the fjsc binary: $FJSC_PATH, a repo checkout's own cmake build, or
 * the prebuilt npm package.
 *
 * The checkout wins over the npm package on purpose. @ufjs/cli declares the
 * prebuilt binary as an optional dependency, so a workspace install pulls it in
 * too — and someone editing packages/flutter_fjs/native would otherwise keep
 * compiling bundles with the *published* engine instead of the one they just
 * built. None of these paths can match from inside node_modules, so an
 * installed copy still lands on the npm package. */
export function findFjsc(): string | null {
  if (process.env.FJSC_PATH && fs.existsSync(process.env.FJSC_PATH)) {
    return process.env.FJSC_PATH;
  }

  const exe = process.platform === 'win32' ? 'fjsc.exe' : 'fjsc';
  const here = import.meta.dirname ?? '.';
  const candidates = [
    // running from packages/fjs/{src,dist} inside the monorepo checkout
    path.resolve(here, '..', '..', 'flutter_fjs', 'native', 'build-native', exe),
    path.resolve(here, '..', '..', '..', 'flutter_fjs', 'native', 'build-native', exe),
    // repo root as cwd
    path.resolve(process.cwd(), 'packages', 'flutter_fjs', 'native', 'build-native', exe),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  const require = createRequire(import.meta.url);
  try {
    // resolve the manifest, not bin/fjsc: a binary has no "exports" entry
    const manifest = require.resolve(`${fjscPackageName()}/package.json`);
    const binary = path.join(path.dirname(manifest), 'bin', exe);
    if (fs.existsSync(binary)) return binary;
  } catch {
    // no prebuilt package for this platform
  }
  return null;
}

export function compileBytecode(jsPath: string, outDir: string, baseName = 'app'): string {
  const fjsc = findFjsc();
  if (!fjsc) {
    throw new Error(
      `fjsc compiler not found — bytecode and release builds need it.\n` +
        `\n` +
        `It normally arrives with ${fjscPackageName()}, an optional dependency of\n` +
        `@ufjs/cli. If your platform has no prebuilt binary yet, build one from the\n` +
        `repository and point FJSC_PATH at it:\n` +
        `\n` +
        `  git clone https://github.com/snice/ufjs && cd ufjs\n` +
        `  node packages/fjsc/build.mjs\n` +
        `  export FJSC_PATH=$PWD/packages/fjsc/npm/fjsc-<platform>/bin/fjsc\n` +
        `\n` +
        `Reinstalling with the optional dependency enabled also works\n` +
        `(npm i --include=optional).`,
    );
  }
  const out = path.join(outDir, `${baseName}.fjsbundle`);
  const r = spawnSync(fjsc, [jsPath, out], { stdio: 'pipe' });
  if (r.status !== 0) {
    throw new Error(`fjsc failed:\n${r.stderr?.toString() ?? r.stdout?.toString()}`);
  }
  return out;
}

export async function buildCommand(argv: string[]): Promise<void> {
  // the per-target outDir layout (<out>/app vs <out>/web) is applied by
  // parseBuildArgs, so `fjs dev` — which shares the parser — writes to the
  // same place (spec 047)
  const opts = parseBuildArgs(argv);
  // One flutter target per invocation: each of these spawns its own
  // `flutter build <target>`, and silently picking one of two asked-for
  // targets would bury the other
  const targets = [opts.apk && '--apk', opts.hap && '--hap', opts.ipa && '--ipa', opts.aab && '--aab'].filter(
    Boolean,
  ) as string[];
  if (targets.length > 1) {
    throw new Error(`pick one of --apk/--hap/--ipa/--aab per build (got ${targets.join(' ')})`);
  }
  for (const flag of targets) {
    if (!opts.release) throw new Error(`${flag} requires --release or --profile`);
  }
  if (opts.ipa && process.platform !== 'darwin') {
    throw new Error('--ipa needs macOS and Xcode');
  }
  if (opts.release) {
    if (opts.web) throw new Error('--release is for Flutter app builds; remove --web');
    opts.bytecode = true;
  }
  if (opts.mp) {
    if (opts.web || opts.pages || opts.release || opts.bytecode) {
      throw new Error('--mp builds the mini-program target only; drop the other flags');
    }
    await mpBuild({ root: process.cwd(), outDir: opts.outDir });
    return;
  }
  const t0 = Date.now();
  const res = await buildBundle(opts);
  for (const w of res.warnings) console.warn(formatLog('warn', w));
  if (res.sharedPath) {
    console.log(`built ${res.sharedPath} (${fs.statSync(res.sharedPath).size} B, prelude)`);
  }
  console.log(`built ${res.jsPath} (${Date.now() - t0}ms)`);
  for (const [chunk, file] of Object.entries(res.pageChunks ?? {})) {
    console.log(`  page ${chunk} -> ${path.relative(process.cwd(), file)} (${fs.statSync(file).size} B)`);
  }
  if (res.bytecodePath) {
    const size = fs.statSync(res.bytecodePath).size;
    console.log(`built ${res.bytecodePath} (${size} bytes bytecode)`);
  }
  if (opts.release) {
    releaseBuild(opts, res);
  }
  if (opts.analyze) printAnalysis(res, opts.outDir);
}

/** The two sources of local files a page can name, into the one directory
 * the Dart side reads (`fjsPublicAssetRoot` in lib/src/widgets/image.dart):
 *
 *   public/          -> assets/fjs/public/          (verbatim, vite's rule)
 *   <outDir>/assets/ -> assets/fjs/public/assets/   (what the bundler emitted)
 *
 * Both end up addressed by the same root path the browser uses, so the page
 * says `/images/x.png` or gets `/assets/x-<hash>.png` from an import and
 * neither knows which host it is running on. */
function syncPublicAssets(root: string, outDir: string, assetsDir: string): void {
  const dest = path.join(assetsDir, 'public');
  copyPublicDir(root, dest);
  // html/ keeps its directory name in the URL (/html/guide.html), so it
  // keeps it here too — that is what stops it sharing a namespace with
  // public/ (specs/018-src-hints-and-html-dir).
  copyLocalDir(path.join(root, HTML_DIR), path.join(dest, HTML_DIR));
  const emitted = path.join(outDir, ASSET_DIR);
  if (fs.existsSync(emitted)) {
    fs.cpSync(emitted, path.join(dest, ASSET_DIR), { recursive: true });
  }
  // worker scripts, fetched by root path like every other local file (specs/049)
  const workers = path.join(outDir, WORKERS_DIR);
  if (fs.existsSync(workers)) {
    fs.cpSync(workers, path.join(dest, WORKERS_DIR), { recursive: true });
  }
}

export function releaseBuild(opts: BuildOptions, res: BuildResult): void {
  if (!res.bytecodePath) {
    throw new Error('release build needs bytecode output');
  }
  const root = process.cwd();
  const appName = projectName(root);
  const flutterDir = path.resolve(root, opts.flutterDir);

  // Clear last build's assets first, then let the host sync: ensureFlutterHost
  // copies the modules' generated data into assets/fjs/modules and lists those
  // directories in the pubspec, so wiping assets/fjs afterwards would leave the
  // pubspec pointing at directories that no longer exist.
  const assets = path.join(flutterDir, 'assets', 'fjs');
  fs.rmSync(assets, { recursive: true, force: true });
  // Local files first, host second: ensureFlutterHost writes the pubspec from
  // what is on disk right now, and Flutter's asset globs are per directory —
  // a directory copied in afterwards would never be listed
  // (specs/017-local-image-assets).
  syncPublicAssets(root, path.resolve(opts.outDir), assets);
  ensureFlutterHost(flutterDir, appName, !isEjected(root));

  const pagesOut = path.join(assets, 'pages');
  fs.mkdirSync(pagesOut, { recursive: true });

  const bundleAsset = copyReleaseAsset(res.bytecodePath, path.join(assets, 'bundle.fjsbundle'), opts.gz);

  const prefix = releasePathPrefix(opts.rootPath ?? RELEASE_ROOT_PATH);
  const pages: Record<string, string> = {};
  let sharedAsset: string | null = null;
  if (res.sharedBytecodePath && res.pageBytecodeChunks) {
    sharedAsset = copyReleaseAsset(
      res.sharedBytecodePath,
      path.join(assets, 'shared.fjsbundle'),
      opts.gz,
    );
    for (const [chunk, file] of Object.entries(res.pageBytecodeChunks)) {
      const asset = copyReleaseAsset(file, path.join(pagesOut, `${chunk}.fjsbundle`), opts.gz);
      pages[chunk] = `${prefix}pages/${path.basename(asset)}`;
    }
  }
  const routes = pagesFor(root, 'app').map((page) => ({
    path: page.path,
    name: page.name,
    chunk: page.chunk,
    meta: page.meta,
  }));
  const manifest = {
    name: appName,
    entry: opts.entry ?? 'src/main.ts',
    split: Boolean(res.sharedBytecodePath),
    compression: opts.gz ? 'gzip' : null,
    shared: sharedAsset ? `${prefix}${path.basename(sharedAsset)}` : null,
    bundle: `${prefix}${path.basename(bundleAsset)}`,
    pages,
    routes,
    hashes: releaseAssetHashes(assets, prefix, [
      bundleAsset,
      ...(sharedAsset ? [sharedAsset] : []),
      ...Object.values(pages).map((p) => path.join(pagesOut, path.basename(p))),
    ]),
  };
  fs.writeFileSync(
    path.join(assets, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(`synced release assets to ${path.relative(root, assets)}`);

  if (opts.apk) {
    const args = ['build', 'apk', ...flutterModeArgs(opts.mode, opts.flutterArgs), ...opts.flutterArgs];
    const result = spawnSync('flutter', args, { cwd: flutterDir, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('flutter build apk failed');
    console.log(`built APK under ${path.relative(root, path.join(flutterDir, 'build', 'app', 'outputs', 'flutter-apk'))}`);
  }
  if (opts.hap) {
    // `build hap` is an OpenHarmony-fork subcommand; the stock tool would
    // fail with an unknown-command error naming flutter, which reads fine
    const args = ['build', 'hap', ...flutterModeArgs(opts.mode, opts.flutterArgs), ...opts.flutterArgs];
    const result = spawnSync('flutter', args, { cwd: flutterDir, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('flutter build hap failed');
    console.log(`built HAP under ${path.relative(root, path.join(flutterDir, 'ohos', 'entry', 'build', 'default', 'outputs', 'default'))}`);
  }
  if (opts.aab) {
    const args = ['build', 'appbundle', ...flutterModeArgs(opts.mode, opts.flutterArgs), ...opts.flutterArgs];
    const result = spawnSync('flutter', args, { cwd: flutterDir, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('flutter build appbundle failed');
    console.log(`built AAB under ${path.relative(root, path.join(flutterDir, 'build', 'app', 'outputs', 'bundle', 'release'))}`);
  }
  if (opts.ipa) {
    const args = ['build', 'ipa', ...flutterModeArgs(opts.mode, opts.flutterArgs), ...opts.flutterArgs];
    const result = spawnSync('flutter', args, { cwd: flutterDir, stdio: 'inherit' });
    if (result.status !== 0) {
      // the usual failure is the signed EXPORT, not the archive: point at
      // the archive and the passthrough that turns it into an .ipa
      console.error(
        `flutter build ipa failed. the archive is under ${path.relative(root, path.join(flutterDir, 'build', 'ios', 'archive'))} —\n` +
          'export it from Xcode, or rerun with `-- --export-options-plist <file>` for a signed .ipa',
      );
      throw new Error('flutter build ipa failed');
    }
    console.log(`built IPA under ${path.relative(root, path.join(flutterDir, 'build', 'ios', 'ipa'))}`);
  }
}

/**
 * Content hash of each program file, keyed by the path the manifest names
 * it by (so `shared.fjsbundle.gz` under `--root-path .`). A host that loads
 * the build over the network (fjs go's hosted mode) compares these with the
 * copies it already has and skips the request for every one that matches —
 * the manifest alone then says whether anything changed. Hosts reading
 * their own assets ignore the field.
 */
export function releaseAssetHashes(
  assetsDir: string,
  prefix: string,
  files: string[],
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const key = prefix + path.relative(assetsDir, file).split(path.sep).join('/');
    hashes[key] = createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
  }
  return hashes;
}

function copyReleaseAsset(from: string, to: string, gzip: boolean): string {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const raw = fs.readFileSync(from);
  if (!gzip) {
    fs.writeFileSync(to, raw);
    console.log(`  asset ${path.relative(process.cwd(), to)} (${raw.length} B raw)`);
    return to;
  }
  const gzPath = `${to}.gz`;
  const compressed = gzipSync(raw, { level: 9 });
  fs.writeFileSync(gzPath, compressed);
  const rel = path.relative(process.cwd(), gzPath);
  console.log(`  asset ${rel} (${compressed.length} B gzip, ${raw.length} B raw)`);
  return gzPath;
}
