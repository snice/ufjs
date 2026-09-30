// Repro: the vant/vapor page mounted through the REAL router machinery
// (createRouter + start + Shell slot), not createApp(page) like vapor-check —
// the real app white-screens on iOS while the direct mount passes.
//   fjs build bench/nav-vapor.ts --out dist/nav-vapor && \
//     ../packages/flutter_fjs/native/build-native/fjsrun --pump 300 dist/nav-vapor/app/bundle.js
import { createFjsApp, definePage } from 'fjs/app';
import VantVapor from '../src/pages/vant/vapor.vue';

// the Flutter route table mounts via the definePage registry, not the
// record's `component` field (web only)
definePage('/', VantVapor as never);

async function main(): Promise<void> {
  const app = createFjsApp({
    plugins: (await import('fjs/plugins')).plugins,
    routes: [
      {
        path: '/',
        name: 'vant-vapor',
        meta: { title: 'vant: Vapor 页', group: 'Vant', desc: 'repro' },
        component: VantVapor as never,
      },
    ],
    shell: (await import('../src/Shell.vue')).default as never,
    transition: false,
  });
  app.mount();
}

void main();
