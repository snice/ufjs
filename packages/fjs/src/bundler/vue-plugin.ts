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
import { expandFlexDefault } from '../../../fjs-runtime/src/web/css-compat.js';
import { routeTableSource, type PageRoute, type Platform } from '../project/pages.js';
import { pluginTableSource, type AppPlugin } from '../project/plugins.js';
import { readConfig } from '../project/config.js';
import { resolveModuleData, type FjsModule } from '../project/modules.js';
import { swiperChildrenTransform } from '../template/swiper-children.js';
import { cloneBlocksTransform } from '../template/clone-blocks.js';
import { compileVaporSfc, isVaporDescriptor } from '../../../fjs-runtime/src/vapor/sfc-compiler';
import {
  isAutoVapor,
  isNativeTagFor,
  isOptionsApiSfc,
  sfcCompilesAsVapor,
  sfcParseOptions,
  vaporCompilerOptions,
  webIsNativeTag,
  tagModulesFor,
} from '../../../fjs-runtime/src/vapor/sfc-tags';

// the tag decision + vapor option builders live in the runtime's
// src/vapor/sfc-tags.ts (specs/166); re-exported so the existing import
// surface (vite.ts, tests) is unchanged
export {
  isAutoVapor,
  isNativeTagFor,
  sfcCompilesAsVapor,
  sfcParseOptions,
  vaporCompilerOptions,
  webIsNativeTag,
};

export interface SfcOptions {
  /** Web target: real scoped CSS + fjs tags compiled as components. */
  web?: boolean;
  /** specs/166: the app declared `enableVapor: true` — a plain (VDOM) SFC
   * under src is a configuration error (the router mounts vapor natively
   * and would render a vdom page as nothing), so each one is named. */
  enableVapor?: boolean;
  /** Extra tags to compile as elements rather than components: the widget
   * tags the modules' Flutter side renders (see widgetNativeTags). */
  nativeTags?: readonly string[];
  /** Dev debugger (spec 094): map the compiled module back to the .vue
   * file. Release builds leave this off — Chrome DevTools is the only
   * consumer, and it is not attached to a release bundle. */
  sourceMap?: boolean;
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
    // <swiper> children must be <swiper-item> (specs/051); static-structure
    // subtrees become native clone blocks on Flutter (specs/153)
    nodeTransforms: web ? [swiperChildrenTransform] : [swiperChildrenTransform, cloneBlocksTransform],
  };
}

/** Parse-time options for EVERY SFC parse live in sfc-tags.ts (specs/166),
 * re-exported above. */

const vaporSfcCache = new Map<string, boolean>();

/** Whether [file] compiles as a Vapor SFC (sfcCompilesAsVapor, specs/177):
 * an explicit `<script setup vapor>`; a node_modules SFC under specs/148's
 * auto-vapor; and, in an `enableVapor` app, every project SFC that can be.
 * Resolution time, so a VDOM module importing a Vapor component can be
 * redirected to its wrapper before anything compiles. */
export function isVaporSfcFile(file: string, libs: boolean, enableVapor = false): boolean {
  const key = enableVapor ? file + '\0vapor' : file;
  const cached = vaporSfcCache.get(key);
  if (cached !== undefined) return cached;
  let hit = false;
  try {
    const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: path.basename(file), ...sfcParseOptions() });
    hit = sfcCompilesAsVapor(file, descriptor, { explicit: isVaporDescriptor(descriptor), enableVapor, libs });
  } catch {
    hit = false;
  }
  vaporSfcCache.set(key, hit);
  return hit;
}

/** The wrapper around a Vapor component imported from a VDOM module
 * (specs/161 §3.2): runtime-core 3.5 has no Vapor interop interface, so the
 * crossing is compile-time. The wrapper mounts the block via fjs/vapor's
 * adoption and renders an `fjs-vapor-root` placeholder — intercepted by the
 * renderer's adopt hook on Flutter, `display: contents` on web, so the
 * Vapor nodes join the VDOM tree as ordinary hosts. props / attrs and
 * `on*` listeners flow through as getters; `v-model` rides along as
 * `modelValue` + `onUpdate:modelValue`. The generated code is identical on
 * both platforms. */
export function vaporWrapperModule(file: string): string {
  return `
import { adoptVaporComponent as __adopt, mountAdoptNodes as __mountAdopt, releaseAdopt as __release } from 'fjs/vapor';
import { defineComponent as __dc, getCurrentInstance as __gci, h as __h, onBeforeUnmount as __obu } from 'vue';
import __vapor from ${JSON.stringify(file)};
export default __dc({
  name: __vapor.name ? __vapor.name + 'Wrapper' : undefined,
  props: __vapor.props,
  setup(__props, { attrs: __attrs }) {
    const __getters = {};
    for (const __k of new Set([...Object.keys(__props), ...Object.keys(__attrs)])) {
      __getters[__k] = () => __props[__k] ?? __attrs[__k];
    }
    const __a = __adopt(__vapor, __getters, __gci()?.appContext ?? null);
    __obu(() => __release(__a.id));
    // the element ref fires at commit time — web keeps pages in a
    // <KeepAlive> whose clone/transition path can eat component-level
    // mounted hooks (specs/165: home → other vant page → back → vapor
    // mounted the wrapper but never ran onMounted, leaving the placeholder
    // empty); a commit-time ref does not depend on that machinery
    return () => __h('fjs-vapor-root', {
      'data-fjs-vapor': String(__a.id),
      style: { display: 'contents' },
      ref: (__el) => { if (__el) __mountAdopt(__a.id, __el); },
    });
  },
});
`;
}

