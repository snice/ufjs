// `v-motion` on the mini program (spec 061). There is no element to write to
// here: the template compiled to WXML, and @vueuse/motion's directive path
// is `el.style[key] = value` against a real node. So the runtime hands motion
// a DOM-SHAPED STAND-IN — one object carrying a reactive `style` — and the
// compiled template binds the stringified style back (`style="{{ __m0 }}"`).
// motion only ever touches `el.style[key]` and `el.style.transform`, so the
// stand-in is the whole adaptation; the animation itself (framesync +
// popmotion) runs untouched.
//
// The library stays out of the runtime bundle: the compiled page imports
// `useMotion` and passes it in, the same way it imports the rest of its deps.
import { computed, reactive, shallowRef, watch, type ComputedRef } from '@vue/reactivity';
import { onBeforeUnmount } from './vue.js';
import { stringifyStyle } from './style.js';

export interface MotionInstance {
  apply: (variant: string) => Promise<unknown>;
  stop: () => void;
}

/** What the page's `:ref` receives, and what motion animates. */
export interface MotionHost {
  style: Record<string, unknown>;
  motionInstance?: MotionInstance;
}

export type UseMotion = (
  target: unknown,
  variants: Record<string, unknown>,
  options: Record<string, boolean>,
) => MotionInstance;

/** `hovered` / `tapped` / `focused` need DOM event listeners and `visible`
 * needs an IntersectionObserver — neither exists on this host, so those two
 * features stay off (the compiler warns about the variants themselves). */
const FEATURES = {
  syncVariants: true,
  lifeCycleHooks: true,
  visibilityHooks: false,
  eventListeners: false,
};

function createHost(use: UseMotion, variants: Record<string, unknown>): MotionHost {
  const host: MotionHost = { style: reactive({}) };
  host.motionInstance = use(host, variants, FEATURES);
  return host;
}

/** One `v-motion` element outside any v-for: the style string it binds. */
export function motion(
  use: UseMotion,
  variants: () => Record<string, unknown>,
  attach?: (host: MotionHost) => void,
): ComputedRef<string> {
  const host = createHost(use, variants());
  attach?.(host);
  onBeforeUnmount(() => host.motionInstance?.stop());
  return computed(() => stringifyStyle(host.style));
}

/** `v-motion` inside a v-for: one instance per item (the variants may read
 * the item), and the template reads `__mN[index]`. Instances are kept across
 * renders — rebuilding them every tick would restart every animation. */
export function motionEach(
  use: UseMotion,
  list: () => unknown,
  variants: (item: unknown, index: number) => Record<string, unknown>,
  attach?: (host: MotionHost, item: unknown, index: number) => void,
  key?: (item: unknown, index: number) => unknown,
): ComputedRef<string[]> {
  const hosts = shallowRef<MotionHost[]>([]);
  watch(
    () => items(list()).map((item, i) => (key ? String(key(item, i)) : i)),
    (keys, prev) => {
      const current = items(list());
      const next = hosts.value.slice(0, keys.length);
      for (const gone of hosts.value.slice(keys.length)) gone.motionInstance?.stop();
      // a changed :key remounts the element on the other hosts, which is how
      // the entrance variant replays — here that is a fresh instance
      if (prev) {
        for (let i = 0; i < Math.min(prev.length, next.length); i++) {
          if (prev[i] === keys[i]) continue;
          next[i].motionInstance?.stop();
          next[i] = build(i);
        }
      }
      for (let i = next.length; i < keys.length; i++) next.push(build(i));
      hosts.value = next;

      function build(i: number): MotionHost {
        const host = createHost(use, variants(current[i], i));
        attach?.(host, current[i], i);
        return host;
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    for (const host of hosts.value) host.motionInstance?.stop();
  });
  return computed(() => hosts.value.map((host) => stringifyStyle(host.style)));
}

/** v-for over a number counts 1..n, as in Vue (the generated computeds in
 * wxml.ts apply the same rule). */
function items(list: unknown): unknown[] {
  if (typeof list === 'number') return Array.from({ length: list }, (_, i) => i + 1);
  return Array.from((list as unknown[]) || []);
}
