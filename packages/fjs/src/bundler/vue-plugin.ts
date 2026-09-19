// esbuild plugin compiling .vue SFCs (template + script setup + style
// blocks) to JS. Style blocks are extracted verbatim and registered with
// the runtime style engine (`registerStyles`); scoped blocks get a stable
// data-v-<hash> scope id shared by `__sfc__.__scopeId`.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'esbuild';
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc';
import { inlineFontFaces } from './font-face';
import { isHTMLTag, isSVGTag, isMathMLTag } from '@vue/shared';
import { routeTableSource, type PageRoute, type Platform } from '../project/pages.js';
import { pluginTableSource, type AppPlugin } from '../project/plugins.js';
import { readConfig } from '../project/config.js';
import { resolveModuleData, type FjsModule } from '../project/modules.js';
import { swiperChildrenTransform } from '../template/swiper-children.js';
import {
  FJS_TAGS as FJS_TAG_LIST,
  FJS_COMPONENT_TAGS,
} from '../../../fjs-runtime/src/tags.js';

/** Tags the fjs runtime provides. On web they must compile as components
 * (several — text, image, switch — are otherwise native SVG/HTML tags);
 * on Flutter they pass through to the custom renderer verbatim. */
const FJS_TAGS = new Set<string>(FJS_TAG_LIST);

/** fjs tags the FLUTTER path implements as Vue components rather than as
 * host elements, so the compiler has to resolve them (see
 * fjs-runtime/src/components/). `list-view` feeds a Dart builder; `form`
 * collects its fields from the JS shadow tree; `picker` is pure
 * orchestration over `modal` + `picker-view` (constitution VII). */
// `textarea` and `form` are real HTML tag names, so they only stay components
// because the isNativeTag check below asks this set FIRST. Get that order
// wrong and the page renders nothing, without an error.
//
// The list itself lives in fjs-runtime/src/component-tags.json because the
// Volar plugin (CommonJS) needs the same one — the IDE decides "element or
// component?" separately from the build, and a mismatch shows up as bogus
// DOM types on an fjs component.
const FLUTTER_COMPONENT_TAGS = new Set<string>(FJS_COMPONENT_TAGS);

/** Web `isNativeTag`: the fjs tags must NOT be native, so the compiler emits
 * resolveComponent() and they reach the DOM adapter. Several of them (text,
 * image, switch, view are SVG; input, button, progress are HTML) are real
 * tags, so compiler-dom's default would render them verbatim — the element
 * shows up in the DOM, `@tap` becomes a listener for a DOM event named
 * "tap", and nothing works. Shared with the Vite plugin, which has to hand
 * this to @vitejs/plugin-vue. */
export function webIsNativeTag(tag: string): boolean {
  // The component guard belongs HERE, not only in the callers: this function
  // is the web half of the decision and is called from vite.ts as well, and
  // `textarea` is both an fjs component and a real HTML tag.
  return (
    !FLUTTER_COMPONENT_TAGS.has(tag) &&
    !FJS_TAGS.has(tag) &&
    (isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag))
  );
}

/** The tag decision the SFC compiler is given, as a function so a test can
 * ask it directly. Getting it wrong is SILENT — a component compiled as an
 * element renders nothing and reports no error — which is why the order
 * below is spelled out and pinned by test/vue-plugin.test.ts. */
export function isNativeTagFor(
  tag: string,
  options: { web?: boolean; moduleTags?: Set<string> } = {},
): boolean {
  const { web = false, moduleTags = new Set<string>() } = options;
  // FIRST: a tag this runtime implements as a component is never native.
  // Some of them (`form`, `textarea`) are also HTML tag names, and
  // isHTMLTag below would drag them back to being elements.
  if (FLUTTER_COMPONENT_TAGS.has(tag)) return false;
  if (moduleTags.has(tag)) return true;
  if (web) return webIsNativeTag(tag);
  return (
    FJS_TAGS.has(tag) || isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag)
  );
}

