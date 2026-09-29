// `fjs/vapor` on Flutter builds (specs/148): what a compiled Vapor SFC
// imports instead of 'vue' — the 'vue' shim plus runtime-vapor — and
// enableVapor(), which the CLI appends a call to. The 'vue' shim leaves
// runtime-vapor out on purpose: a `--pages` build's shared chunk exports the
// whole 'vue' namespace, and apps without a Vapor component should not carry
// it. The CLI shares this module instead when the app has one.
export * from '../vue/vue-shim';
export * from '@vue/runtime-vapor';
import { vaporInteropPlugin } from '@vue/runtime-vapor';
import type { Element as Host } from '../ui/element';
import { onEveryApp } from '../vue/renderer';
import { installDelegation, shellOf } from './dom';

let enabled = false;

/** fjs elements the VDOM renderer passes across the boundary (a container,
 * an anchor) become their shells; everything else passes through. */
function toShell(arg: unknown): unknown {
  if (arg && typeof arg === 'object' && !(arg as { $fjsShell?: true }).$fjsShell
    && typeof (arg as Host).id === 'number' && typeof (arg as Host).setProps === 'function') {
    return shellOf(arg as Host);
  }
  return arg;
}

/** Installs Vue's VDOM ⇄ Vapor interop on every fjs app, now and later.
 * The VDOM → Vapor direction (a Vapor component inside a VDOM page) hands
 * runtime-vapor fjs elements; they are swapped for shells here. The other
 * direction needs nothing: the renderer's nodeOps unwrap shells. */
export function enableVapor(): void {
  if (enabled) return;
  enabled = true;
  installDelegation();
  onEveryApp((app) => {
    if ((app._context as { vapor?: unknown }).vapor) return;
    (vaporInteropPlugin as (app: unknown) => void)(app);
    const impl = (app._context as unknown as { vapor: Record<string, unknown> }).vapor;
    const wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(impl)) {
      const fn = impl[key];
      wrapped[key] = typeof fn === 'function'
        ? (...args: unknown[]) => (fn as (...a: unknown[]) => unknown).apply(impl, args.map(toShell))
        : fn;
    }
    (app._context as unknown as { vapor: unknown }).vapor = wrapped;
  });
}

export { shellOf } from './dom';
