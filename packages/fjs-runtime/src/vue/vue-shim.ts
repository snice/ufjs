// The 'vue' entry for fjs builds. Generated SFC code imports helpers
// (useCssVars) from 'vue' that runtime-core alone does not export; this
// shim re-exports the pinned runtime-core plus the fjs implementations.
// vuePinPlugin resolves 'vue' here, keeping exactly one physical runtime
// copy (the re-export points at the same pinned dist file).
//
// The pinned runtime-core has BaseTransition but no DOM Transition
// component — the DOM one flips classes on el.classList and listens for
// transitionend/animationend, neither of which exists here. This module
// supplies the fjs twin (runtime-dom's Transition.ts reshaped): BaseTransition
// runs the show; class flips go through the style engine, and the
// end-of-transition signal comes from the element's computed animation /
// transition durations instead of DOM events. vant drives its overlay fades
// with `van-*-enter-active { animation: … }` rules (the keyframes engine
// runs them natively) and its popup slides / dialog bounce with class-
// flipped `transform` under a `transition` (the peer tweens those) — the
// shim's only job is the timing.
// TransitionGroup stays a plain fragment: vant's overlays don't use it and
// @vueuse only imports the name.
//
// The DOM-only helpers (v-show, key filters) live in @vue/runtime-dom and
// are likewise absent; component libraries import them unconditionally
// (specs/068-demo-vant hit this with vant). They are re-implemented on the
// fjs element API instead.
import {
  BaseTransition,
  Fragment,
  defineComponent,
  h,
} from '@vue/runtime-core';
import type { BaseTransitionProps, Directive, VNode } from '@vue/runtime-core';
import type { Element } from '../ui/element';
import { styleEngine } from './renderer';
import { trackTransitionClass, untrackTransitionClass, transitionClassesOf } from './transition-classes';
export * from '@vue/runtime-core';
export { useCssVars } from './css-vars';

// ---- <Transition> ------------------------------------------------------------

type EnterHook = (el: Element, done?: () => void) => void;
type Hook = EnterHook | EnterHook[];

const DOM_PROPS = new Set([
  'name', 'type', 'css', 'duration',
  'enterFromClass', 'enterActiveClass', 'enterToClass',
  'appearFromClass', 'appearActiveClass', 'appearToClass',
  'leaveFromClass', 'leaveActiveClass', 'leaveToClass',
  'onBeforeAppear', 'onAppear', 'onAppearCancelled',
  'onBeforeEnter', 'onEnter', 'onEnterCancelled',
  'onBeforeLeave', 'onLeave', 'onAfterLeave', 'onLeaveCancelled',
]);

interface RawProps extends Record<string, unknown> {
  name?: string;
  type?: 'transition' | 'animation';
  css?: boolean;
  duration?: number | { enter: number; leave: number };
  enterFromClass?: string;
  enterActiveClass?: string;
  enterToClass?: string;
  appearFromClass?: string;
  appearActiveClass?: string;
  appearToClass?: string;
  leaveFromClass?: string;
  leaveActiveClass?: string;
  leaveToClass?: string;
  onBeforeAppear?: Hook;
  onAppear?: Hook;
  onAppearCancelled?: Hook;
  onBeforeEnter?: Hook;
  onEnter?: Hook;
  onEnterCancelled?: Hook;
  onBeforeLeave?: Hook;
  onLeave?: Hook;
  onAfterLeave?: Hook;
  onLeaveCancelled?: Hook;
}

function callHook(hook: Hook | undefined, el: Element, done?: () => void): void {
  if (Array.isArray(hook)) hook.forEach((h) => h(el, done));
  else hook?.(el, done);
}

const hasExplicitCallback = (hook: Hook | undefined): boolean =>
  Array.isArray(hook) ? hook.some((h) => h.length > 1) : (hook?.length ?? 0) > 1;

/** The DOM classes are engine state here, not DOM attributes: read the
 * current list, mutate, write back. The engine restyles on its next flush,
 * which is what starts the `-active` animation — and what stops it when the
 * classes come off again. */
function addTransitionClass(el: Element, cls: string): void {
  for (const c of cls.split(/\s+/)) {
    if (!c) continue;
    trackTransitionClass(el, c);
    const cur = styleEngine.classesOf(el.id);
    if (!cur.includes(c)) styleEngine.setClasses(el.id, [...cur, c].join(' '));
  }
}

