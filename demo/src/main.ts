import { createFjsApp } from 'fjs/app';
import { registerDartModuleStub } from '@ufjs/runtime';
import { createPlaygroundStub } from './playground-stub';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';
import { plugins } from 'fjs/plugins';
// NutUI's inline-shrink CSS has no fjs equivalent (display: inline-flex is
// dropped on BOTH ends) — explicit sizes/flex directions, see the file.
import './styles/nutui-fix.css';
// Same role for vant: picker column gesture claim, calendar watermark
// stacking and header background (specs/205).
import './styles/vant-fix.css';

// the web twin of the Dart `playground` module (specs/159 §11); a no-op on
// engines with the object ABI, which serve the real module instead
registerDartModuleStub('playground', createPlaygroundStub());

createFjsApp({
  plugins,
  routes,
  transition: 'fjs-slide',
  shell: Shell,
  enableVapor: false,
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
