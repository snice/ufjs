// spec 093 desktop end-to-end fixture: a minimal Vue app on the REAL runtime,
// with a global hook so the CDP client can perform a REAL structural change
// (second page root) — exactly what a route push does in a real app.
import { defineComponent, h } from '@vue/runtime-core';
import { setOpSink } from '../../../packages/fjs-runtime/src/host.ts';
import { createApp, flutterRoot } from '../../../packages/fjs-runtime/src/vue/index.ts';
import { devtoolsBoot } from '../../../packages/fjs-runtime/src/devtools.ts';

setOpSink(() => {});
devtoolsBoot();

const Page0 = defineComponent(() => () =>
  h('view', { id: 'shell', class: 'page inner' }, [
    h('text', { class: 'title' }, 'page zero'),
  ]),
);
createApp(Page0).mount(flutterRoot('view'));

globalThis.__addPage = () => {
  const r = flutterRoot('view');
  const Page1 = defineComponent(() => () =>
    h('view', { class: 'page1' }, [h('text', null, 'page one')]),
  );
  createApp(Page1).mount(r);
  return true;
};
globalThis.__probe = () => typeof globalThis.__fjsDevtools;