export interface SfcOptions {
  /** Web target: real scoped CSS + fjs tags compiled as components. */
  web?: boolean;
  /** Extra tags to compile as elements rather than components: the widget
   * tags the modules' Flutter side renders (see widgetNativeTags). */
  nativeTags?: readonly string[];
}

/** Compiler options for the SFC template → render function step, shared by
 * the esbuild plugin and pinned by test (specs/070): a change here is
 * silent — the page compiles, then dies at mount, or renders nothing. */
export function templateCompilerOptions({
  web = false,
  moduleTags = new Set<string>(),
  bindings = {},
}: {
  web?: boolean;
  moduleTags?: Set<string>;
  bindings?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    bindingMetadata: bindings,
    // Static hoisting emits `createStaticVNode`, whose mount path calls the
    // renderer's insertStaticContent — a DOM-innerHTML contract a non-DOM
    // host node cannot implement (specs/070: pages died at mountStaticNode
    // with "not a function" and no other symptom). The op-stream renderer
    // gains little from hoisting, so the app build turns it off entirely;
    // the renderer keeps a loud fallback for hand-written static vnodes.
    // The web build keeps the default: vue's runtime-dom implements it.
    hoistStatic: web,
    // Flutter: the fjs tags are elements the custom renderer handles, never
    // components. Saying so matters beyond codegen tidiness: compiler-dom
    // would otherwise treat <divider/> in pages/comp/divider.vue as a
    // *self reference* (it derives a component name from the filename) and
    // the page would render itself forever.
    // Web: the same tags must go the other way — through
    // resolveComponent(), to reach the DOM adapter.
    // A tag this runtime implements as a component is never native — the
    // check has to come FIRST, because some of them (`form`) are also HTML
    // tag names and isHTMLTag would drag them back to being elements.
    isNativeTag: (tag: string) => isNativeTagFor(tag, { web, moduleTags }),
    // <swiper> children must be <swiper-item> (specs/051)
    nodeTransforms: [swiperChildrenTransform],
  };
}

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the @ufjs/runtime package source dir. */
export function runtimeDir(): string {
  const candidates = [
    // monorepo checkout, bundled: packages/fjs/dist -> ../fjs-runtime
    path.resolve(dirname, '..', '..', 'fjs-runtime'),
    // monorepo checkout, straight from source: packages/fjs/src/bundler
    path.resolve(dirname, '..', '..', '..', 'fjs-runtime'),
    // installed via npm: node_modules/@ufjs/{cli,runtime} are siblings
    path.resolve(dirname, '..', '..', 'runtime'),
    // nested install: node_modules/@ufjs/cli/node_modules/@ufjs/runtime
    path.resolve(dirname, '..', 'node_modules', '@ufjs', 'runtime'),
  ];
  for (const dir of candidates) if (fs.existsSync(dir)) return dir;
  throw new Error('@ufjs/runtime not found (expected sibling package or dependency)');
}

