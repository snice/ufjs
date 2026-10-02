// <Transition> for vapor components (specs/174), platform-neutral: Vue's
// class timeline (runtime-dom's resolveTransitionProps, the same one the
// Flutter VDOM shim in vue/vue-shim.ts follows) over the backend's
// transition primitives — classes, the two-frame hop, "it ended".
//
//   enter: before-enter → +from +active → next frame: −from +to → end:
//          −to −active, after-enter
//   leave: before-leave → +from +active → next frame: −from +to → end:
//          −to −active, after-leave, done (the caller removes / hides)
//
// Starting one half on an element cancels the other half still running on
// it (a v-show toggled back mid-fade, a fast v-if flip), as Vue does.
import { be, setStyleHost, type HostNode, type ListTransition, type SwitchTransition } from './host';

type Props = Record<string, unknown>;
type HookFn = (el: unknown, done?: () => void) => void;

interface HostState {
  endId: number;
  moveId?: number;
  cancelEnter?: () => void;
  cancelLeave?: () => void;
}

const states = new WeakMap<object, HostState>();

function stateOf(host: HostNode): HostState {
  let st = states.get(host as object);
  if (!st) states.set(host as object, (st = { endId: 0 }));
  return st;
}

function callHook(hook: unknown, el: unknown, done?: () => void): void {
  const list = Array.isArray(hook) ? hook : hook ? [hook] : [];
  for (const fn of list) if (typeof fn === 'function') (fn as HookFn)(el, done);
}

/** A hook that takes `done` drives the end itself (Vue's rule). */
function takesDone(hook: unknown): boolean {
  const list = Array.isArray(hook) ? hook : hook ? [hook] : [];
  return list.some((fn) => typeof fn === 'function' && (fn as HookFn).length > 1);
}

function durationOf(props: Props, phase: 'enter' | 'leave'): number | undefined {
  const d = props.duration;
  if (d == null || d === '') return undefined;
  if (typeof d === 'object') {
    const v = (d as Record<string, unknown>)[phase];
    return v == null ? undefined : Number(v);
  }
  return Number(d);
}

interface Classes {
  from: string;
  active: string;
  to: string;
}

function classesOf(props: Props, phase: 'enter' | 'appear' | 'leave'): Classes {
  const name = (props.name as string) || 'v';
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
  if (phase === 'leave') {
    return {
      from: str(props.leaveFromClass) ?? `${name}-leave-from`,
      active: str(props.leaveActiveClass) ?? `${name}-leave-active`,
      to: str(props.leaveToClass) ?? `${name}-leave-to`,
    };
  }
  const enter = {
    from: str(props.enterFromClass) ?? `${name}-enter-from`,
    active: str(props.enterActiveClass) ?? `${name}-enter-active`,
    to: str(props.enterToClass) ?? `${name}-enter-to`,
  };
  if (phase === 'enter') return enter;
  return {
    from: str(props.appearFromClass) ?? enter.from,
    active: str(props.appearActiveClass) ?? enter.active,
    to: str(props.appearToClass) ?? enter.to,
  };
}

/** The `css` prop, as Vue reads it: only an explicit false turns classes off. */
const usesCss = (props: Props): boolean => props.css !== false && props.css !== 'false';

function enterOne(props: Props, host: HostNode, appear: boolean, done: () => void): void {
  const st = stateOf(host);
  st.cancelLeave?.();
  const t = be().transition;
  const css = usesCss(props) && t !== undefined;
  const cls = classesOf(props, appear ? 'appear' : 'enter');
  const onBefore = appear ? props.onBeforeAppear ?? props.onBeforeEnter : props.onBeforeEnter;
  const onEnter = appear ? props.onAppear ?? props.onEnter : props.onEnter;
  const onAfter = appear ? props.onAfterAppear ?? props.onAfterEnter : props.onAfterEnter;
  const onCancelled = appear ? props.onAppearCancelled ?? props.onEnterCancelled : props.onEnterCancelled;
  const endId = ++st.endId;
  let finished = false;
  const finish = (cancelled: boolean): void => {
    if (finished) return;
    finished = true;
    if (st.cancelEnter === cancel) st.cancelEnter = undefined;
    if (css) {
      t!.removeClass(host, cls.from);
      t!.removeClass(host, cls.to);
      t!.removeClass(host, cls.active);
    }
    if (cancelled) {
      callHook(onCancelled, host);
    } else {
      callHook(onAfter, host);
      done();
    }
  };
  const cancel = (): void => finish(true);
  st.cancelEnter = cancel;
  callHook(onBefore, host);
  if (css) {
    t!.addClass(host, cls.from);
    t!.addClass(host, cls.active);
  }
  callHook(onEnter, host, () => finish(false));
  const explicit = takesDone(onEnter);
  if (!css) {
    if (!explicit) finish(false);
    return;
  }
  t!.nextFrame(() => {
    if (finished) return;
    t!.removeClass(host, cls.from);
    t!.addClass(host, cls.to);
    if (!explicit) {
      t!.whenEnds(host, durationOf(props, 'enter'), () => {
        if (st.endId === endId) finish(false);
      });
    }
  });
}