const VAPOR_WRAPPER_NS = 'fjs-vapor-wrapper';

/** Compiles a Vapor SFC into a finished module over the own runtime —
 * `compileVaporSfc` (specs/166) does parse + script (compiler-sfc@3.5) and
 * the template (compiler-vapor) splice; this adds the `from 'vue'` rewrite,
 * `__sfc__` conversion and per-platform style attach. The vite path serves
 * vapor SFCs through this under a virtual id instead of letting plugin-vue
 * compile them: plugin-vue's vapor output targets the official runtime-vapor
 * contract — setup returns the bindings object with the template in a
 * separate `render` and an `expose` ctx — which the own runtime does not
 * implement (specs/165). Sourcemaps are the esbuild side's debugger story;
 * vite dev tolerates script-only mappings being absent. */
export async function compileVaporSfcModule(
  file: string,
  opts: { web: boolean; moduleTags: Set<string>; root: string; enableVapor?: boolean },
): Promise<{ code: string; scriptMappings?: string } | { errors: { text: string }[] }> {
  const source = fs.readFileSync(file, 'utf8');
  if (opts.enableVapor) warnVueRouterInVapor(file, source);
  const filename = path.basename(file);
  // stable per-file scope id (relative to the build root so the same
  // checkout hashes identically everywhere)
  let rel = path.relative(opts.root, file);
  if (rel.startsWith('..')) rel = file;
  const id = 'data-v-' + createHash('md5').update(rel).digest('hex').slice(0, 8);
  const compiled = compileVaporSfc(source, { file, id, web: opts.web, moduleTags: opts.moduleTags });
  if ('errors' in compiled) return compiled;
  const { descriptor } = parse(source, {
    filename,
    ...sfcParseOptions(opts),
  });
  let code = compiled.code.replace(/(\bfrom\s*)(['"])vue\2/g, "$1'fjs/vapor'");
  // compileVaporSfc already produced `const __sfc__ = …` + `export default __sfc__`
  if (!code.includes('const __sfc__')) {
    code = 'const __sfc__ = {};\n' + code + '\nexport default __sfc__;';
  }
  // <style> blocks, same split as vueSfcPlugin: web keeps real CSS through
  // injectStyle, the app build feeds the style engine via registerStyles
  const shortId = id.replace(/^data-v-/, '');
  const styles = descriptor.styles.filter(
    (s) => !s.lang || s.lang === 'css' || s.lang === 'postcss',
  );
  for (const s of descriptor.styles) {
    if (!styles.includes(s)) {
      console.warn(`[fjs] ${filename}: <style lang="${s.lang}"> needs a preprocessor — skipped`);
    }
  }
  if (styles.length && opts.web) {
    code += `\nimport { injectStyle as __fjsInjectStyle } from 'fjs/web-style';`;
    for (const s of styles) {
      const style = compileStyle({
        source: s.content,
        filename: file,
        id,
        scoped: s.scoped === true,
      });
      if (style.errors.length) {
        return { errors: style.errors.map((e) => ({ text: String(e) })) };
      }
      code += `\n__fjsInjectStyle(${JSON.stringify(id + (s.scoped ? '-s' : '-g'))}, ${JSON.stringify(style.code)});`;
    }
  } else {
    code += `\nimport { registerStyles as __fjsRegisterStyles } from 'fjs/vue';`;
    for (const s of styles) {
      const css = await inlineFontFaces(
        descriptor.cssVars.length ? rewriteCssVBind(s.content, shortId) : s.content,
        path.dirname(file),
      );
      const scope = s.scoped ? id : null;
      code += `\n__fjsRegisterStyles(${scope === null ? 'null' : JSON.stringify(scope)}, ${JSON.stringify(css)});`;
    }
  }
  if (styles.some((s) => s.scoped)) {
    code += `\n__sfc__.__scopeId = ${JSON.stringify(id)};`;
  }
  return { code, scriptMappings: compiled.scriptMappings };
}

/** esbuild side of the wrapper: a `.vue` import that resolves to a Vapor
 * SFC lands on a virtual wrapper module instead of the SFC itself. The
 * route table (inline `require(<abs>)`) and the `--pages` chunk entry
 * (`import Page from <abs>`, both generatedEntry stdin modules with no
 * importer) are the sites every routed vapor page actually mounts through —
 * specs/165 — so absolute paths resolve as themselves and relative ones
 * fall back to `resolveDir` when there is no importer. The wrapper's own
 * `import __vapor from <file>` must reach the SFC (plugin-vue / the .vue
 * onLoad compile it), hence the namespace guard. */
export function vaporWrapperPlugin(): Plugin {
  return {
    name: 'fjs-vapor-wrapper',
    setup(build) {
      const libs = readConfig(build.initialOptions.absWorkingDir ?? process.cwd()).vapor?.libs !== false;
      build.onResolve({ filter: /\.vue$/ }, (args) => {
        // a vapor SFC used AS the entry mounts however its host mounts it —
        // only imports get the wrapper
        if (args.kind === 'entry-point') return undefined;
        if (args.importer.startsWith(VAPOR_WRAPPER_NS + ':')) return undefined;
        let file: string | undefined;
        if (args.path.startsWith('.')) {
          const base = args.importer ? path.dirname(args.importer) : args.resolveDir;
          if (!base) return undefined;
          file = path.resolve(base, args.path);
        } else if (path.isAbsolute(args.path)) {
          file = args.path;
        } else {
          return undefined;
        }
        if (!fs.existsSync(file)) return undefined;
        if (!isVaporSfcFile(file, libs)) return undefined;
        return { path: VAPOR_WRAPPER_NS + ':' + file, namespace: VAPOR_WRAPPER_NS };
      });
      build.onLoad({ filter: /.*/, namespace: VAPOR_WRAPPER_NS }, (args) => {
        const file = args.path.slice(VAPOR_WRAPPER_NS.length + 1);
        return { contents: vaporWrapperModule(file), resolveDir: path.dirname(file), loader: 'js' };
      });
    },
  };
}

function vaporLibs(build: { initialOptions: { absWorkingDir?: string } }): boolean {
  return readConfig(build.initialOptions.absWorkingDir ?? process.cwd()).vapor?.libs !== false;
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
  const sourceMap = options.sourceMap === true;
  const moduleTags = new Set(options.nativeTags ?? []);
  const enableVapor = options.enableVapor === true;
  const warnedVdom = new Set<string>();
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
      } else {
        // the web build keeps real CSS, plus the flex-direction default the
        // engine applies to every sheet (specs/140, see vite.ts transform)
        build.onLoad({ filter: /\.css$/, namespace: 'file' }, (args) => ({
          contents: expandFlexDefault(fs.readFileSync(args.path, 'utf8')),
          resolveDir: path.dirname(args.path),
          loader: 'css',
        }));
      }
      build.onLoad({ filter: /\.vue$/, namespace: 'file' }, async (args) => {
        const source = fs.readFileSync(args.path, 'utf8');
        const filename = path.basename(args.path);
        const { descriptor, errors } = parse(source, { filename, ...sfcParseOptions({ web, moduleTags }) });
        if (errors.length) {
          return { errors: errors.map((e) => ({ text: String(e.message ?? e) })) };
        }
        // Vapor (specs/148): `<script setup vapor>`, or a library's
        // `<script setup>`-only SFC. Re-parsed from the edited source rather
        // than flagged on the descriptor: compiler-sfc caches descriptors by
        // source, and the flag would leak into anything sharing it.
        // specs/177: an `enableVapor` app compiles every project SFC that can
        // be vapor as vapor, attribute or not (compileVaporSfc adds it)
        const vapor = sfcCompilesAsVapor(args.path, descriptor, {
          explicit: isVaporDescriptor(descriptor),
          enableVapor,
          libs: vaporLibs(build),
        });
        if (enableVapor && !vapor && isOptionsApiSfc(descriptor) && !warnedVdom.has(args.path) && !args.path.includes('node_modules')) {
          warnedVdom.add(args.path);
          console.warn(
            `[fjs] ${filename}: enableVapor is on but this is an Options API component (no <script setup>) — ` +
              'it stays VDOM, and a pure-vapor app has no VDOM renderer to mount it. ' +
              'Rewrite it with <script setup> or drop enableVapor.',
          );
        }

        // stable per-file scope id for scoped styles (relative to the build
        // root so the same checkout hashes identically everywhere)
        const base = build.initialOptions.absWorkingDir ?? process.cwd();
        let rel = path.relative(base, args.path);
        if (rel.startsWith('..')) rel = args.path;
        const id = 'data-v-' + createHash('md5').update(rel).digest('hex').slice(0, 8);

        const bindings = {};
        let scriptCode = '';
        // compileScript's map already points at the SFC (block line offsets
        // included). Kept only for the dev debugger — release never asks.
        let scriptMappings: string | undefined;

        if (vapor) {
          // Vapor has no render function to attach: the template compiles
          // into setup() itself (inline), against the Vapor runtime helpers.
          // parse + script + template splice are one step in the runtime's
          // sfc-compiler.ts (specs/166 — stable compiler-sfc, the codegen
          // from @vue/compiler-vapor).
          if (enableVapor) warnVueRouterInVapor(args.path, source);
          const compiledVapor = compileVaporSfc(source, { file: args.path, id, web, moduleTags });
          if ('errors' in compiledVapor) return { errors: compiledVapor.errors };
          // The helpers a Vapor module imports — generated and the page's
          // own — come from `fjs/vapor` (specs/161): the own runtime over the
          // element API on Flutter and over the DOM on web, plus the 'vue'
          // shim's exports. The entry leaves runtime-core's full export
          // surface to the shim, so a `--pages` build's shared chunk does
          // not carry the vapor runtime for apps without a Vapor component.
          scriptCode = compiledVapor.code.replace(/(\bfrom\s*)(['"])vue\2/g, "$1'fjs/vapor'");
          scriptMappings = compiledVapor.scriptMappings;
        } else if (descriptor.script || descriptor.scriptSetup) {
          const compiled = compileScript(descriptor, { id });
          scriptCode = compiled.content;
          scriptMappings = compiled.map?.mappings;
          Object.assign(bindings, compiled.bindings ?? {});
        } else {
          scriptCode = 'const __sfc__ = {};';
        }

        let code = scriptCode;
        // `export default` and `const __sfc__ =` are both 14 characters, so
        // this rewrite does not move any column the script map recorded.
        // The other branch inserts a line, which the map has to follow.
        // (A vapor module already carries the conversion + marker + final
        // export from the compiler — vapor-sfc.ts owns that shape.)
        let scriptLineShift = 0;
        if (!vapor && code.includes('export default')) {
          code = code.replace(/export default/, 'const __sfc__ =');
        } else if (!code.includes('const __sfc__')) {
          code = 'const __sfc__ = {};\n' + code;
          scriptLineShift = 1;
        }

        // 1-based line where the template compiler's line 1 lands in `code`.
        // 0 when there is no template. Computed BEFORE the template is
        // appended; style registration comes after and does not shift it.
        let templateStartLine = 0;
        let templateMappings: string | undefined;

        if (descriptor.template && !vapor) {
          const tpl = compileTemplate({
            source: descriptor.template.content,
            filename: args.path,
            id,
            // inMap chains the render function through the template block
            // back to the .vue file. Without it the map's line 1 is the
            // first line of the <template> block, not of the SFC.
            // Skipped unless a map was requested: mapLines is pure cost on
            // a release build, and passing an AST would make compiler-sfc
            // ignore inMap entirely.
            ...(sourceMap ? { inMap: descriptor.template.map } : {}),
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
          // The list-view rewrite drops `, true` on one generated line. It
          // does not add or remove lines, so the template map's line numbers
          // still land; that one line's columns can drift, which DevTools
          // tolerates (it snaps to the nearest mapping).
          templateMappings = tpl.map?.mappings;
          templateStartLine = countNewlines(code) + 2;
          code += `\n${templateCode}\n__sfc__.render = render;\nexport default __sfc__;`;
        } else if (!vapor) {
          // a vapor module already ends with `export default __sfc__`
          // (vapor-sfc.ts stamps the marker there); nothing to append
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
          code += `\nimport { injectStyle as __fjsInjectStyle } from 'fjs/web-style';`;
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
            const scope = s.scoped ? id : null;
            code += `\n__fjsRegisterStyles(${scope === null ? 'null' : JSON.stringify(scope)}, ${JSON.stringify(css)});`;
          }
        }
        if (styles.some((s) => s.scoped)) {
          code += `\n__sfc__.__scopeId = ${JSON.stringify(id)};`;
        }
        // esbuild 0.23's onLoad cannot take a `map` (the flag is rejected).
        // The compiled module is what esbuild's own map calls "original";
        // rememberSfcMap lets stampDebuggerMap rebase those lines onto the
        // .vue file after the bundle exists.
        if (sourceMap) {
          const record = composeSfcMap({
            source,
            scriptMappings,
            scriptLineShift,
            templateMappings,
            templateStartLine,
          });
          if (record) rememberSfcMap(args.path, record);
          else forgetSfcMap(args.path);
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
    'fjs/vapor': path.join(root, 'src', 'vapor', 'index.ts'),
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
  const extra = [
    ...(readConfig(root).shared ?? []),
    ...(usesVapor(root) ? ['fjs/vapor', ...usedTagSpecifiers(root)] : []),
  ];
  return [...SHARED_BARE_BUILTIN, ...extra.filter((id) => !SHARED_BARE_BUILTIN.includes(id))];
}

/** `fjs/tag/<tag>` modules (specs/171) the app's vapor templates use, on
 * Flutter. They must live in the shared chunk: a tag module imports the
 * component's code by relative path, and that code reaches stateful runtime
 * modules (host-ops' element table, the router) the same way — bundled into
 * a page chunk they would be second copies. A template scan, like
 * usesVapor: a tag mentioned in no template is never imported. */
export function usedTagSpecifiers(root: string): string[] {
  const tags = tagModulesFor(false);
  const used = new Set<string>();
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith('.vue')) {
        const src = fs.readFileSync(full, 'utf8');
        for (const t of tags) if (new RegExp(`<${t}[\\s/>]`).test(src)) used.add(t);
      }
    }
  };
  walk(path.join(root, 'src'), 0);
  return [...used].sort().map((t) => `fjs/tag/${t}`);
}

/** Resolves `fjs/tag/<tag>` (specs/171) to the platform's registration
 * module. Goes LAST in a plugin list: in a --pages build the shared stub
 * plugin claims the tags the shared chunk owns first. */
export function tagModulePlugin(web: boolean): Plugin {
  return {
    name: 'fjs-tag-module',
    setup(build) {
      build.onResolve({ filter: /^fjs\/tag\// }, (args) => {
        const tag = args.path.slice('fjs/tag/'.length);
        const file = path.join(runtimeDir(), 'src', 'vapor', 'tags', web ? 'web' : 'flutter', `${tag}.ts`);
        if (!fs.existsSync(file)) return { errors: [{ text: `[fjs] no ${web ? 'web' : 'Flutter'} implementation registered for <${tag}>` }] };
        return { path: file };
      });
    },
  };
}

const vaporUse = new Map<string, boolean>();

const enableVaporUse = new Map<string, boolean>();

/** JS/TS source with `//` and block comments blanked out — string and
 * template literals kept intact, so a `'//'` inside a string is not taken
 * for a comment. Newlines survive (positions in warnings stay meaningful). */
export function stripJsComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      if (i < src.length) out += src[i];
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** specs/166: whether the app entry declares `enableVapor: true` in its
 * `createFjsApp` call — the "this app is all-Vapor" switch. A static scan
 * of the entry source, the same shape as usesVapor; the build reads it to
 * skip the compile-time wrapper (pages mount natively) and, on web, to pin
 * `vue` to the runtime-core shim so runtime-dom never enters the bundle.
 *
 * specs/167: comments are stripped first (a comment quoting the option
 * used to switch the whole app over), and only a LITERAL true counts — the
 * build decides before any code runs, so `enableVapor: flag` cannot be
 * honoured and is reported instead of guessed. */
export function usesEnableVapor(root: string, entry?: string): boolean {
  const file = path.resolve(root, entry ?? 'src/main.ts');
  const cached = enableVaporUse.get(file);
  if (cached !== undefined) return cached;
  let hit = false;
  try {
    // string contents blanked too: a URL or message quoting the option is
    // not the option
    const code = stripJsComments(fs.readFileSync(file, 'utf8')).replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
    const literal = /\benableVapor\s*:\s*(true|false)\b/.exec(code);
    hit = literal?.[1] === 'true';
    if (!literal && /\benableVapor\b/.test(code)) {
      console.warn(
        `[fjs] ${path.relative(root, file)}: enableVapor must be the literal \`true\` — ` +
          'the build reads it statically before any code runs; treating the app as NOT enableVapor.',
      );
    }
  } catch {
    // no readable entry: not declared
  }
  enableVaporUse.set(file, hit);
  return hit;
}

const warnedVueRouter = new Set<string>();

/** specs/167: under enableVapor, vue-router's own useRouter/useRoute are
 * runtime-core injects that a vapor page (no Vue app installed the router)
 * never satisfies — they return undefined. 'fjs/router' has both, on both
 * targets. Warn once per file rather than let the page break silently. */
export function warnVueRouterInVapor(file: string, source: string): void {
  if (warnedVueRouter.has(file)) return;
  const m = /import\s*\{([^}]*)\}\s*from\s*['"]vue-router['"]/.exec(stripJsComments(source));
  if (!m || !/\b(useRouter|useRoute)\b/.test(m[1])) return;
  warnedVueRouter.add(file);
  console.warn(
    `[fjs] ${path.basename(file)}: useRouter/useRoute from 'vue-router' return undefined in an enableVapor app — ` +
      "import them from 'fjs/router' instead.",
  );
}

/** Whether the app has a Vapor component (specs/148): its own
 * `enableVapor: true` in the entry (specs/177), a `<script setup vapor>`
 * under src/, or — with fjs.vapor.libs on — a direct
 * dependency that ships `.vue` files. A `--pages` build then shares
 * `fjs/vapor` (runtime-vapor and the DOM shell) from the shared chunk: one
 * runtime-vapor per VM, however many page chunks have Vapor components.
 * Apps without one never load it. */
export function usesVapor(root: string): boolean {
  let hit = vaporUse.get(root);
  if (hit !== undefined) return hit;
  const vueFiles = (dir: string, depth: number, visit: (file: string) => boolean): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && depth > 0 && vueFiles(full, depth - 1, visit)) return true;
      } else if (e.name.endsWith('.vue') && visit(full)) return true;
    }
    return false;
  };
  // specs/177: an enableVapor app compiles its SFCs as vapor with or
  // without the attribute — the entry's switch is the answer
  hit = usesEnableVapor(root) || vueFiles(path.join(root, 'src'), 12, (f) => /<script\b[^>]*\svapor\b/.test(fs.readFileSync(f, 'utf8')));
  if (!hit && readConfig(root).vapor?.libs !== false) {
    let deps: string[] = [];
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
      deps = Object.keys(pkg.dependencies ?? {});
    } catch {
      // no package.json: nothing to scan
    }
    hit = deps.some((dep) => vueFiles(path.join(root, 'node_modules', dep), 4, () => true));
  }
  vaporUse.set(root, hit);
  return hit;
}

function sharedBareRe(shared: string[]): RegExp {
  const escaped = shared.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^(${escaped.join('|')})$`);
}

/** The pre-scan twin of [sharedStubPlugin] (specs/169): the same shared
 * specifiers (bare, `@ufjs/runtime/*`, the app's shared modules) resolve as
 * EXTERNAL instead of to the `__FJS_SHARED` stub, so an ESM build of the page
 * chunks and the entry keeps their `import { … } from '<spec>'` statements —
 * which is how the release build learns which names each shared module must
 * export. App modules come back as their shared key. */
export function sharedExternalPlugin(
  appModules?: Map<string, string>,
  shared: string[] = SHARED_BARE_BUILTIN,
): Plugin {
  const byPath = new Map<string, string>();
  for (const [key, abs] of appModules ?? []) byPath.set(abs, key);
  const bareRe = sharedBareRe(shared);
  return {
    name: 'fjs-shared-external',
    setup(build) {
      build.onResolve({ filter: bareRe }, (args) => ({ path: args.path, external: true }));
      build.onResolve({ filter: RUNTIME_PACKAGE_RE }, (args) => {
        const id = runtimeSpecifier(args.path);
        return bareRe.test(id) ? { path: id, external: true } : undefined;
      });
      if (byPath.size) {
        build.onResolve({ filter: /^[./]/ }, async (args) => {
          if ((args.pluginData as { skip?: boolean } | undefined)?.skip) return null;
          const resolved = await build.resolve(args.path, {
            importer: args.importer,
            resolveDir: args.resolveDir,
            kind: args.kind,
            pluginData: { skip: true },
          });
          if (resolved.errors.length) return resolved;
          const key = byPath.get(resolved.path);
          return key ? { path: key, external: true } : resolved;
        });
      }
    },
  };
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
 * Must be used WITHOUT runtimeAliases()/vuePinPlugin(), which would win
 * resolution and pull the runtime into the app bundle again. */
export function sharedStubPlugin(
  appModules?: Map<string, string>,
  shared: string[] = SHARED_BARE_BUILTIN,
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
          return { path: key, namespace: 'fjs-shared-stub' };
        });
      }
      build.onLoad({ filter: /.*/, namespace: 'fjs-shared-stub' }, (args) => ({
        contents: `module.exports = globalThis.__FJS_SHARED[${JSON.stringify(args.path)}];`,
        loader: 'js',
      }));
    },
  };
}

