// What `@vue/runtime-dom` resolves to in fjs Flutter builds (specs/148).
//
// Only runtime-vapor imports runtime-dom: fjs pages use runtime-core with the
// fjs renderer. runtime-vapor takes runtime-core's API through runtime-dom's
// re-export, plus about thirty DOM-specific helpers. The real runtime-dom
// cannot load here — it calls `document.createElement` at module evaluation,
// and making `document` global would flip third-party libraries onto their
// browser paths. So this module is runtime-core plus fjs versions of those
// helpers, working on the Vapor DOM shell (vapor/dom.ts):
//
//   - ensureRenderer() is the fjs renderer: VDOM components inside Vapor
//     blocks mount through the same renderer as every other fjs page
//   - class / style / event-name helpers write through the shell
//   - v-model on native elements, <Transition> inside Vapor components,
//     custom elements and SSR hydration throw — fjs does not have them on
//     the VDOM side either (v-model: `:value` + `@input`, see pages/about)
import { BaseTransitionPropsValidators } from '@vue/runtime-core';
import { extend, hyphenate } from '@vue/shared';
import { patchStyle as shellPatchStyle, shellOf, type Element as ShellElement } from '../vapor/dom';
import type { Element as Host } from '../ui/element';
import { createApp, render, rendererInternals } from './renderer';

// Every top-level value here is marked pure: runtime-vapor imports this
// module, and a bundle without a Vapor component tree-shakes runtime-vapor
// away — a top-level call esbuild must assume has side effects would keep
// this module (and the shell behind it) in that bundle anyway.

export * from '@vue/runtime-core';
export { withKeys, withModifiers } from './modifiers';

const unsupported = (what: string) => (): never => {
  throw new Error(`[fjs vapor] ${what} is not supported in Vapor components on fjs`);
};

export function ensureRenderer() {
  return { render, createApp, internals: rendererInternals };
}

export const ensureHydrationRenderer = /*@__PURE__*/ unsupported('SSR hydration');

/** A Vapor app mounted on an fjs element (or a shell of one). */
export function normalizeContainer(container: unknown): ShellElement | null {
  if (typeof container === 'string') unsupported('mounting on a selector')();
  if (container && (container as { $fjsShell?: true }).$fjsShell) return container as ShellElement;
  return container ? shellOf(container as Host) : null;
}

export function patchClass(el: ShellElement, value: string | null): void {
  el.className = value ?? '';
}

export function patchStyle(el: ShellElement, prev: unknown, next: unknown): void {
  shellPatchStyle(el, prev, next);
}

/** useCssVars in a Vapor component: the vars are inline custom properties
 * on the root element, where the style engine's var() lookup finds them. */
export function setVarsOnNode(el: unknown, vars: Record<string, string>): void {
  if (!el || !(el as { $fjsShell?: true }).$fjsShell || (el as ShellElement).nodeType !== 1) return;
  const style: Record<string, string> = {};
  for (const key in vars) style[`--${key}`] = vars[key];
  shellPatchStyle(el as ShellElement, null, style);
}

const optionsModifierRE = /(Once|Passive|Capture)$/;
const optionsModifierEventRE = /^on:?(?:Once|Passive|Capture)$/;
/** runtime-dom's own: `onClickOnce` → ['click', { once: true }]. */
export function parseEventName(name: string): [string, Record<string, boolean> | undefined] {
  let options: Record<string, boolean> | undefined;
  let m: RegExpMatchArray | null;
  while ((m = name.match(optionsModifierRE)) && !optionsModifierEventRE.test(name)) {
    options ??= {};
    name = name.slice(0, name.length - m[1].length);
    options[m[1].toLowerCase()] = true;
  }
  return [name[2] === ':' ? name.slice(3) : hyphenate(name.slice(2)), options];
}

/** Every non-class / style / event binding goes through setAttribute, which
 * the shell hands to the renderer's patchProp — the VDOM path for the same
 * template. There are no DOM properties to prefer. */
export const shouldSetAsProp = (): boolean => false;
export const shouldSetAsPropForVueCE = (): boolean => false;
export const unsafeToTrustedHTML = (value: string): string => value;
export const xlinkNS = 'http://www.w3.org/1999/xlink';

export const vShowOriginalDisplay = /*@__PURE__*/ Symbol('_vod');
export const vShowHidden = /*@__PURE__*/ Symbol('_vsh');

export const TransitionPropsValidators = /*@__PURE__*/ extend({}, BaseTransitionPropsValidators, {
  name: String,
  type: String,
  css: { type: Boolean, default: true },
  duration: [String, Number, Object],
  enterFromClass: String,
  enterActiveClass: String,
  enterToClass: String,
  appearFromClass: String,
  appearActiveClass: String,
  appearToClass: String,
  leaveFromClass: String,
  leaveActiveClass: String,
  leaveToClass: String,
});
export const resolveTransitionProps = /*@__PURE__*/ unsupported('<Transition>');
export const baseApplyTranslation = /*@__PURE__*/ unsupported('<TransitionGroup>');
export const callPendingCbs = /*@__PURE__*/ unsupported('<TransitionGroup>');
export const forceReflow = /*@__PURE__*/ unsupported('<TransitionGroup>');
export const handleMovedChildren = /*@__PURE__*/ unsupported('<TransitionGroup>');
export const hasCSSTransform = /*@__PURE__*/ unsupported('<TransitionGroup>');

// runtime-vapor extends it at module evaluation (VaporElement): it has to
// be a class, and only constructing one fails
export class VueElementBase {
  constructor() {
    unsupported('defineVaporCustomElement')();
  }
}

const noModel = /*@__PURE__*/ unsupported('v-model on a native element (use :value + @input)');
export const vModelTextInit = noModel;
export const vModelTextUpdate = noModel;
export const vModelCheckboxInit = noModel;
export const vModelCheckboxUpdate = noModel;
export const vModelGetValue = noModel;
export const vModelSelectInit = noModel;
export const vModelSetSelected = noModel;