function removeTransitionClass(el: Element, cls: string): void {
  for (const c of cls.split(/\s+/)) {
    if (!c) continue;
    untrackTransitionClass(el, c);
    const cur = styleEngine.classesOf(el.id);
    if (cur.includes(c)) styleEngine.setClasses(el.id, cur.filter((x) => x !== c).join(' '));
  }
}

/** DOM's nextFrame is two rAFs: one frame to paint the `-from` state, a
 * second to flip to `-to`. The engine flushes styles per microtask and the
 * peer applies ops per frame, so two hops keep the same ordering; without a
 * native host (tests) rAF does not exist and a 16ms timeout stands in. */
function nextFrame(cb: () => void): void {
  const hop = (inner: () => void): void => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => inner());
    else setTimeout(inner, 16);
  };
  hop(() => hop(cb));
}

function parseMs(v: unknown): number {
  if (typeof v === 'number') return v * 1000;
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.endsWith('ms')) return parseFloat(s) || 0;
  if (s.endsWith('s')) return (parseFloat(s) || 0) * 1000;
  return 0;
}

/** `'0.3s, 2s'` lists map onto the animation-name list — the element is
 * done when its longest layer is. */
function maxLayerTimeout(durations: unknown, delays: unknown): number {
  const dur = String(durations ?? '').split(',').map(parseMs);
  const delay = String(delays ?? '').split(',').map(parseMs);
  if (!dur.length || dur.every((d) => d <= 0)) return 0;
  let max = 0;
  for (let i = 0; i < dur.length; i++) max = Math.max(max, dur[i] + (delay[i] ?? delay[0] ?? 0));
  return max;
}

const TIME = /^[-+]?(\d*\.)?\d+m?s$/;

/** The longest `transition` layer. The engine hands the shorthand through
 * as written (`transform .3s`, `opacity .2s ease 100ms`), so each layer's
 * first time token is its duration and the second its delay — the
 * transition-* longhands, when declared, win over it (the peer resolves
 * them the same way, style_parse.dart parseTransitions). */
function transitionTimeout(style: Record<string, unknown>): number {
  const layers = String(style.transition ?? '').split(',').map((layer) => {
    const times = layer.trim().split(/\s+/).filter((t) => TIME.test(t)).map(parseMs);
    return { duration: times[0] ?? 0, delay: times[1] ?? 0 };
  });
  const durations = style.transitionDuration != null ? String(style.transitionDuration).split(',').map(parseMs) : null;
  const delays = style.transitionDelay != null ? String(style.transitionDelay).split(',').map(parseMs) : null;
  const n = Math.max(layers.length, durations?.length ?? 0, delays?.length ?? 0);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const layer = layers[i % layers.length];
    const duration = durations ? durations[i % durations.length] : layer.duration;
    const delay = delays ? delays[i % delays.length] : layer.delay;
    if (duration > 0) max = Math.max(max, duration + delay);
  }
  return max;
}

interface ElementFlags {
  _enterCancelled?: boolean;
  _isLeaving?: boolean;
  _endId?: number;
}

/** DOM listens for transitionend/animationend; there are no events on this
 * side — the peer runs the animation on its own ticker. The computed
 * animation / transition durations and delays (the `-active` class landed
 * one flush ago) decide when the classes come off. Neither = resolve now,
 * like vue's `if (!type) resolve()`. */
function whenTransitionEnds(el: Element, explicitTimeout: number | undefined, resolve: () => void): void {
  const flagged = el as Element & ElementFlags;
  flagged._endId = (flagged._endId ?? 0) + 1;
  const id = flagged._endId;
  const resolveIfNotStale = (): void => {
    if (flagged._endId === id) resolve();
  };
  if (explicitTimeout != null) {
    setTimeout(resolveIfNotStale, explicitTimeout);
    return;
  }
  // vue's getTransitionInfo: no declared `type` → whichever of the element's
  // animation / transition runs longer decides. vant's overlay fades are
  // animations; its popup slides and dialog bounce are transitions
  const style = styleEngine.computedOf(el.id) ?? {};
  const timeout = Math.max(
    maxLayerTimeout(style.animationDuration, style.animationDelay),
    transitionTimeout(style),
  );
  if (timeout <= 0) {
    resolveIfNotStale();
    return;
  }
  // one frame of slack over the native `timeout + 1`, which counted on end
  // events arriving faster than the fallback timer
  setTimeout(resolveIfNotStale, timeout + 32);
}

