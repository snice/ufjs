// How a VDOM page mounts on Flutter (specs/169): its own Vue app — the fjs
// custom renderer's createApp — rooted in the page's element root, with the
// shell around it and the router/route/entry provides. Split out of
// router/flutter.ts so the router itself does not import the renderer: a
// pure-vapor app (enableVapor) never registers this module and ships
// without runtime-core's rendering engine.
import { h, type Component } from '@vue/runtime-core';
// createApp here is the fjs custom renderer's, not runtime-dom's
import { createApp as createVueApp } from '../vue/renderer';
import { setVdomPageMounter } from './flutter';

setVdomPageMounter(({ page, root, route, shell, provides, onCreateApp }) => {
  const content = () => (page ? h(page) : h('view'));
  const app = createVueApp({
    name: 'FjsPage',
    render: () =>
      shell ? h(shell as Component, { route }, { default: content }) : content(),
  });
  for (const [key, value] of provides) app.provide(key, value);
  onCreateApp?.(app);
  app.mount(root);
  return app;
});
