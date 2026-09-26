// Vite adapter for fjs apps. Runtime/native builds still go through
// `fjs build`; this plugin makes the same Vue/pages app run as a normal
// browser app during Vite dev/build.
import { pagesFor, routeTableSource, writeRouteTypes } from './project/pages.js';
import { pluginTableSource, pluginsFor } from './project/plugins.js';
import { writeAssetTypes } from './project/assets.js';
import { WORKERS_DIR, bundleWorker, workerFileForUrl, writeWorkers } from './project/workers.js';
import {
  moduleAliases,
  moduleDataDir,
  resolveModuleData,
  runModulePrepare,
  scanModules,
  widgetNativeTags,
  writeModuleTypes,
  type FjsModule,
} from './project/modules.js';
import { isNativeTagFor, runtimeDir } from './bundler/vue-plugin.js';
import { swiperChildrenTransform } from './template/swiper-children.js';
import { copyLocalDir, copyModuleDataForWeb, HTML_DIR } from './bundler/build.js';
import { moduleContentType } from './dev/server.js';
import { expandFlexDefault, rewriteFjsCss } from '../../fjs-runtime/src/web/css-compat.js';
import fs from 'node:fs';
import path from 'node:path';

const VIRTUAL_PAGES = '\0fjs-pages';
const VIRTUAL_PLUGINS = '\0fjs-plugins';
const VUE_ROUTE_BLOCK_RE = /\.vue\?vue&type=route(?:&|$)/;
const VUE_STYLE_BLOCK_RE = /\.vue\?vue&type=style(?:&|$)/;
// a stylesheet import; `?raw` / `?url` ask for the file itself, not styles
const PLAIN_CSS_RE = /\.css(?:$|\?(?!.*\b(?:raw|url)\b))/;

interface ViteConfig {
  root?: string;
}

/** The public surface of @vitejs/plugin-vue's `api`, which is a documented
 * extension point: other plugins read and write the options it compiles
 * with. Only the parts this needs are typed. */
interface VuePluginApi {
  options: {
    template?: { compilerOptions?: Record<string, unknown> } & Record<string, unknown>;
  } & Record<string, unknown>;
}

interface ResolvedViteConfig {
  plugins: readonly { name: string; api?: unknown }[];
}

interface ViteServer {
  moduleGraph: {
    getModuleById(id: string): unknown;
    invalidateModule(mod: unknown): void;
  };
}

interface HotUpdateContext {
  file: string;
  server: ViteServer;
}

interface ViteMiddlewareRequest {
  url?: string;
}

interface ViteMiddlewareResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: unknown): void;
}

interface ViteDevServer {
  middlewares: {
    use(handler: (
      req: ViteMiddlewareRequest,
      res: ViteMiddlewareResponse,
      next: () => void,
    ) => void): void;
  };
}

interface VitePlugin {
  name: string;
  enforce: 'pre';
  config(config: ViteConfig): Promise<object>;
  configResolved(config: ResolvedViteConfig): void;
  configureServer(server: ViteDevServer): void;
  writeBundle(options: { dir?: string }): void | Promise<void>;
  resolveId(id: string, importer?: string): string | null;
  load(id: string): string | null;
  transform(code: string, id: string): string | null;
  handleHotUpdate(ctx: HotUpdateContext): Promise<void>;
}

/** Whether a URL belongs to one of the two trees this plugin serves. */
function ownsWebUrl(url: string): boolean {
  return url.startsWith(`/${HTML_DIR}/`) || url.startsWith('/fjs-modules/');
}

/** The local file a dev request is asking for, or null when there is none.
 *
 * Only the two prefixes this plugin owns, and never outside their own
 * directory: a vite dev server is reachable from the LAN, so `..` in a URL
 * must not walk out. */
