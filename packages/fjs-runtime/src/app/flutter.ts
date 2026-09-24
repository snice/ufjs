// createFjsApp for Flutter targets. Each route is a native Navigator page
// with its own Vue app rooted in its own element tree, so the platform's
// back gesture and push animation apply to real Flutter routes — see
// router/flutter.ts for the wire protocol.
import type { App } from '@vue/runtime-core';
import { createRouter, onPageSettled, type FlutterRouterOptions } from '../router/flutter';
import type { Router } from '../router/types';
import { createFjsCanvas } from '../components/canvas';
import { createDefer } from '../components/defer';
import { FjsForm } from '../components/form';
import { FjsListView } from '../components/list-view';
import { FjsPicker } from '../components/picker';
import { FjsRichText } from '../components/rich-text';
import { FjsTextarea } from '../components/textarea';
import { applyPlugins, type FjsPlugin } from './plugin';

export interface FjsAppOptions extends FlutterRouterOptions {
  /** App plugins, applied in order before [setup]. Normally the generated
   * list: `import { plugins } from 'fjs/plugins'`. */
  plugins?: readonly FjsPlugin[];
  /** Called with the Vue app before it is mounted. On Flutter this runs
   * once per page (each page is its own app). */
  setup?: (app: App) => void;
  /** Web only: mount target. Ignored here. */
  el?: string | unknown;
}

export interface FjsApp {
  readonly router: Router;
  mount(): void;
}

export function createFjsApp(options: FjsAppOptions): FjsApp {
  const router = createRouter({
    ...options,
    onCreateApp(app) {
      // the surface is the `inner-canvas` ELEMENT here; on web the same
      // factory is pointed at the web adapter's component
      app.component('canvas', createFjsCanvas('inner-canvas'));
      app.component('list-view', FjsListView);
      app.component('form', FjsForm);
      app.component('picker', FjsPicker);
      app.component('rich-text', FjsRichText);
      app.component('textarea', FjsTextarea);
      app.component('defer', FjsDefer);
      applyPlugins(app, options.plugins);
      options.setup?.(app);
    },
  });
  return {
    router,
    mount() {
      router.start();
    },
  };
}

/** `<defer>` on the Flutter host (components/defer.ts). Exported for code
 * that builds its own app outside createFjsApp — demo/bench/mount.ts. */
export const FjsDefer = createDefer(onPageSettled, 'view');

export { useRouter, useRoute, definePage } from '../router/flutter';
export type { FjsPlugin } from './plugin';
export type { Router, RouteLocation, RouteRecord, RouteMeta } from '../router/types';
