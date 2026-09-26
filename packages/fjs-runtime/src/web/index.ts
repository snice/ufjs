// Web adapter: the fjs tag set implemented on the DOM.
//
// `fjs build --web` aliases 'fjs/app' to app/web.ts, which calls
// installFjsWeb() on the Vue app it creates. Nothing here is pulled into a
// Flutter build.
import type { App } from 'vue';
import { fjsComponents, FJS_TAGS } from './components';
import { installBaseCss } from './base-css';
import { setToastHandler } from '../host';
import { rewriteFjsCss } from './css-compat';

/** Registers the built-in tags and the base stylesheet on [app]. */
export function installFjsWeb(app: App): void {
  installBaseCss();
  // Under Vite, `vue` is runtime-dom, whose validateComponentName warns
  // "reserved HTML element" for each registration below (view/text/image/
  // switch are SVG tags, input/button/progress HTML ones). It is noise —
  // templates are precompiled, so nothing consults that predicate — and
  // runtime-dom defines app.config.isNativeTag non-writable, so there is
  // no way to silence it from here.
  for (const [tag, component] of Object.entries(fjsComponents)) {
    app.component(tag, component as never);
  }
  setToastHandler(showToast);
}

const injected = new Set<string>();

/** Adds one SFC <style> block to the document. Called by the code the fjs
 * esbuild plugin injects; `key` dedupes across hot reloads and repeated
 * imports of the same component. */
export function injectStyle(key: string, css: string): void {
  if (injected.has(key)) return;
  injected.add(key);
  const style = document.createElement('style');
  style.setAttribute('data-fjs', key);
  style.textContent = rewriteFjsCss(css);
  document.head.appendChild(style);
}

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** DOM twin of the native toast overlay (`toast()` from 'fjs'). A new
 * call replaces the current toast and restarts the hide delay, matching
 * Flutter — stacked toasts would pile up and cover each other. */
export function showToast(message: string): void {
  if (toastTimer != null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastEl?.remove();
  const el = document.createElement('fjs-toast');
  el.className = 'fjs-toast';
  el.textContent = message;
  document.body.appendChild(el);
  toastEl = el;
  toastTimer = setTimeout(() => {
    el.remove();
    if (toastEl === el) toastEl = null;
    toastTimer = null;
  }, 2000);
}

export { fjsComponents, FJS_TAGS };
export { BASE_CSS, installBaseCss } from './base-css';
export { expandFlexDefault, rewriteFjsCss } from './css-compat';
