// The enableVapor reference app (specs/166): every page is a Vapor SFC and
// the app says so once — `enableVapor: true`. The CLI reads this option at
// build time (no compile-time wrapper; on web `vue` resolves to the
// runtime-core shim so runtime-dom never enters the bundle), the runtime at
// mount time (pages mount through the vapor runtime, no per-page Vue app).
//
// Routes come from the GENERATED table ('fjs/pages'): besides the records it
// carries the per-route chunk metadata the split build's loader needs and
// registers every page — an inline routes array has no chunk info, and on a
// device the page chunks would never load (blank first page).
//
// Plugins install on the app shell (specs/167): `setup` runs once, and a
// vapor page's `useCounter()` finds the pinia installed here.
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import { createPinia } from 'pinia';
import Shell from './Shell.vue';

// the platform's own transition (no `transition: false`): on iOS that is
// also what gives the edge-swipe back gesture
createFjsApp({
  enableVapor: true,
  routes,
  shell: Shell,
  setup(app) {
    app.use(createPinia());
  },
}).mount();
