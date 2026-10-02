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
// TransitionGroup (specs/179) is runtime-dom's, reshaped the same way: the
// per-item enter / leave are this Transition's hooks, and the move pass
// reads positions through ui/geometry instead of getBoundingClientRect.
//
// The DOM-only helpers (v-show, key filters, event modifiers) live in
// @vue/runtime-dom and are likewise absent; component libraries import them
// unconditionally (specs/068-demo-vant hit this with vant, specs/139 with
// NutUI). They are re-implemented on the fjs element API instead.
import {
  BaseTransition,
  Fragment,
  createVNode,
  defineComponent,
  getCurrentInstance,
  getTransitionRawChildren,
  h,
  onUpdated,
  resolveTransitionHooks,
  setTransitionHooks,
  toRaw,
  useTransitionState,
  warn,
} from '@vue/runtime-core';
import { boundingRectOf } from '../ui/geometry';
import type { BaseTransitionProps, Directive, VNode } from '@vue/runtime-core';
import type { Element } from '../ui/element';
// host primitives only (specs/169): every 'vue' import goes through here, and
// the renderer module would pin runtime-core's rendering engine into it
import { styleEngine } from './host-ops';
import { addTransitionClass, removeTransitionClass, nextFrame, whenTransitionEnds, type ElementFlags } from './transition-timing';
export * from '@vue/runtime-core';
// specs/167: lifecycle + provide/inject that also serve a vapor setup — a
// composable importing them from 'vue' reaches the vapor instance. Outside
// one they ARE runtime-core's (see vapor/instance.ts for the dispatch)
export {
  onBeforeMount, onMounted, onBeforeUnmount, onUnmounted, onBeforeUpdate, onUpdated, onActivated, onDeactivated, onErrorCaptured, onRenderTracked, onRenderTriggered, onServerPrefetch, provide, inject, hasInjectionContext, useAttrs, resolveDynamicComponent,
} from '../vapor/instance';
export { useCssVars } from './css-vars';
// the Flutter build's template compiler emits it (specs/153)
export { fjsTemplate } from './template-block';

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

// ---- <TransitionGroup> (specs/179) ------------------------------------------------------

type Pos = { left: number; top: number };
const positionMap = new WeakMap<VNode, Pos>();
const newPositionMap = new WeakMap<VNode, Pos>();
/** A move still running on the element: finishes it early (a new update
 * started before the slide ended), as runtime-dom's `_moveCb` does. */
const moveCbs = new WeakMap<object, () => void>();

const isFjsElement = (el: unknown): el is Element => !!el && typeof (el as { id?: unknown }).id === 'number';
const rectOf = (el: Element): Pos => boundingRectOf(el.id);

/** runtime-dom's applyTranslation: put a moved element back where it was —
 * an inline transform with transitions off — and say whether it moved. */
function applyTranslation(c: VNode): boolean {
  const oldPos = positionMap.get(c);
  const newPos = newPositionMap.get(c);
  if (!oldPos || !newPos) return false;
  const dx = oldPos.left - newPos.left;
  const dy = oldPos.top - newPos.top;
  if (!dx && !dy) return false;
  const el = c.el as Element;
  el.style.transform = `translate(${dx}px,${dy}px)`;
  el.style.transitionDuration = '0s';
  return true;
}

const TransitionGroupProps = {
  ...TransitionProps,
  tag: String,
  moveClass: String,
};

/** The fjs twin of runtime-dom's TransitionGroup. Enter / leave per item are
 * the Transition hooks above (classes in the style engine, timing off the
 * computed durations); the move is FLIP. Unlike the DOM there is no forced
 * reflow to make the browser paint the put-back position: the peer animates
 * between styles it has RENDERED, so the slide starts a frame later. */
export const TransitionGroup = defineComponent({
  name: 'TransitionGroup',
  props: TransitionGroupProps as never,
  setup(props: RawProps, { slots }) {
    const instance = getCurrentInstance()!;
    const state = useTransitionState();
    let prevChildren: VNode[] = [];
    let children: VNode[] = [];

    onUpdated(() => {
      if (!prevChildren.length) return;
      const moveClass = (props.moveClass as string | undefined) || `${(props.name as string | undefined) || 'v'}-move`;
      for (const c of prevChildren) moveCbs.get(c.el as object)?.();
      for (const c of prevChildren) newPositionMap.set(c, rectOf(c.el as Element));
      const moved = prevChildren.filter(applyTranslation);
      if (!moved.length) return;
      nextFrame(() => {
        for (const c of moved) {
          const el = c.el as Element & ElementFlags;
          addTransitionClass(el, moveClass);
          el.style.transform = '';
          el.style.transitionDuration = '';
          let done = false;
          const finish = (): void => {
            if (done) return;
            done = true;
            moveCbs.delete(el);
            removeTransitionClass(el, moveClass);
          };
          moveCbs.set(el, finish);
          // the end comes off the computed style, which carries the move
          // class's transition only once it has been applied: a frame on
          nextFrame(() => {
            if (!done) whenTransitionEnds(el, undefined, finish);
          });
        }
      });
    });

    return () => {
      const rawProps = toRaw(props);
      const cssTransitionProps = resolveTransitionProps(rawProps);
      const tag = (rawProps.tag as string | undefined) || Fragment;
      prevChildren = [];
      for (const child of children) {
        if (isFjsElement(child.el)) {
          prevChildren.push(child);
          setTransitionHooks(child, resolveTransitionHooks(child, cssTransitionProps, state, instance));
          positionMap.set(child, rectOf(child.el));
        }
      }
      children = slots.default ? getTransitionRawChildren(slots.default()) : [];
      for (const child of children) {
        if (child.key != null) {
          setTransitionHooks(child, resolveTransitionHooks(child, cssTransitionProps, state, instance));
        } else {
          warn('<TransitionGroup> children must be keyed.');
        }
      }
      return createVNode(tag as never, null, children);
    };
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

// withKeys / withModifiers live in modifiers.ts: the runtime-dom shim that
// runtime-vapor imports needs them too, and importing this module from there
// would close a cycle through runtime-vapor.
export { withKeys, withModifiers } from './modifiers';

/** A second Vue root (`createApp().mount(el)`) needs a real container node
 * to mount into — vant's imperative overlays do `document.createElement`
 * before ever reaching this name. Kept failing loudly (specs/137 Q1): a
 * library is enabled by its own adapter importing `createApp` and
 * `createDetachedRoot` from 'fjs/vue' (demo/vite/vant.ts does it for vant),
 * so every other library still says plainly that it is not wired up. */
export function createApp(): never {
  throw new Error(
    "vue createApp is not available in the fjs app runtime: there is no DOM to mount a second app root into. " +
      "Adapt the library to mount with createApp + createDetachedRoot from 'fjs/vue' " +
      '(demo/vite/vant.ts does this for vant showToast()/showDialog()).',
  );
}