export function vueSfcPlugin(options: SfcOptions = {}): Plugin {
  const web = options.web === true;
  const moduleTags = new Set(options.nativeTags ?? []);
  return {
    name: 'fjs-vue-sfc',
    setup(build) {
      // Plain `import 'x.css'` (component libraries ship their styles this
      // way — vant/es/<comp>/style/index.mjs). esbuild's default css loader
      // would emit a sibling .css file the Flutter host never reads, so the
      // page renders with no styles and no error. Route the text into the
      // same engine an SFC <style> block feeds; the web build keeps real CSS.
      if (!web) {
        build.onLoad({ filter: /\.css$/, namespace: 'file' }, async (args) => {
          // @font-face sources become TrueType data URLs (font-face.ts)
          const css = await inlineFontFaces(fs.readFileSync(args.path, 'utf8'), path.dirname(args.path));
          return {
            contents:
              "import { registerStyles } from 'fjs/vue';\n" +
              `registerStyles(null, ${JSON.stringify(css)});`,
            resolveDir: path.dirname(args.path),
            loader: 'js',
          };
        });
      }
      build.onLoad({ filter: /\.vue$/, namespace: 'file' }, async (args) => {
        const source = fs.readFileSync(args.path, 'utf8');
        const filename = path.basename(args.path);
        const { descriptor, errors } = parse(source, { filename });
        if (errors.length) {
          return { errors: errors.map((e) => ({ text: String(e.message ?? e) })) };
        }

        // stable per-file scope id for scoped styles (relative to the build
        // root so the same checkout hashes identically everywhere)
        const base = build.initialOptions.absWorkingDir ?? process.cwd();
        let rel = path.relative(base, args.path);
        if (rel.startsWith('..')) rel = args.path;
        const id = 'data-v-' + createHash('md5').update(rel).digest('hex').slice(0, 8);

        const bindings = {};
        let scriptCode = '';

        if (descriptor.script || descriptor.scriptSetup) {
          const compiled = compileScript(descriptor, { id });
          scriptCode = compiled.content;
          Object.assign(bindings, compiled.bindings ?? {});
        } else {
          scriptCode = 'const __sfc__ = {};';
        }

        let code = scriptCode;
        if (code.includes('export default')) {
          code = code.replace(/export default/, 'const __sfc__ =');
        } else if (!code.includes('const __sfc__')) {
          code = 'const __sfc__ = {};\n' + code;
        }

        if (descriptor.template) {
          const tpl = compileTemplate({
            source: descriptor.template.content,
            filename: args.path,
            id,
            compilerOptions: templateCompilerOptions({
              web,
              moduleTags,
              bindings,
            }),
          });
          if (tpl.errors.length) {
            return {
              errors: tpl.errors.map((e) => {
                const err = e as { message?: string; loc?: { start?: { line?: number; column?: number } } };
                const loc = err.loc?.start;
                const at = loc ? ` (template line ${loc.line}:${loc.column ?? 0})` : '';
                return { text: `SFC template error${at}: ${err.message ?? String(e)}` };
              }),
            };
          }
          // `pages/comp/list-view.vue` and the runtime `<list-view>`
          // component share a name. Vue marks that tag as a self reference
          // from the filename, which would recurse into the page instead of
          // resolving the registered built-in component. Native built-ins do
          // not hit this because `isNativeTag` bypasses resolution entirely.
          const templateCode = web
            ? tpl.code
            : tpl.code.replace(
                /(_resolveComponent\("list-view"), true\)/g,
                '$1)',
              );
          code += `\n${templateCode}\n__sfc__.render = render;\nexport default __sfc__;`;
        } else {
          code += '\nexport default __sfc__;';
        }

        // <style> blocks: scoped ones tie the component to its scope id so
        // the renderer marks its elements; the engine gets the raw CSS.
        // v-bind(expr) in CSS is rewritten to var(--<shortId>-<expr>) —
        // compileScript strips the data-v- prefix before generating the
        // useCssVars call, so the short id must be used on both sides.
        const shortId = id.replace(/^data-v-/, '');
        const styles = descriptor.styles.filter(
          (s) => !s.lang || s.lang === 'css' || s.lang === 'postcss',
        );
        for (const s of descriptor.styles) {
          if (!styles.includes(s)) {
            console.warn(`[fjs] ${filename}: <style lang="${s.lang}"> needs a preprocessor — skipped`);
          }
        }
        if (styles.length && web) {
          // real CSS: let compiler-sfc rewrite the selectors (scoped
          // attribute, ::v-deep, v-bind()) and inject a <style> tag
          code += `\nimport { injectStyle as __fjsInjectStyle } from 'fjs/web';`;
          for (const s of styles) {
            const compiled = compileStyle({
              source: s.content,
              filename: args.path,
              id,
              scoped: s.scoped === true,
            });
            if (compiled.errors.length) {
              return { errors: compiled.errors.map((e) => ({ text: String(e) })) };
            }
            code += `\n__fjsInjectStyle(${JSON.stringify(id + (s.scoped ? '-s' : '-g'))}, ${JSON.stringify(compiled.code)});`;
          }
        } else if (styles.length) {
          code += `\nimport { registerStyles as __fjsRegisterStyles } from 'fjs/vue';`;
          for (const s of styles) {
            const css = await inlineFontFaces(
              descriptor.cssVars.length ? rewriteCssVBind(s.content, shortId) : s.content,
              path.dirname(args.path),
            );
            code += `\n__fjsRegisterStyles(${s.scoped ? JSON.stringify(id) : 'null'}, ${JSON.stringify(css)});`;
          }
        }
        if (styles.some((s) => s.scoped)) {
          code += `\n__sfc__.__scopeId = ${JSON.stringify(id)};`;
        }

        return { contents: code, resolveDir: path.dirname(args.path), loader: 'ts' };
      });
    },
  };
}

