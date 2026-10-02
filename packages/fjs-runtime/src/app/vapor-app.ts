// The App an enableVapor app's `setup(app)` and plugins receive (specs/167).
// There is no Vue app in that mode (specs/166) — pages mount through the
// vapor runtime — yet the ecosystem's entry point IS `app.use(plugin)`:
// pinia installs by `app.provide(piniaSymbol)` + `setActivePinia` and later
// runs every store setup through `pinia._a.runWithContext`. This shell
// implements the part of the App surface those installs use, against the
// VaporAppContext every vapor page resolves through (provides → vapor
// inject, components → resolveComponent). What has no vapor counterpart
// (mixins, a second mount) warns once instead of vanishing.
//
// Not a real runtime-core App on purpose: createRenderer().createApp would
// drag the renderer engine back into the enableVapor web bundle.
import { runWithVaporContext, setVaporErrorHandlerSource, type VaporAppContext } from '../vapor/instance';

type Plugin =
  | ((app: FjsVaporApp, ...options: unknown[]) => unknown)
  | { install: (app: FjsVaporApp, ...options: unknown[]) => unknown };

export interface FjsVaporApp {
  readonly version: string;
  readonly config: {
    globalProperties: Record<string, unknown>;
    errorHandler?: (err: unknown, instance: null, info: string) => void;
    warnHandler?: (msg: string, instance: null, trace: string) => void;
  };
  use(plugin: Plugin, ...options: unknown[]): FjsVaporApp;
  provide(key: string | symbol | object, value: unknown): FjsVaporApp;
  component(name: string): unknown;
  component(name: string, comp: unknown): FjsVaporApp;
  runWithContext<T>(fn: () => T): T;
  mixin(mixin: unknown): FjsVaporApp;
  directive(name: string): unknown;
  directive(name: string, directive: unknown): FjsVaporApp;
  mount(): FjsVaporApp;
  unmount(): void;
}

const warned = new Set<string>();
function warnOnce(what: string): void {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[fjs] app.${what} is not supported with enableVapor (specs/167) — ignored`);
}

export function createVaporAppShell(ctx: VaporAppContext): FjsVaporApp {
  const installed = new Set<unknown>();
  if (!ctx.provides) ctx.provides = Object.create(null) as Record<string | symbol, unknown>;
  const app: FjsVaporApp = {
    version: '3.5-vapor',
    config: { globalProperties: {} },
    use(plugin, ...options) {
      if (installed.has(plugin)) return app;
      installed.add(plugin);
      if (typeof plugin === 'function') plugin(app, ...options);
      else if (plugin && typeof plugin.install === 'function') plugin.install(app, ...options);
      return app;
    },
    provide(key, value) {
      (ctx.provides as Record<string | symbol, unknown>)[key as string | symbol] = value;
      return app;
    },
    component(name: string, comp?: unknown) {
      if (comp === undefined) return ctx.components[name];
      ctx.components[name] = comp;
      return app;
    },
    runWithContext(fn) {
      return runWithVaporContext(ctx, fn);
    },
    mixin() {
      warnOnce('mixin');
      return app;
    },
    // object-hook directives run through the vapor adapter (specs/181)
    directive(name: string, directive?: unknown) {
      const dirs = (ctx.directives ??= Object.create(null) as Record<string, unknown>);
      if (directive === undefined) return dirs[name];
      dirs[name] = directive;
      return app;
    },
    // createFjsApp owns mounting; a plugin calling these is a misuse
    mount() {
      warnOnce('mount');
      return app;
    },
    unmount() {
      warnOnce('unmount');
    },
  } as FjsVaporApp;
  // effect / hook errors reach the handler assigned here, read at error time
  setVaporErrorHandlerSource(() => app.config.errorHandler);
  return app;
}
