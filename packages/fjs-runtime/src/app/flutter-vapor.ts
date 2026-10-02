// createFjsApp for Flutter in enableVapor mode (specs/169) — the twin of
// app/web-vapor.ts. The CLI aliases 'fjs/app' here when the app entry
// declares `enableVapor: true`, so the vdom app (app/flutter.ts) — the
// built-in components (VDOM: canvas / list-view / form / picker / rich-text
// / textarea / defer) and the router's VDOM page mounter — never enters the
// bundle, and with it runtime-core's rendering engine. The built-in
// components are not available to vapor pages here (the same boundary web
// has had since specs/166); they come back once rewritten as vapor
// components. Everything else matches app/flutter.ts's enableVapor branch:
// plugins and setup run once against the app shell, pages mount through the
// vapor runtime with their own provides.
import type { App } from '@vue/runtime-core';
import { createRouter } from '../router/flutter';
import type { Router } from '../router/types';
import type { VaporAppContext } from '../vapor/instance';
import type { FjsAppOptions } from './flutter';
import { applyPlugins } from './plugin';
import { createVaporAppShell } from './vapor-app';

export interface FjsApp {
  readonly router: Router;
  mount(): void;
}

export function createFjsApp(options: FjsAppOptions): FjsApp {
  const vaporContext: VaporAppContext = {
    components: { ...options.components },
    provides: Object.create(null) as Record<string | symbol, unknown>,
  };
  const shell = createVaporAppShell(vaporContext);
  applyPlugins(shell as unknown as App, options.plugins);
  options.setup?.(shell as unknown as App);
  const router = createRouter({ ...options, enableVapor: true, vaporContext });
  return {
    router,
    mount() {
      router.start();
    },
  };
}

export { useRouter, useRoute, definePage } from '../router/flutter';
export type { FjsPlugin } from './plugin';
export type { Router, RouteLocation, RouteRecord, RouteMeta } from '../router/types';
export type { FjsAppOptions } from './flutter';
