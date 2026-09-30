// useVaporCssVars — the vapor half of <style> v-bind() (specs/166). The
// compiler injects `useVaporCssVars(_ctx => ({ "<shortId>-<expr>": (expr) }))`
// into a vapor setup whose CSS uses v-bind(); the generated variable names
// are the short scope ids the style engine keys its v-bind rewrite by.
//
// Vapor has no component instance to hang the vars on and no subTree to
// walk, so the registration is collected while the component's setup runs
// (runtime.ts keeps one bucket per mounting component) and applied once the
// block exists: an effect — living in the component's own scope, so it dies
// with it — re-evaluates the getter and writes the custom properties onto
// the block's root hosts through the backend seam.
type CssVarsGetter = (ctx: unknown) => Record<string, unknown> | undefined;

import { be } from './host';

interface CssVarsReg {
  getter: CssVarsGetter;
}

/** One bucket per in-progress component mount; runtime.ts pushes before
 * setup and takes the bucket after the block is built. Nested components
 * stack: a child's mount pushes its own bucket, so a registration made
 * during the parent's template (i.e. none — the call sits in setup) can
 * never attach to the wrong block. */
const buckets: CssVarsReg[][] = [];

/** Called by compiled vapor code inside setup. Outside a mounting component
 * (createComponent drives all vapor setups) it is a no-op — same tolerance
 * as the VDOM useCssVars without an instance. */
export function useVaporCssVars(getter: CssVarsGetter): void {
  const top = buckets[buckets.length - 1];
  if (top) top.push({ getter });
}

/** runtime.ts: open a bucket for the component about to run its setup. */
export function pushCssVarsBucket(): void {
  buckets.push([]);
}

/** runtime.ts: a throwing setup discards its bucket — a leak would attach
 * this component's vars to the next one mounted. */
export function discardCssVarsBucket(): void {
  buckets.pop();
}

/** runtime.ts: close the bucket and apply the registrations to [block].
 * [scopedEffect] runs the write inside the component's own scope. */
export function popAndApplyCssVars(
  block: { nodes: readonly unknown[] },
  scopedEffect: (fn: () => void) => void,
): void {
  const regs = buckets.pop() ?? [];
  if (!regs.length) return;
  for (const { getter } of regs) {
    scopedEffect(() => {
      const vars = getter(null);
      if (!vars) return;
      for (const node of block.nodes) be().setCssVars?.(node as never, vars as never);
    });
  }
}
