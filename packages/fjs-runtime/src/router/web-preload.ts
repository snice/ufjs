// Page-module preloading for the two web routers (specs/143): the vue-router
// facade (router/web.ts) and the enableVapor history router
// (router/web-history.ts, specs/173). Free of vue-router on purpose.
import type { Matcher } from './match';
import type { RouteLocationRaw } from './types';

/** Runs the route's lazy `() => import(...)` (the generated web table's
 * shape); the browser keeps the module, so the navigation's own import
 * resolves from cache. A synchronous component is already loaded. */
export async function preloadRecord(matcher: Matcher, to: RouteLocationRaw): Promise<void> {
  const record = matcher.record(matcher.resolve(to).path);
  const component = record?.component;
  if (typeof component !== 'function' || isComponentFunction(component)) return;
  await (component as () => Promise<unknown>)();
}

/** A functional component or a class-style one, not a lazy loader. */
export function isComponentFunction(fn: object): boolean {
  return 'props' in fn || 'setup' in fn || 'render' in fn || '__vccOpts' in fn;
}

/** requestIdleCallback where there is one (Safari has none), bounded so a
 * page that is never idle still gets its modules. */
export function whenBrowserIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (typeof ric === 'function') ric(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 50);
  });
}