function resolveTransitionProps(raw: RawProps): BaseTransitionProps {
  const baseProps: Record<string, unknown> = {};
  for (const key in raw) {
    if (!DOM_PROPS.has(key)) baseProps[key] = raw[key];
  }
  if (raw.css === false) {
    return baseProps as BaseTransitionProps;
  }
  const {
    name = 'v',
    type,
    duration,
    enterFromClass = `${name}-enter-from`,
    enterActiveClass = `${name}-enter-active`,
    enterToClass = `${name}-enter-to`,
    appearFromClass = enterFromClass,
    appearActiveClass = enterActiveClass,
    appearToClass = enterToClass,
    leaveFromClass = `${name}-leave-from`,
    leaveActiveClass = `${name}-leave-active`,
    leaveToClass = `${name}-leave-to`,
  } = raw;
  const durations =
    duration == null ? null : typeof duration === 'object' ? [duration.enter, duration.leave] : [duration, duration];
  const enterDuration = durations?.[0] as number | undefined;
  const leaveDuration = durations?.[1] as number | undefined;
  const {
    onBeforeEnter,
    onEnter,
    onEnterCancelled,
    onBeforeAppear = onBeforeEnter,
    onAppear = onEnter,
    onAppearCancelled = onEnterCancelled,
  } = raw;

  const finishEnter = (el: Element, isAppear: boolean, done?: () => void, isCancelled?: boolean): void => {
    (el as Element & ElementFlags)._enterCancelled = isCancelled;
    removeTransitionClass(el, isAppear ? appearToClass : enterToClass);
    removeTransitionClass(el, isAppear ? appearActiveClass : enterActiveClass);
    done?.();
  };
  const finishLeave = (el: Element, done?: () => void): void => {
    (el as Element & ElementFlags)._isLeaving = false;
    removeTransitionClass(el, leaveFromClass);
    removeTransitionClass(el, leaveToClass);
    removeTransitionClass(el, leaveActiveClass);
    done?.();
  };
  // BaseTransition hands the hooks its own RendererElement type; the object
  // at runtime is our Element (this renderer's host node)
  const asHost = (el: unknown): Element => el as Element;
  const makeEnterHook =
    (isAppear: boolean) =>
    (rawEl: unknown, done?: () => void): void => {
      const el = asHost(rawEl);
      const hook = isAppear ? onAppear : onEnter;
      const resolve = (): void => finishEnter(el, isAppear, done);
      callHook(hook, el, resolve);
      nextFrame(() => {
        removeTransitionClass(el, isAppear ? appearFromClass : enterFromClass);
        addTransitionClass(el, isAppear ? appearToClass : enterToClass);
        if (!hasExplicitCallback(hook)) whenTransitionEnds(el, enterDuration, resolve);
      });
    };

  const out = {
    ...baseProps,
    appear: raw.appear ?? false,
    persisted: false,
    onBeforeEnter(rawEl) {
      const el = asHost(rawEl);
      callHook(onBeforeEnter, el);
      addTransitionClass(el, enterFromClass);
      addTransitionClass(el, enterActiveClass);
    },
    onBeforeAppear(rawEl) {
      const el = asHost(rawEl);
      callHook(onBeforeAppear, el);
      addTransitionClass(el, appearFromClass);
      addTransitionClass(el, appearActiveClass);
    },
    onEnter: makeEnterHook(false),
    onAppear: makeEnterHook(true),
    onLeave(rawEl, done) {
      const el = asHost(rawEl);
      (el as Element & ElementFlags)._isLeaving = true;
      const resolve = (): void => finishLeave(el, done);
      addTransitionClass(el, leaveFromClass);
      addTransitionClass(el, leaveActiveClass);
      nextFrame(() => {
        if (!(el as Element & ElementFlags)._isLeaving) return;
        removeTransitionClass(el, leaveFromClass);
        addTransitionClass(el, leaveToClass);
        if (!hasExplicitCallback(raw.onLeave)) whenTransitionEnds(el, leaveDuration, resolve);
      });
      callHook(raw.onLeave, el, resolve);
    },
    onEnterCancelled(rawEl) {
      const el = asHost(rawEl);
      finishEnter(el, false, undefined, true);
      callHook(onEnterCancelled, el);
    },
    onAppearCancelled(rawEl) {
      const el = asHost(rawEl);
      finishEnter(el, true, undefined, true);
      callHook(onAppearCancelled, el);
    },
    onLeaveCancelled(rawEl) {
      const el = asHost(rawEl);
      finishLeave(el);
      callHook(raw.onLeaveCancelled, el);
    },
  } as BaseTransitionProps;
  return out;
}

