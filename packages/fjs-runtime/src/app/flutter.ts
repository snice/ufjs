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
import { createVaporAppShell } from './vapor-app';
import type { VaporAppContext } from '../vapor/instance';

export interface FjsAppOptions extends FlutterRouterOptions {
  /** App plugins, applied in order before [setup]. Normally the generated
   * list: `import { plugins } from 'fjs/plugins'`. */
  plugins?: readonly FjsPlugin[];
  /** Called with the Vue app before it is mounted. On Flutter this runs
   * once per page (each page is its own app). With [enableVapor] it runs
   * ONCE, with the app shell (specs/167: use / provide / component /
   * runWithContext / config — enough for pinia). */
  setup?: (app: App) => void;
  /** Web only: mount target. Ignored here. */
  el?: string | unknown;
  /** specs/166: every page is a Vapor SFC. Pages mount through the vapor
   * runtime directly — no per-page Vue app, no compile-time wrapper (the
   * CLI reads this option at build time and skips it; it must be the
   * literal `true`). `setup` and [plugins] run once against the app shell
   * (specs/167); global component resolution goes through [components]
   * plus the built-in fjs component set. */
  enableVapor?: boolean;
  /** Global components (enableVapor): what a vapor page's
   * `resolveComponent` may name. The built-in fjs components
   * (canvas/list-view/form/picker/rich-text/textarea/defer) are always
   * included — they replace what onCreateApp registered on the Vue app in
   * the vdom path. */
  components?: Record<string, unknown>;
}

export interface FjsApp {
  readonly router: Router;
  mount(): void;
}

export function createFjsApp(options: FjsAppOptions): FjsApp {
  // enableVapor (specs/166/167): no per-page Vue app. The built-in component
  // set — what onCreateApp registers on each page's app in the vdom path —
  // and the app's own components resolve through one vapor app context;
  // plugins and setup run ONCE, here, against the app shell (the vdom path
  // runs them per page)
  let vaporContext: VaporAppContext | undefined;
  if (options.enableVapor) {
    vaporContext = {
      components: {
        canvas: createFjsCanvas('inner-canvas'),
        'list-view': FjsListView,
        form: FjsForm,
        picker: FjsPicker,
        'rich-text': FjsRichText,
        textarea: FjsTextarea,
        defer: FjsDefer,
        ...options.components,
      },
      provides: Object.create(null) as Record<string | symbol, unknown>,
    };
    const shell = createVaporAppShell(vaporContext);
    applyPlugins(shell as unknown as App, options.plugins);
    options.setup?.(shell as unknown as App);
  }
  const router = createRouter({
    ...options,
    ...(vaporContext ? { vaporContext } : {}),
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
      // `fjs build` runs this same bundle in Node to capture every page's
      // style caches (bundler/style-snapshot.ts, specs/119): with the hook
      // present the app mounts each route in turn and hands the snapshots
      // over instead of starting normally
      const capture = (globalThis as {
        __fjsCaptureStyles?: ((r: unknown) => void) & {
          started?: boolean;
          routes?: string[];
          loadChunk?: (chunk: string) => void;
        };
      }).__fjsCaptureStyles;
      if (typeof capture === 'function') {
        // tells the build, synchronously, that this bundle does capture
        capture.started = true;
        router
          .captureStyles({ routes: capture.routes, loadChunk: capture.loadChunk })
          .then(capture, (e: unknown) => capture({ __error: String(e) }));
        return;
      }
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
