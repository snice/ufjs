// The Flutter half of <Transition> timing (specs/174 moved it out of
// vue-shim.ts so the vapor Transition shares it): class flips go through
// the style engine, and the end of a transition / animation is read off the
// element's computed durations — there are no DOM events on this side.
import type { Element } from '../ui/element';
import { styleEngine } from './host-ops';
import { trackTransitionClass, untrackTransitionClass } from './transition-classes';

/** The DOM classes are engine state here, not DOM attributes: read the
 * current list, mutate, write back. The engine restyles on its next flush,
 * which is what starts the `-active` animation — and what stops it when the
 * classes come off again. */
export function addTransitionClass(el: Element, cls: string): void {
  for (const c of cls.split(/\s+/)) {
    if (!c) continue;
    trackTransitionClass(el, c);
    const cur = styleEngine.classesOf(el.id);
    if (!cur.includes(c)) styleEngine.setClasses(el.id, [...cur, c].join(' '));
  }
}

export function removeTransitionClass(el: Element, cls: string): void {
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
export function nextFrame(cb: () => void): void {
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

export interface ElementFlags {
  _enterCancelled?: boolean;
  _isLeaving?: boolean;
  _endId?: number;
}

/** DOM listens for transitionend/animationend; there are no events on this
 * side — the peer runs the animation on its own ticker. The computed
 * animation / transition durations and delays (the `-active` class landed
 * one flush ago) decide when the classes come off. Neither = resolve now,
 * like vue's `if (!type) resolve()`. */
export function whenTransitionEnds(el: Element, explicitTimeout: number | undefined, resolve: () => void): void {
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