/** Props must be DECLARED, not just consumed: everything this resolver
 * reads that BaseTransition doesn't know would otherwise fall through as
 * attrs onto the child element (an `onAppear` prop arriving as a fjs event
 * registration, a `duration` as a stray prop). */
const TransitionProps = {
  ...((BaseTransition as unknown as { props: Record<string, unknown> }).props ?? {}),
  name: String,
  type: String,
  css: { type: Boolean, default: true },
  duration: [Number, Object],
  enterFromClass: String,
  enterActiveClass: String,
  enterToClass: String,
  appearFromClass: String,
  appearActiveClass: String,
  appearToClass: String,
  leaveFromClass: String,
  leaveActiveClass: String,
  leaveToClass: String,
  onBeforeAppear: [Function, Array],
  onAppear: [Function, Array],
  onAppearCancelled: [Function, Array],
};

/** The fjs twin of runtime-dom's Transition. */
const TransitionImpl = (props: RawProps, { slots }: { slots: { default?: () => VNode } }): VNode => {
  return h(BaseTransition, resolveTransitionProps(props), slots);
};
TransitionImpl.displayName = 'Transition';
TransitionImpl.props = TransitionProps;
export const Transition = TransitionImpl as unknown as ReturnType<typeof defineComponent>;

export const TransitionGroup = defineComponent({
  name: 'TransitionGroup',
  setup(_, { slots }) {
    return () => slots.default?.() ?? h(Fragment, null);
  },
});

// ---- v-show ------------------------------------------------------------------

/** v-show on the fjs renderer. Like runtime-dom's vShow it touches ONE
 * property on the inline layer — `el.style.display = 'none'` to hide, clear
 * to show — so the element's cascade stays in charge of everything else.
 * (It used to setStyle the whole map to `{display}`: that replaced the
 * computed style outright, and on an `updated` pass nothing restyled the
 * element afterwards — vant's stepper input and + button lost every rule
 * the first time the value changed.)
 *
 * Inside a <Transition> the directive hands show/hide to the transition
 * hooks, exactly like runtime-dom: the leave animation must play BEFORE
 * display goes none, or overlays pop in and out of existence. */
const originalDisplay = new WeakMap<Element, string>();

function setDisplay(el: Element, value: boolean): void {
  el.style.display = value ? (originalDisplay.get(el) ?? '') : 'none';
}

export const vShow: Directive<Element, boolean> = {
  beforeMount(el, { value }, { transition }) {
    const cur = String(el.style.display ?? '');
    originalDisplay.set(el, cur === 'none' ? '' : cur);
    if (transition && value) {
      transition.beforeEnter(el);
    } else {
      setDisplay(el, value);
    }
  },
  mounted(el, { value }, { transition }) {
    if (transition && value) transition.enter(el);
  },
  updated(el, { value, oldValue }, { transition }) {
    if (!value === !oldValue) return;
    if (transition) {
      if (value) {
        transition.beforeEnter(el);
        // restore visibility BEFORE the enter animation: a second show
        // starts from the `display: none` the previous leave left behind,
        // and without this the element would animate invisible forever
        setDisplay(el, true);
        transition.enter(el);
      } else {
        transition.leave(el, () => setDisplay(el, false));
      }
    } else {
      setDisplay(el, value);
    }
  },
  beforeUnmount(el, { value }) {
    // display cleanup only — runtime-dom does not play a leave transition
    // for a v-show element that is being unmounted outright
    setDisplay(el, value);
  },
};

/** Key filters (`@keyup.enter`) degenerate to pass-through: fjs events carry
 * no key codes, so the guard has nothing to test — the handler runs on every
 * event instead of never. */
export function withKeys<T extends (event: unknown) => void>(fn: T): T {
  return fn;
}

/** A second Vue root (`createApp().mount(el)`) needs a real container node
 * to mount into — vant's imperative overlays do `document.createElement`
 * before ever reaching this name. Nothing on the app side can supply that
 * (no DOM), so fail loudly instead of leaving a half-wired app behind. */
export function createApp(): never {
  throw new Error(
    'vue createApp is not available in the fjs app runtime: ' +
      'there is no DOM to mount a second app root into ' +
      '(imperative component-library APIs such as showToast()/showDialog() are web-only).',
  );
}