/** Locates `<pkg>/dist/<file>` from the runtime package outward. pnpm nests it
 * under the runtime's own node_modules; npm and yarn hoist it to the project
 * root, so walking up covers both. */
function resolveDist(pkg: string, file: string): string {
  let dir = runtimeDir();
  for (;;) {
    const candidate = path.join(dir, 'node_modules', pkg, 'dist', file);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `${pkg}/dist/${file} not found from ${runtimeDir()} — is @ufjs/runtime installed?`,
  );
}

/** Pins every Vue-ish import onto ONE physical copy under fjs-runtime's
 * node_modules (or the hoisted copy). Without this, esbuild resolves
 * '@vue/runtime-core' from each importer's own node_modules and the app's
 * `ref()` and the renderer's
 * render effect end up in two isolated reactivity instances (mount works,
 * updates never fire). onResolve has final say over resolution. 'vue'
 * resolves to the fjs shim: runtime-core plus the helper implementations
 * (useCssVars) that generated SFC code imports but runtime-core lacks. */
export function vuePinPlugin(): Plugin {
  return {
    name: 'fjs-vue-pin',
    setup(build) {
      const dist = (pkg: string, file: string) =>
        resolveDist(pkg, file);
      const pinned: Record<string, string> = {
        vue: path.join(runtimeDir(), 'src', 'vue', 'vue-shim.ts'),
        '@vue/runtime-core': dist('@vue/runtime-core', 'runtime-core.esm-bundler.js'),
        '@vue/reactivity': dist('@vue/reactivity', 'reactivity.esm-bundler.js'),
        '@vue/shared': dist('@vue/shared', 'shared.esm-bundler.js'),
      };
      build.onResolve({ filter: /^(vue|@vue\/(runtime-core|reactivity|shared))$/ }, (args) => {
        const target = pinned[args.path];
        return target ? { path: target } : undefined;
      });
    },
  };
}

/** `@/x` -> `<root>/src/x`, the alias every Vue + Vite project expects.
 *
 * esbuild's `alias` option only matches whole specifiers, so a prefix alias
 * needs a resolver. It re-dispatches through build.resolve() rather than
 * returning the absolute path directly: that way the relative path goes back
 * through the plugin chain, and `fjs build --pages` still recognises the file
 * as an app module belonging in the shared chunk (see [sharedStubPlugin]).
 * Vite gets the same alias from the `fjs()` plugin. */
export function srcAliasPlugin(root: string): Plugin {
  const srcDir = path.join(root, 'src');
  return {
    name: 'fjs-src-alias',
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) =>
        build.resolve(`./${args.path.slice(2)}`, {
          importer: args.importer,
          resolveDir: srcDir,
          kind: args.kind,
        }),
      );
    },
  };
}

/** Serves `fjs/data/<file>` — what a module's own code imports to reach what
 * its prepare hook generated for this project (see runModulePrepare). The
 * importer decides which module's directory that is, so one module can never
 * read another's. */
export function moduleDataPlugin(root: string, modules: FjsModule[]): Plugin {
  return {
    name: 'fjs-module-data',
    setup(build) {
      build.onResolve({ filter: /^fjs\/data\// }, (args) => {
        const file = resolveModuleData(root, modules, args.importer, args.path);
        if (!file) {
          return {
            errors: [
              {
                text: `${args.path} is only importable from inside an fjs module (imported by ${args.importer})`,
              },
            ],
          };
        }
        if (!fs.existsSync(file)) {
          return {
            errors: [
              {
                text: `${args.path} does not exist — the module's prepare hook did not write ${path.basename(file)}`,
              },
            ],
          };
        }
        return { path: file };
      });
    },
  };
}

