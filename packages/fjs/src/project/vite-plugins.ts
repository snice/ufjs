// App-build hooks contributed by the project's Vite plugins.
//
// The app bundle (`fjs build` / `fjs dev`) is esbuild, not Vite, so the
// project's vite.config plugins never run there. Library adapters still
// belong in the project's Vite config — one place, both platforms — so a
// Vite plugin can opt in to the app build by carrying an `fjs.app` hook:
//
//   { name: 'my-ui', fjs: { app: { filter: /\/my-ui\/dist\/.*\.mjs$/,
//       transform(code, id) { return patched } } } }
//
// Only plugins that declare the hook run; every other plugin in the config
// (plugin-vue, fjs() itself) stays web-only, as before. UI-library specifics
// live in such plugins — project-local, next to the vite.config — never in
// the CLI or runtime.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Loader, Plugin } from 'esbuild';

/** The `fjs.app` hook of a Vite plugin. */
export interface FjsAppHook {
  /** The contributing plugin, for error messages. */
  plugin: string;
  /** Which files the hook sees: an esbuild onLoad filter, so Go RegExp
   * syntax (no lookarounds or backreferences). Matched against the
   * absolute path. */
  filter: RegExp;
  /** Returns the new source, or null/undefined to leave the file as is. */
  transform(code: string, id: string): string | null | undefined | Promise<string | null | undefined>;
}

const CONFIG_FILES = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];

const cache = new Map<string, Promise<FjsAppHook[]>>();

/** The `fjs.app` hooks of the project's Vite plugins, loaded once per
 * process (a config edit needs a dev-server restart, like any Vite one).
 * No config, or no Vite installed, is simply no hooks. */
export function loadViteAppHooks(root: string): Promise<FjsAppHook[]> {
  let pending = cache.get(root);
  if (!pending) {
    pending = loadHooks(root);
    cache.set(root, pending);
  }
  return pending;
}

async function loadHooks(root: string): Promise<FjsAppHook[]> {
  const file = CONFIG_FILES.map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!file) return [];
  let vite: { loadConfigFromFile: (env: object, file: string, root: string) => Promise<{ config: { plugins?: unknown[] } } | null> };
  try {
    const resolved = createRequire(path.join(root, 'package.json')).resolve('vite');
    vite = await import(pathToFileURL(resolved).href);
  } catch {
    return []; // a config without vite installed cannot carry app hooks either
  }
  const loaded = await vite.loadConfigFromFile(
    { command: 'build', mode: 'production', isSsrBuild: false, isPreview: false },
    file,
    root,
  );
  return collectAppHooks(loaded?.config.plugins ?? []);
}

/** The `fjs.app` hooks among a Vite `plugins` list (nested arrays, promises
 * and falsy entries allowed, as Vite does); plugins without one are skipped. */
export async function collectAppHooks(plugins: unknown[]): Promise<FjsAppHook[]> {
  const hooks: FjsAppHook[] = [];
  for (const plugin of await flatten(plugins)) {
    const p = plugin as { name?: string; fjs?: { app?: Partial<FjsAppHook> } };
    const app = p.fjs?.app;
    if (!app) continue;
    const name = p.name ?? '(anonymous)';
    if (!(app.filter instanceof RegExp) || typeof app.transform !== 'function') {
      throw new Error(`vite plugin "${name}": fjs.app needs a RegExp \`filter\` and a \`transform\` function`);
    }
    hooks.push({ plugin: name, filter: app.filter, transform: app.transform.bind(app) });
  }
  return hooks;
}

/** Vite accepts nested arrays, promises and falsy entries in `plugins`. */
async function flatten(list: unknown[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const item of list) {
    const value = await item;
    if (!value) continue;
    if (Array.isArray(value)) out.push(...(await flatten(value)));
    else out.push(value);
  }
  return out;
}

const LOADERS: Record<string, Loader> = { '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx' };

/** Runs the hooks inside an esbuild app build. One onLoad for all of them —
 * esbuild stops at the first onLoad that returns contents, so hooks that
 * match the same file are chained here, in config order. Registered after
 * the SFC plugin: `.vue` and `.css` stay fjs's to compile. */
export function viteAppHooksPlugin(hooks: FjsAppHook[]): Plugin {
  return {
    name: 'fjs-vite-app-hooks',
    setup(build) {
      if (!hooks.length) return;
      const filter = new RegExp(hooks.map((h) => `(?:${h.filter.source})`).join('|'));
      build.onLoad({ filter, namespace: 'file' }, async (args) => {
        const id = args.path.split(path.sep).join('/');
        const matching = hooks.filter((h) => h.filter.test(id));
        if (!matching.length) return undefined;
        let code = await fs.promises.readFile(args.path, 'utf8');
        let changed = false;
        for (const hook of matching) {
          let next: string | null | undefined;
          try {
            next = await hook.transform(code, id);
          } catch (e) {
            throw new Error(`vite plugin "${hook.plugin}" fjs.app.transform failed on ${id}: ${(e as Error).message}`);
          }
          if (typeof next === 'string' && next !== code) {
            code = next;
            changed = true;
          }
        }
        if (!changed) return undefined;
        return {
          contents: code,
          loader: LOADERS[path.extname(args.path)] ?? 'js',
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}
