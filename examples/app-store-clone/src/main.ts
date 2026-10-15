// app-store-clone — an iOS App Store look-alike (specs/217).
//
// One source, two targets:
//   pnpm dev / pnpm build          → Flutter
//   pnpm dev:web / pnpm build:web  → browser
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import { plugins } from 'fjs/plugins';
import Shell from './Shell.vue';
import TabBar from './components/TabBar.vue';

createFjsApp({
  // module components/widgets (@ufjs/liquidglass → <glass-surface>, GlassTabBar) are
  // registered at runtime through this generated list
  plugins,
  routes,
  transition: 'fjs-slide',
  shell: { component: Shell },
  // The global floating tab bar (specs/210) with the liquid-glass style
  // (specs/212, self-registered by @ufjs/liquidglass). The bar component is a
  // thin dispatcher: icons + safe-area live here, the glass lives in the module.
  tabBar: { component: TabBar },
  setup(app) {
    app.config.errorHandler = (err: unknown, _i: unknown, info: string) => {
      console.log('[vue-error]', info, String(err));
      const stack = (err as Error)?.stack;
      if (stack) console.log('[vue-stack]', stack);
    };
  },
}).mount();