/** enableVapor's web pin (specs/166): `vue` resolves to the runtime-core
 * dist — NOT the vue package, whose entry is runtime-dom. Nothing in a
 * pure-vapor app may touch the DOM renderer: the shell is vapor, pages are
 * vapor, and vue-router only needs runtime-core's reactivity and component
 * APIs (it is never installed on a Vue app here). */
export function webPureVaporPinPlugin(interop = false): Plugin {
  return {
    name: 'fjs-web-pure-vapor-pin',
    setup(build) {
      const nm = path.join(runtimeDir(), 'node_modules');
      const pinned: Record<string, string> = {
        // specs/167: runtime-core + the vapor-aware lifecycle/provide/inject
        // (the module re-exports the same runtime-core dist the vapor
        // runtime links, so reactivity stays one copy). specs/182: with a
        // VDOM component library, runtime-dom on top of it
        vue: path.join(runtimeDir(), 'src', 'vapor', interop ? 'vue-interop.ts' : 'vue-pure.ts'),
        'vue-router': path.join(nm, 'vue-router', 'dist', 'vue-router.mjs'),
      };
      build.onResolve({ filter: /^(vue|vue-router)$/ }, (args) => {
        const target = pinned[args.path];
        if (!target || !fs.existsSync(target)) return undefined;
        return { path: fs.realpathSync(target) };
      });
    },
  };
}

