import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';
import { plugins } from 'fjs/plugins';

createFjsApp({
  plugins,
  routes,
  transition: 'fjs-slide',
  shell: Shell,
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