/** The runtime's published package name. Apps import it as `fjs`, but a
 * library package (@ufjs/spine, @ufjs/webgl) can only name its peer
 * dependency — both spellings must land on the same module. */
export const RUNTIME_PACKAGE = '@ufjs/runtime';

const RUNTIME_PACKAGE_RE = /^@ufjs\/runtime(\/.*)?$/;

/** `@ufjs/runtime[/sub]` -> `fjs[/sub]`; anything else unchanged. */
export function runtimeSpecifier(id: string): string {
  const m = RUNTIME_PACKAGE_RE.exec(id);
  return m ? `fjs${m[1] ?? ''}` : id;
}

/** Mirrors every `fjs[/sub]` alias under the package name, so a library's
 * `import '@ufjs/runtime/router'` gets the platform router the app's
 * `fjs/router` gets, not the package's generic export. */
function withPackageAliases(aliases: Record<string, string>): Record<string, string> {
  const out = { ...aliases };
  for (const [id, target] of Object.entries(aliases)) {
    if (id === 'fjs' || id.startsWith('fjs/')) out[RUNTIME_PACKAGE + id.slice('fjs'.length)] = target;
  }
  return out;
}

/** esbuild resolve aliases for the fjs runtime sources. */
export function runtimeAliases(): Record<string, string> {
  const root = runtimeDir();
  return withPackageAliases({
    fjs: path.join(root, 'src', 'index.ts'),
    'fjs/vue': path.join(root, 'src', 'vue', 'index.ts'),
  });
}

/** Bare specifiers the shared chunk always exports: the runtime itself,
 * which every page needs and none should carry its own copy of. */
export const SHARED_BARE_BUILTIN = [
  'vue',
  'fjs',
  'fjs/vue',
  'fjs/router',
  'fjs/app',
  'fjs/pages',
  'fjs/plugins',
  '@vue/runtime-core',
  '@vue/reactivity',
  '@vue/shared',
];

/** The built-in set plus whatever `fjs.shared` in package.json adds.
 *
 * A library belongs here when page chunks import it directly AND it keeps
 * module-level state — pinia's active-instance, vue-i18n's global scope.
 * Without it esbuild gives every page chunk a private copy, which is not
 * just bytes: two copies of pinia are two `activePinia` variables, and a
 * store read from a page chunk is then a different store. */
export function sharedBare(root = process.cwd()): string[] {
  const extra = readConfig(root).shared ?? [];
  return [...SHARED_BARE_BUILTIN, ...extra.filter((id) => !SHARED_BARE_BUILTIN.includes(id))];
}

