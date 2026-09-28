// Web twin of the renderer's onEveryApp (specs/148): app/web.ts records its
// Vue app here, and `fjs/vapor` (web.ts) installs the interop on it when a
// Vapor component loads. Kept apart from web.ts so recording an app does not
// import runtime-vapor into web bundles without a Vapor component.
import type { App } from 'vue';

const apps: App[] = [];
const hooks: ((app: App) => void)[] = [];

export function trackWebApp(app: App): void {
  apps.push(app);
  for (const hook of hooks) hook(app);
}

export function onEveryWebApp(hook: (app: App) => void): void {
  hooks.push(hook);
  for (const app of apps) hook(app);
}