function leaveOne(props: Props, host: HostNode, done: () => void): void {
  const st = stateOf(host);
  st.cancelEnter?.();
  const t = be().transition;
  const css = usesCss(props) && t !== undefined;
  const cls = classesOf(props, 'leave');
  const endId = ++st.endId;
  let finished = false;
  const finish = (cancelled: boolean): void => {
    if (finished) return;
    finished = true;
    if (st.cancelLeave === cancel) st.cancelLeave = undefined;
    if (css) {
      t!.removeClass(host, cls.from);
      t!.removeClass(host, cls.to);
      t!.removeClass(host, cls.active);
    }
    if (cancelled) {
      callHook(props.onLeaveCancelled, host);
    } else {
      callHook(props.onAfterLeave, host);
      done();
    }
  };
  const cancel = (): void => finish(true);
  st.cancelLeave = cancel;
  callHook(props.onBeforeLeave, host);
  if (css) {
    t!.addClass(host, cls.from);
    t!.addClass(host, cls.active);
  }
  const explicit = takesDone(props.onLeave);
  if (css) {
    t!.nextFrame(() => {
      if (finished) return;
      t!.removeClass(host, cls.from);
      t!.addClass(host, cls.to);
      if (!explicit) {
        t!.whenEnds(host, durationOf(props, 'leave'), () => {
          if (st.endId === endId) finish(false);
        });
      }
    });
  }
  callHook(props.onLeave, host, () => finish(false));
  if (!css && !explicit) finish(false);
}

/** Runs `each` over the element hosts, then `done` once all of them have
 * finished (a branch with no element finishes at once). */
function forElements(nodes: readonly HostNode[], each: (host: HostNode, done: () => void) => void, done?: () => void): void {
  const t = be().transition;
  const els = nodes.filter((n) => (t ? t.isElement(n) : true));
  let left = els.length;
  if (left === 0) {
    done?.();
    return;
  }
  for (const host of els) {
    each(host, () => {
      if (--left === 0) done?.();
    });
  }
}

/** The hooks a <Transition> hangs on what it wraps. Props are read when a
 * transition starts, so a changed `name` applies to the next one. */
export function createTransitionHooks(props: Props): SwitchTransition & {
  appear(nodes: readonly HostNode[]): void;
} {
  return {
    get mode() {
      return props.mode;
    },
    enter(nodes, done) {
      forElements(nodes, (host, d) => enterOne(props, host, false, d), done);
    },
    leave(nodes, done) {
      forElements(nodes, (host, d) => leaveOne(props, host, d), done);
    },
    appear(nodes) {
      forElements(nodes, (host, d) => enterOne(props, host, true, d));
    },
  };
}

/** v-show under a <Transition>: the element's hooks, registered by the
 * Transition after its slot rendered (applyVShow asks at each toggle). */
const showTransitions = new WeakMap<object, SwitchTransition>();

export function setShowTransition(host: HostNode, hooks: SwitchTransition): void {
  showTransitions.set(host as object, hooks);
}

export function showTransitionOf(host: HostNode): SwitchTransition | undefined {
  return showTransitions.get(host as object);
}

/** <TransitionGroup>'s list hooks (specs/176): enter / leave per item as
 * <Transition> runs them, plus the move pass — FLIP: positions before the
 * update, then each kept item that moved is put back where it was with an
 * inline transform (transitions off), and a frame later the move class
 * goes on and the transform comes off, so the CSS transition slides it. */
export function createListHooks(props: Props): ListTransition & { appear(nodes: readonly HostNode[]): void } {
  const base = createTransitionHooks(props);
  const before = new Map<HostNode, { left: number; top: number }>();
  const moveClass = (): string => {
    const own = props.moveClass;
    return typeof own === 'string' && own !== '' ? own : `${(props.name as string) || 'v'}-move`;
  };
  return {
    enter: base.enter,
    leave: base.leave,
    appear: base.appear,
    beforeUpdate(hosts) {
      before.clear();
      const t = be().transition;
      if (!t || !usesCss(props)) return;
      for (const host of hosts) if (t.isElement(host)) before.set(host, t.rectOf(host));
    },
    afterUpdate(hosts) {
      const t = be().transition;
      if (!t || before.size === 0) return;
      const moved: HostNode[] = [];
      for (const host of hosts) {
        const was = before.get(host);
        if (!was) continue;
        const now = t.rectOf(host);
        const dx = was.left - now.left;
        const dy = was.top - now.top;
        if (dx === 0 && dy === 0) continue;
        setStyleHost(host, { transform: `translate(${dx}px, ${dy}px)`, transitionDuration: '0s' });
        moved.push(host);
      }
      before.clear();
      if (moved.length === 0) return;
      const cls = moveClass();
      t.nextFrame(() => {
        for (const host of moved) {
          const st = stateOf(host);
          const id = (st.moveId = (st.moveId ?? 0) + 1);
          t.addClass(host, cls);
          setStyleHost(host, { transform: '', transitionDuration: '' });
          // the end is read off the computed style, which shows the move
          // class only once it has been applied: measure a frame later
          t.nextFrame(() => {
            t.whenEnds(host, undefined, () => {
              if (st.moveId === id) t.removeClass(host, cls);
            });
          });
        }
      });
    },
  };
}

