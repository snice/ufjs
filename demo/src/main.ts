import { createFjsApp } from 'fjs/app';
import { registerDartModuleStub } from '@ufjs/runtime';
import { createPlaygroundStub } from './playground-stub';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';
import { plugins } from 'fjs/plugins';

// the web twin of the Dart `playground` module (specs/159 §11); a no-op on
// engines with the object ABI, which serve the real module instead
registerDartModuleStub('playground', createPlaygroundStub());

createFjsApp({
  plugins,
  routes,
  transition: 'fjs-slide',
  shell: Shell,
  enableVapor: true,
  setup(app) {
    // Vue swallows what a lifecycle hook throws unless something listens;
    // console.error because the app log drops console.log (vant's
    // TextEllipsis died silently in onMounted, specs/128)
    app.config.errorHandler = (err: unknown, _i: unknown, info: string) => {
      console.error('[vue-error]', info, String(err));
      const stack = (err as Error)?.stack;
      if (stack) console.error('[vue-stack]', stack);
    };
  },
}).mount();