/** Resolve aliases for a web build: the fjs specifiers point at the DOM
 * implementations (vue-router-backed router, DOM tag components). Under
 * enableVapor (specs/166) `fjs/app` is the pure-vapor shell: the vdom
 * shell's `createApp`/`Transition` imports cannot even resolve against the
 * runtime-core pin, so it must stay out of the graph entirely. */
export function webAliases(enableVapor = false, interop = false): Record<string, string> {
  const root = runtimeDir();
  return withPackageAliases({
    fjs: path.join(root, 'src', 'index.ts'),
    'fjs/vue': path.join(root, 'src', 'vue', 'index.ts'),
    'fjs/web': path.join(root, 'src', 'web', 'index.ts'),
    // what generated SFC code imports for <style> (specs/168): the leaf
    // module, not the 'fjs/web' entry and its whole component table
    'fjs/web-style': path.join(root, 'src', 'web', 'inject-style.ts'),
    // enableVapor (specs/173): the history router, no vue-router in the graph
    'fjs/router': path.join(root, 'src', 'router', enableVapor ? 'web-vapor.ts' : 'web.ts'),
    'fjs/app': path.join(root, 'src', 'app', enableVapor ? 'web-vapor.ts' : 'web.ts'),
    // enableVapor: the interop-free vapor surface — no createRenderer, no
    // adopt machinery, no runtime-core renderer engine in the bundle —
    // unless a VDOM component library needs the interop (specs/182)
    'fjs/vapor': path.join(root, 'src', 'vapor', enableVapor && !interop ? 'web-pure.ts' : 'web.ts'),
  });
}

