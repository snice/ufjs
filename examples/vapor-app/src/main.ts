// The enableVapor reference app (specs/166): every page is a Vapor SFC and
// the app says so once — `enableVapor: true`. The CLI reads this option at
// build time: no compile-time wrapper is generated, and on web `vue`
// resolves to the runtime-core shim so runtime-dom never enters the bundle.
import { createFjsApp } from 'fjs/app';
import Home from './pages/home.vue';
import About from './pages/about.vue';

const app = createFjsApp({
  enableVapor: true,
  routes: [
    { path: '/', meta: { title: 'Home' }, component: Home },
    { path: '/about', meta: { title: 'About' }, component: About },
  ],
  transition: false,
});
app.mount();
