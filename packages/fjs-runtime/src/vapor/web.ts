// `fjs/vapor` on web builds (specs/148). The browser has a real DOM, so the
// official runtime-vapor runs as is; the only job is Vue's VDOM ⇄ Vapor
// interop on the app — fjs tags are VDOM components on web (the DOM
// adapter), so a Vapor template's <view> resolves to one through it.
import { vaporInteropPlugin, type App } from 'vue';

// the build rewrites nothing on web (real vue carries runtime-vapor), but
// `fjs/vapor` answers to the same names as on Flutter
export * from 'vue';
import { onEveryWebApp } from './web-apps';

let enabled = false;

export function enableVapor(): void {
  if (enabled) return;
  enabled = true;
  onEveryWebApp((app: App) => {
    if (!(app._context as { vapor?: unknown }).vapor) app.use(vaporInteropPlugin);
  });
}
