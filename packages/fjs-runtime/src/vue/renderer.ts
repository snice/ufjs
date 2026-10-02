// Vue 3 custom renderer for fjs. Maps Vue vnodes onto the fjs element
// protocol: elements are native view nodes, text is a 'text' node, events
// (onTap etc.) cross as markers with handlers kept in the JS registry.
//
// App usage:
//   import { createApp, ref } from 'vue';
//   import { flutterRoot } from 'fjs/vue';
//   const root = flutterRoot();
//   createApp(App).mount(root);
//
// specs/169: the host primitives live in ./host-ops (re-exported below);
// this module is only the createRenderer call and the app helpers on top
// of it — the part a pure-vapor bundle must not import.
import { createRenderer } from '@vue/runtime-core';
import { nodeOps, patchProp, type HostNode } from './host-ops';

export * from './host-ops';

// ---- public API ---------------------------------------------------------------

const { createApp: rendererCreateApp, render, internals } = createRenderer<HostNode, HostNode>({
  ...nodeOps,
  patchProp,
}) as ReturnType<typeof createRenderer<HostNode, HostNode>> & { internals: unknown };

/** runtime-vapor's VDOM interop mounts VDOM components inside Vapor blocks
 * through the renderer's internals (`ensureRenderer().internals`, resolved
 * to this renderer by vue/runtime-dom-shim.ts). */
export const rendererInternals = internals;

type App = ReturnType<typeof rendererCreateApp>;
const appHooks: ((app: App) => void)[] = [];
const liveApps: App[] = [];

/** Runs `hook` on every app created so far and every later one. Vapor
 * support installs itself this way the first time a Vapor component module
 * loads, so apps without one never pull runtime-vapor in (specs/148). */
export function onEveryApp(hook: (app: App) => void): void {
  appHooks.push(hook);
  for (const app of liveApps) hook(app);
}

export function createApp(...args: Parameters<typeof rendererCreateApp>) {
  const app = rendererCreateApp(...args);
  liveApps.push(app);
  const unmount = app.unmount.bind(app);
  app.unmount = () => {
    liveApps.splice(liveApps.indexOf(app), 1);
    unmount();
  };
  for (const hook of appHooks) hook(app);
  return app;
}


/** Manual render escape hatch (mostly for tests). */
export { render };