function sharedBareRe(shared: string[]): RegExp {
  const escaped = shared.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^(${escaped.join('|')})$`);
}

/** App-build stubs for `fjs build --pages`: imports that the shared chunk
 * already owns resolve to virtual CJS modules reading from
 * globalThis.__FJS_SHARED, which the shared chunk installs once per VM.
 *
 * [appModules] extends this from bare runtime specifiers to the app's own
 * files (keyed by their path relative to the project root), which is what
 * lets a page chunk share the app shell, stores and components with every
 * other page instead of embedding its own copy.
 *
 * [units] turns the app-module stubs into the dev hot-reload form (spec
 * 037): `globalThis.__fjsRequireUnit(id)` against the dev unit registry,
 * so a swapped unit is visible to chunks that already captured the old
 * exports. Every materialization is reported through `record` — the dev
 * server builds the unit import graph out of these calls.
 *
 * Must be used WITHOUT runtimeAliases()/vuePinPlugin(), which would win
 * resolution and pull the runtime into the app bundle again. */
export interface UnitStubOptions {
  record?: (importer: string, id: string) => void;
}

export function sharedStubPlugin(
  appModules?: Map<string, string>,
  shared: string[] = SHARED_BARE_BUILTIN,
  units?: UnitStubOptions,
): Plugin {
  // key -> absolute path, inverted for lookups during resolution
  const byPath = new Map<string, string>();
  for (const [key, abs] of appModules ?? []) byPath.set(abs, key);
  const bareRe = sharedBareRe(shared);
  return {
    name: 'fjs-shared-stub',
    setup(build) {
      build.onResolve({ filter: bareRe }, (args) => ({
        path: args.path,
        namespace: 'fjs-shared-stub',
      }));
      // a library importing the runtime by package name (@ufjs/spine does)
      // must read the shared instance too: bundling its own copy re-runs the
      // runtime's module init when the chunk evaluates, and
      // installEventDispatcher() then swaps the global dispatcher for one
      // with an empty handler table — every tap in the app goes dead
      build.onResolve({ filter: RUNTIME_PACKAGE_RE }, (args) => {
        const id = runtimeSpecifier(args.path);
        return bareRe.test(id) ? { path: id, namespace: 'fjs-shared-stub' } : undefined;
      });
      if (byPath.size) {
        build.onResolve({ filter: /^[./]/ }, async (args) => {
          // re-entrancy guard: our own build.resolve() call comes back
          // through this same hook
          if ((args.pluginData as { skip?: boolean } | undefined)?.skip) return null;
          const resolved = await build.resolve(args.path, {
            importer: args.importer,
            resolveDir: args.resolveDir,
            kind: args.kind,
            pluginData: { skip: true },
          });
          if (resolved.errors.length) return resolved;
          const key = byPath.get(resolved.path);
          if (!key) return resolved;
          units?.record?.(args.importer, key.slice('./'.length));
          return { path: key, namespace: 'fjs-shared-stub' };
        });
      }
      build.onLoad({ filter: /.*/, namespace: 'fjs-shared-stub' }, (args) => ({
        // app-module keys are './'-prefixed (see byPath); in units mode they
        // go through the dev registry instead of the shared snapshot
        contents:
          units && args.path.startsWith('./')
            ? `module.exports = globalThis.__fjsRequireUnit(${JSON.stringify(
                args.path.slice('./'.length),
              )});`
            : `module.exports = globalThis.__FJS_SHARED[${JSON.stringify(args.path)}];`,
        loader: 'js',
      }));
    },
  };
}

/** Resolve aliases for a web build: the fjs specifiers point at the DOM
 * implementations (vue-router-backed router, DOM tag components). */
export function webAliases(): Record<string, string> {
  const root = runtimeDir();
  return withPackageAliases({
    fjs: path.join(root, 'src', 'index.ts'),
    'fjs/vue': path.join(root, 'src', 'vue', 'index.ts'),
    'fjs/web': path.join(root, 'src', 'web', 'index.ts'),
    'fjs/router': path.join(root, 'src', 'router', 'web.ts'),
    'fjs/app': path.join(root, 'src', 'app', 'web.ts'),
  });
}

/** Resolve aliases for a Flutter build. */
export function flutterAliases(): Record<string, string> {
  const root = runtimeDir();
  return withPackageAliases({
    ...runtimeAliases(),
    'fjs/router': path.join(root, 'src', 'router', 'flutter.ts'),
    'fjs/app': path.join(root, 'src', 'app', 'flutter.ts'),
  });
}

/** Web twin of vuePinPlugin: one physical vue + vue-router, resolved from
 * fjs-runtime. Both the app's SFCs and the adapter import 'vue', and two
 * copies would again mean two reactivity systems. */
export function webPinPlugin(): Plugin {
  return {
    name: 'fjs-web-pin',
    setup(build) {
      const nm = path.join(runtimeDir(), 'node_modules');
      const pinned: Record<string, string> = {
        // runtime-only build: templates are compiled ahead of time here
        vue: path.join(nm, 'vue', 'dist', 'vue.runtime.esm-bundler.js'),
        // the package's own ESM entry: importing the esm-bundler file
        // directly makes vue-router log a deprecation warning
        'vue-router': path.join(nm, 'vue-router', 'dist', 'vue-router.mjs'),
      };
      build.onResolve({ filter: /^(vue|vue-router)$/ }, (args) => {
        const target = pinned[args.path];
        if (!target || !fs.existsSync(target)) return undefined;
        // a path returned from a plugin is used verbatim — without the
        // realpath, pnpm's symlinked package dir hides vue's own
        // node_modules and '@vue/runtime-dom' fails to resolve
        return { path: fs.realpathSync(target) };
      });
    },
  };
}

/** Serves the generated plugin list as the module 'fjs/plugins'.
 *
 * The plugin files themselves are ordinary app modules, so in a split
 * build (`--pages`) they land in the shared chunk like the shell does —
 * which is what keeps one Pinia instance shared by every page. */
export function pluginsPlugin(
  plugins: AppPlugin[],
  modules: FjsModule[] = [],
  platform: Platform = 'app',
): Plugin {
  return {
    name: 'fjs-plugins',
    setup(build) {
      build.onResolve({ filter: /^fjs\/plugins$/ }, () => ({
        path: 'fjs/plugins',
        namespace: 'fjs-plugins',
      }));
      build.onLoad({ filter: /.*/, namespace: 'fjs-plugins' }, () => ({
        contents: pluginTableSource(plugins, modules, platform),
        loader: 'js',
        resolveDir: process.cwd(),
      }));
    },
  };
}

/** Serves the generated route table as the module 'fjs/pages'. */
export function pagesPlugin(pages: PageRoute[], platform: Platform, inline: boolean): Plugin {
  return {
    name: 'fjs-pages',
    setup(build) {
      build.onResolve({ filter: /^fjs\/pages$/ }, () => ({
        path: 'fjs/pages',
        namespace: 'fjs-pages',
      }));
      build.onLoad({ filter: /.*/, namespace: 'fjs-pages' }, () => ({
        contents: routeTableSource(pages, platform, inline),
        loader: 'js',
        resolveDir: process.cwd(),
      }));
    },
  };
}

// ---- v-bind() in CSS --------------------------------------------------------
// Mirrors @vue/compiler-sfc: v-bind(expr) declarations become
// var(--<id>-<expr>) custom-property references whose values are supplied at
// runtime by the useCssVars call compileScript injects into the component.

const CSS_V_BIND_RE = /v-bind\s*\(/g;
const CSS_VAR_NAME_ESCAPE_RE = /[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;

function escapeCssVarName(name: string): string {
  return name.replace(CSS_VAR_NAME_ESCAPE_RE, (s) => `\\${s}`);
}

/** Finds the end of a v-bind() argument, tolerating nested parens and
 * string literals (same state machine as compiler-sfc's lexBinding). */
function lexBinding(content: string, start: number): number | null {
  let state: 'parens' | 'single' | 'double' = 'parens';
  let parenDepth = 0;
  for (let i = start; i < content.length; i++) {
    const ch = content.charAt(i);
    if (state === 'parens') {
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '(') parenDepth++;
      else if (ch === ')') {
        if (parenDepth > 0) parenDepth--;
        else return i;
      }
    } else if (state === 'single' && ch === "'") state = 'parens';
    else if (state === 'double' && ch === '"') state = 'parens';
  }
  return null;
}

function rewriteCssVBind(css: string, id: string): string {
  // comments are stripped first (they have no runtime effect and may
  // mention v-bind() literally, which must not be rewritten)
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CSS_V_BIND_RE.lastIndex = 0;
  while ((match = CSS_V_BIND_RE.exec(css))) {
    const start = match.index + match[0].length;
    const end = lexBinding(css, start);
    if (end === null) continue;
    let expr = css.slice(start, end).trim();
    if (
      (expr.startsWith("'") && expr.endsWith("'")) ||
      (expr.startsWith('"') && expr.endsWith('"'))
    ) {
      expr = expr.slice(1, -1);
    }
    if (!expr) continue;
    out += css.slice(lastIndex, match.index) + `var(--${id}-${escapeCssVarName(expr)})`;
    lastIndex = end + 1;
  }
  return out + css.slice(lastIndex);
}