function localWebFile(root: string, modules: FjsModule[], url: string): string | null {
  let dir: string | null = null;
  let relative = '';
  if (url.startsWith(`/${HTML_DIR}/`)) {
    dir = path.join(root, HTML_DIR);
    relative = url.slice(HTML_DIR.length + 2);
  } else if (url.startsWith('/fjs-modules/')) {
    const rest = url.slice('/fjs-modules/'.length);
    const cut = rest.indexOf('/');
    if (cut < 0) return null;
    const short = rest.slice(0, cut);
    const mod = modules.find((m) => m.name.replace(/^@[^/]+\//, '') === short);
    if (!mod) return null;
    dir = path.resolve(moduleDataDir(root, mod.name));
    relative = rest.slice(cut + 1);
  }
  if (dir == null || !relative) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const file = path.resolve(dir, decoded);
  if (file !== dir && !file.startsWith(dir + path.sep)) return null;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return file;
}

export function fjs(): VitePlugin {
  let root = process.cwd();
  // widget tags with no web stand-in: elements here too, so Vue does not
  // warn about an unresolved component for something only Flutter renders
  let nativeTags: string[] = [];
  let modules: FjsModule[] = [];
  return {
    name: 'fjs-vite',
    enforce: 'pre',
    async config(config) {
      root = config.root ? path.resolve(config.root) : process.cwd();
      writeRouteTypes(root);
      writeAssetTypes(root);
      modules = scanModules(root);
      // a module's own build step, before anything imports what it writes
      await runModulePrepare(root, 'web', modules);
      writeModuleTypes(root, modules);
      nativeTags = widgetNativeTags(modules, 'web');
      const runtime = runtimeDir();
      return {
        resolve: {
          alias: [
            // src/modules/<name> is imported by its package name, the same
            // specifier the published package would answer to
            ...Object.entries(moduleAliases(root, modules)).map(([name, file]) => ({
              find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
              replacement: file,
            })),
            // `@/x` -> `<root>/src/x`, matching what `fjs build` resolves.
            { find: /^@\//, replacement: `${path.join(root, 'src')}/` },
            { find: /^fjs\/app$/, replacement: path.join(runtime, 'src', 'app', 'web.ts') },
            { find: /^fjs\/router$/, replacement: path.join(runtime, 'src', 'router', 'web.ts') },
            { find: /^fjs\/web$/, replacement: path.join(runtime, 'src', 'web', 'index.ts') },
            { find: /^fjs\/vue$/, replacement: path.join(runtime, 'src', 'vue', 'index.ts') },
            { find: /^fjs$/, replacement: path.join(runtime, 'src', 'index.ts') },
          ],
        },
      };
    },
    // @vitejs/plugin-vue compiles with compiler-dom's defaults, under which
    // <view>, <text>, <image>, <switch>, <input>, <button> and <progress>
    // are native tags: they would render verbatim and `@tap` would become a
    // listener for a DOM event named "tap" that nothing ever fires. The
    // esbuild web build passes the same predicate to compileTemplate; here
    // it has to go through the vue plugin's options.
    //
    // 'pre' puts this hook ahead of vite:vue's own configResolved, which
    // spreads the existing options and so keeps what is set here.
    configResolved(config) {
      const vue = config.plugins.find((p) => p.name === 'vite:vue');
      const api = vue?.api as VuePluginApi | undefined;
      if (!api?.options) {
        console.warn(
          '[fjs] @vitejs/plugin-vue not found in the Vite config — the fjs ' +
            'tags will compile as native DOM elements and nothing will be ' +
            "interactive. Add vue() to plugins: [fjs(), vue()].",
        );
        return;
      }
      const { template } = api.options;
      api.options = {
        ...api.options,
        template: {
          ...template,
          compilerOptions: {
            ...template?.compilerOptions,
            // isNativeTagFor asks the component tags first — `textarea` is
            // one of them and is also a real HTML tag, so a plain
            // webIsNativeTag would render a DOM <textarea> and drop every
            // fjs prop on the floor (specs/012 plan §3.7).
            isNativeTag: (tag: string) =>
              isNativeTagFor(tag, {
                web: true,
                moduleTags: new Set(nativeTags),
              }),
            // <swiper> children must be <swiper-item> (specs/051); appended
            // so a project's own transforms keep running
            nodeTransforms: [
              ...((template?.compilerOptions?.nodeTransforms as unknown[] | undefined) ?? []),
              swiperChildrenTransform,
            ],
          },
        },
      };
    },
    // Two trees vite would not serve on its own: the project's html/ pages
    // and each module's generated files. Not `publicDir` — vite has exactly
    // one and it belongs to the app, so overriding it would take away
    // public/. A middleware in dev and a copy at build time is the whole
    // mechanism (specs/018-src-hints-and-html-dir).
    configureServer(server) {
      // worker scripts (specs/049): bundled from src/workers per request
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith(`/${WORKERS_DIR}/`)) {
          next();
          return;
        }
        const file = workerFileForUrl(root, url);
        if (!file) {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end(`not found: ${url}\n`);
          return;
        }
        bundleWorker(root, file).then(
          (code) => {
            res.setHeader('content-type', 'application/javascript; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(code);
          },
          (err: unknown) => {
            res.statusCode = 500;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end(`worker ${url} failed to build: ${err instanceof Error ? err.message : err}\n`);
          },
        );
      });
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!ownsWebUrl(url)) {
          next();
          return;
        }
        const file = localWebFile(root, modules, url);
        if (!file) {
          // A miss under a prefix this plugin owns is a 404, not vite's SPA
          // fallback. Falling through would answer a missing page with
          // index.html and a 200, which inside a <web-view> looks like the
          // app rendering itself in a box and says nothing about the typo
          // (constitution V; the fjs dev server does the same in
          // dev/server.ts).
          res.statusCode = 404;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end(`not found: ${url}\n`);
          return;
        }
        res.setHeader('content-type', moduleContentType(file));
        res.setHeader('cache-control', 'no-store');
        res.end(fs.readFileSync(file));
      });
    },
    async writeBundle(options) {
      // the same two trees, for `vite build`
      const outDir = options.dir ?? path.join(root, 'dist');
      copyLocalDir(path.join(root, HTML_DIR), path.join(outDir, HTML_DIR));
      copyModuleDataForWeb(root, outDir);
      await writeWorkers(root, outDir, { minify: true });
    },
    resolveId(id, importer) {
      if (id === 'fjs/pages') return VIRTUAL_PAGES;
      if (id === 'fjs/plugins') return VIRTUAL_PLUGINS;
      // what a module's prepare hook generated for this project
      if (id.startsWith('fjs/data/') && importer) {
        return resolveModuleData(root, modules, importer, id);
      }
      return null;
    },
    load(id) {
      if (VUE_ROUTE_BLOCK_RE.test(id)) return 'export default {}';
      if (id === VIRTUAL_PLUGINS) {
        return pluginTableSource(pluginsFor(root, 'web'), scanModules(root), 'web');
      }
      if (id !== VIRTUAL_PAGES) return null;
      return routeTableSource(pagesFor(root, 'web'), 'web', false);
    },
    // `flex-grow: n` and `direction: horizontal` are fjs style keys, not the
    // CSS ones. injectStyle() rewrites them in the esbuild web build; here
    // the SFC <style> blocks go straight to vite:css instead, so without
    // this a page's flex-grow children keep their natural size and push the
    // tabBar off-screen. 'pre' runs this on the raw block, before scoping.
    //
    // Plain .css imports (a component library's dist styles, the project's
    // own sheets) are standard CSS, not fjs dialect, so they only get the
    // flex-direction default (specs/140) — the App engine reads every sheet
    // with that rule, and NutUI's <view>s rely on it. A raw scss block is
    // skipped for the same reason: its nesting would fool the rule scanner.
    transform(code, id) {
      if (VUE_STYLE_BLOCK_RE.test(id)) {
        return rewriteFjsCss(code, { flexDefault: !/[&?]lang\.(?!css\b)/.test(id) });
      }
      return PLAIN_CSS_RE.test(id) ? expandFlexDefault(code) : null;
    },
    async handleHotUpdate(ctx) {
      // an edit can change what a module generates — the icons a page names,
      // the strings it translates — so the hooks run again before the reload
      if (ctx.file.includes(`${path.sep}src${path.sep}`) && modules.some((m) => m.prepare)) {
        await runModulePrepare(root, 'web', modules);
      }
      if (ctx.file.includes(`${path.sep}src${path.sep}pages${path.sep}`)) {
        writeRouteTypes(root);
        const mod = ctx.server.moduleGraph.getModuleById(VIRTUAL_PAGES);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      }
      // a module's components are registered through the same generated
      // list, and its API surface is part of the generated types
      if (ctx.file.includes(`${path.sep}src${path.sep}modules${path.sep}`)) {
        writeModuleTypes(root);
        const mod = ctx.server.moduleGraph.getModuleById(VIRTUAL_PLUGINS);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      }
      // adding or removing a plugin file changes the generated list, which
      // no page imports directly — invalidate it by hand
      if (ctx.file.includes(`${path.sep}src${path.sep}plugins${path.sep}`)) {
        const mod = ctx.server.moduleGraph.getModuleById(VIRTUAL_PLUGINS);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      }
    },
  };
}