/** Resolve aliases for a Flutter build. */
export function flutterAliases(enableVapor = false, interop = false): Record<string, string> {
  const root = runtimeDir();
  return withPackageAliases({
    ...runtimeAliases(),
    'fjs/router': path.join(root, 'src', 'router', 'flutter.ts'),
    // enableVapor (specs/169): the pure-vapor surfaces, the twins of web's
    // web-vapor.ts / web-pure.ts — no built-in VDOM components, no VDOM
    // page mounter, no interop, and `fjs/vue` without createApp/render, so
    // runtime-core's rendering engine is not in the graph at all
    ...(enableVapor
      ? {
          'fjs/app': path.join(root, 'src', 'app', 'flutter-vapor.ts'),
          // specs/182: a VDOM component library keeps the interop surface
          'fjs/vapor': path.join(root, 'src', 'vapor', interop ? 'index.ts' : 'flutter-pure.ts'),
          // specs/182: the interop keeps the full surface (createApp —
          // what an app-side patch of vant's imperative mounts imports)
          'fjs/vue': path.join(root, 'src', 'vue', interop ? 'index.ts' : 'index-vapor.ts'),
        }
      : { 'fjs/app': path.join(root, 'src', 'app', 'flutter.ts') }),
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

// ---- SFC source map (spec 094) ---------------------------------------------
//
// compiler-sfc hands back two maps: script (already in SFC coordinates) and
// template (in SFC coordinates only when `inMap` chained the block). The
// module we return is those two texts concatenated, plus a few glue lines.
// A library would rebase the VLQ deltas across that boundary; both maps use
// a single source and an empty names array, so decoding to absolute
// positions, shifting the generated line, and re-encoding is the whole job.
// No new dependency — release builds never call this.

const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

function vlqDecode(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (let i = 0; i < segment.length; i++) {
    const integer = VLQ_CHARS.indexOf(segment[i]);
    if (integer < 0) continue;
    const cont = integer & 32;
    value += (integer & 31) * 2 ** shift;
    if (cont) {
      shift += 5;
      continue;
    }
    const neg = value & 1;
    value = Math.floor(value / 2);
    out.push(neg ? -value : value);
    value = 0;
    shift = 0;
  }
  return out;
}

function vlqEncode(n: number): string {
  let vlq = n < 0 ? -n * 2 + 1 : n * 2;
  let encoded = '';
  do {
    let digit = vlq & 31;
    vlq = Math.floor(vlq / 32);
    if (vlq > 0) digit |= 32;
    encoded += VLQ_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

interface MappedSeg {
  genLine: number;
  genCol: number;
  src: number;
  origLine: number;
  origCol: number;
  name?: number;
}

/** Absolute positions. Segments without an original location are dropped. */
function decodeMappings(mappings: string): MappedSeg[] {
  const segs: MappedSeg[] = [];
  const lines = mappings.split(';');
  let src = 0;
  let origLine = 0;
  let origCol = 0;
  let name = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    let genCol = 0;
    for (const part of lines[i].split(',')) {
      if (!part) continue;
      const v = vlqDecode(part);
      if (v.length === 0) continue;
      genCol += v[0];
      if (v.length >= 4) {
        src += v[1];
        origLine += v[2];
        origCol += v[3];
        const seg: MappedSeg = { genLine: i + 1, genCol, src, origLine, origCol };
        if (v.length >= 5) {
          name += v[4];
          seg.name = name;
        }
        segs.push(seg);
      }
    }
  }
  return segs;
}

function encodeMappings(segs: MappedSeg[]): string {
  const byLine = new Map<number, MappedSeg[]>();
  let max = 0;
  for (const s of segs) {
    if (s.genLine < 1) continue;
    if (s.genLine > max) max = s.genLine;
    const list = byLine.get(s.genLine);
    if (list) list.push(s);
    else byLine.set(s.genLine, [s]);
  }
  let src = 0;
  let origLine = 0;
  let origCol = 0;
  let name = 0;
  const lines: string[] = [];
  for (let line = 1; line <= max; line++) {
    const list = byLine.get(line) ?? [];
    list.sort((a, b) => a.genCol - b.genCol);
    let genCol = 0;
    const parts: string[] = [];
    for (const s of list) {
      let piece =
        vlqEncode(s.genCol - genCol) +
        vlqEncode(s.src - src) +
        vlqEncode(s.origLine - origLine) +
        vlqEncode(s.origCol - origCol);
      genCol = s.genCol;
      src = s.src;
      origLine = s.origLine;
      origCol = s.origCol;
      if (s.name != null) {
        piece += vlqEncode(s.name - name);
        name = s.name;
      }
      parts.push(piece);
    }
    lines.push(parts.join(','));
  }
  return lines.join(';');
}

interface SfcMapRecord {
  source: string;
  segs: MappedSeg[];
}

/** Keyed by the absolute .vue path. One dev-server process, overwritten on
 * each rebuild of that file. Not consulted unless the build asked for maps. */
const sfcMaps = new Map<string, SfcMapRecord>();

function rememberSfcMap(file: string, record: SfcMapRecord): void {
  sfcMaps.set(path.resolve(file), record);
}

function forgetSfcMap(file: string): void {
  sfcMaps.delete(path.resolve(file));
}

function composeSfcMap(args: {
  source: string;
  scriptMappings?: string;
  scriptLineShift: number;
  templateMappings?: string;
  templateStartLine: number;
}): SfcMapRecord | undefined {
  const segs: MappedSeg[] = [];
  if (args.scriptMappings) {
    for (const s of decodeMappings(args.scriptMappings)) {
      segs.push({ ...s, src: 0, genLine: s.genLine + args.scriptLineShift });
    }
  }
  if (args.templateMappings && args.templateStartLine >= 1) {
    const shift = args.templateStartLine - 1;
    for (const s of decodeMappings(args.templateMappings)) {
      segs.push({ ...s, src: 0, genLine: s.genLine + shift });
    }
  }
  if (segs.length === 0) return undefined;
  return { source: args.source, segs };
}

/** esbuild's map points at the compiled module (that is what onLoad returned).
 * Where we recorded an SFC map for that file, rewrite the original position
 * to the .vue line and swap sourcesContent for the SFC text. Other sources
 * (plain .ts / .js) stay as esbuild emitted them; [retargetDebuggerSources]
 * is what makes those paths survive Chrome's script-URL resolution. */
export function rebaseVueSources(
  map: { sources?: string[]; sourcesContent?: Array<string | null>; mappings?: string },
  mapDir: string,
): void {
  const sources = map.sources ?? [];
  const tables = sources.map((s) => sfcMaps.get(path.resolve(mapDir, s)) ?? null);
  if (!tables.some(Boolean)) return;
  const out: MappedSeg[] = [];
  for (const seg of decodeMappings(map.mappings ?? '')) {
    const table = tables[seg.src];
    if (!table) {
      out.push(seg);
      continue;
    }
    const hit = segmentAt(table.segs, seg.origLine + 1, seg.origCol);
    if (!hit) {
      out.push(seg);
      continue;
    }
    out.push({
      genLine: seg.genLine,
      genCol: seg.genCol,
      src: seg.src,
      origLine: hit.origLine,
      origCol: hit.origCol,
    });
  }
  map.mappings = encodeMappings(out);
  const prev = map.sourcesContent ?? [];
  map.sourcesContent = sources.map((s, i) => tables[i]?.source ?? prev[i] ?? null);
}

/** Publish project files as paths relative to the eval script.
 *
 * The map travels as a data URL, so DevTools resolves `sources` against the
 * script URL, not the map file. A path relative to the script
 * (`../src/pages/about.vue` from `pages/about.js`) resolves back to
 * `src/...`, which is where a breakpoint on an imported module has to land.
 *
 * `fjs-shared-stub` entries are `module.exports = __FJS_SHARED[...]`
 * stand-ins. They are not the module; leaving them in makes the import look
 * mapped when the real file is in `shared.js`. `node_modules` stays out:
 * vue / pinia / vant are not something a breakpoint in app code should open. */
export function retargetDebuggerSources(
  map: { sources?: string[]; sourcesContent?: Array<string | null>; mappings?: string },
  mapDir: string,
  root: string,
  scriptUrl: string,
): void {
  const sources = map.sources ?? [];
  const prev = map.sourcesContent ?? [];
  const scriptDir = path.posix.dirname(scriptUrl.replace(/\\/g, '/'));
  const fromDir = scriptDir === '.' ? '' : scriptDir;
  const nextIndex = new Map<number, number>();
  const nextSources: string[] = [];
  const nextContent: Array<string | null> = [];
  sources.forEach((source, i) => {
    const rel = projectSource(source, mapDir, root);
    if (!rel) return;
    nextIndex.set(i, nextSources.length);
    // path.posix.relative('.', x) is x; from a nested script it inserts `..`
    nextSources.push(path.posix.relative(fromDir || '.', rel));
    nextContent.push(prev[i] ?? null);
  });
  const segs = decodeMappings(map.mappings ?? '')
    .filter((seg) => nextIndex.has(seg.src))
    .map((seg) => ({ ...seg, src: nextIndex.get(seg.src)! }));
  map.sources = nextSources;
  map.sourcesContent = nextContent;
  map.mappings = encodeMappings(segs);
}

function projectSource(source: string, mapDir: string, root: string): string | null {
  if (!source || source.startsWith('data:') || source.includes('fjs-shared-stub')) return null;
  const abs = path.isAbsolute(source) ? source : path.resolve(mapDir, source);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const normalized = rel.split(path.sep).join('/');
  if (normalized === 'node_modules' || normalized.startsWith('node_modules/')) return null;
  const file = path.join(root, normalized);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return normalized;
}

function segmentAt(segs: MappedSeg[], genLine: number, genCol: number): MappedSeg | undefined {
  let best: MappedSeg | undefined;
  for (const s of segs) {
    if (s.genLine !== genLine || s.genCol > genCol) continue;
    if (!best || s.genCol >= best.genCol) best = s;
  }
  return best ?? segs.find((s) => s.genLine === genLine);
}
