// Gesture plumbing shared by the web tag implementations: the tap /
// long-press contract of Flutter's GestureDetector, and the mouse drag
// panning its scrollables get from FjsMouseDragScrollBehavior.
import { defineComponent, h, type Ref } from 'vue';
import { hostAttrs } from '../style';

const LONG_PRESS_MS = 500;

/** Merges binding maps that share handler keys (`onPointerdown` is claimed
 * by the press contract, by drag-to-pan and by the touch events) into one
 * map that calls each of them, in the order given. */
export function mergeBindings(
  ...maps: Array<Record<string, unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      const prev = out[key];
      if (typeof prev === 'function' && typeof value === 'function') {
        const a = prev as (...args: unknown[]) => void;
        const b = value as (...args: unknown[]) => void;
        out[key] = (...args: unknown[]) => {
          a(...args);
          b(...args);
        };
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

type Emit = (event: never, ...args: unknown[]) => void;

/** Pointer bindings that reproduce GestureDetector's tap + long press.
 * A fired long press swallows the click that follows it, like Flutter. */
export function pressBindings(emit: Emit) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerdown: () => {
      fired = false;
      cancel();
      timer = setTimeout(() => {
        fired = true;
        emit('longPress' as never);
      }, LONG_PRESS_MS);
    },
    onPointerup: cancel,
    onPointercancel: cancel,
    onPointerleave: cancel,
    onClick: (event: MouseEvent) => {
      if (fired) {
        fired = false;
        event.stopPropagation();
        return;
      }
      emit('tap' as never);
    },
  };
}

/** Mouse drag panning for a scrollable.
 *
 * The renderer hands every Flutter scrollable a ScrollBehavior that accepts
 * mouse drags (desktop Flutter leaves them out), while a browser only pans a
 * scroller with the wheel or a finger — so dragging one with the mouse is
 * done by hand here. Touch keeps the platform's own momentum scrolling. */
export function dragPanBindings(host: Ref<HTMLElement | null>) {
  let from: { x: number; y: number; left: number; top: number } | null = null;
  let panned = false;
  const swallowClick = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const onPointerdown = (event: PointerEvent) => {
    const el = host.value;
    if (!el || event.pointerType === 'touch' || event.button !== 0) return;
    // a node that declared `touch-action` owns the gesture — the browser
    // already keeps its own scrolling out of the way for a finger, and this
    // is the mouse half of the same rule
    if (claimsGesture(event.target, el)) return;
    from = {
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    panned = false;
  };
  const onPointermove = (event: PointerEvent) => {
    const el = host.value;
    if (!from || !el) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    // a few pixels of slop first, so a click on a row stays a click
    if (!panned && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (!panned) {
      panned = true;
      el.setPointerCapture(event.pointerId);
    }
    event.preventDefault(); // otherwise the drag selects text
    el.scrollLeft = from.left - dx;
    el.scrollTop = from.top - dy;
  };
  // A page that preventDefaults a touchmove stops a finger from scrolling
  // on a phone; the same drag made with the mouse (vant's touch-emulator
  // turns it into touches) must not scroll here either. vant's picker in a
  // Popup — which sits inside the page's scroll-view, not teleported — spun
  // AND dragged the page along (specs/127). Seen in the capture phase,
  // because vant also stops propagation; checked after the dispatch, which
  // is when the page's listeners have had their say. The microtask runs
  // before the frame is painted, so the few pixels already panned by this
  // move's pointermove are never shown.
  const onTouchmoveCapture = (event: Event) => {
    if (!from) return;
    const start = from;
    queueMicrotask(() => {
      if (!event.defaultPrevented || from !== start) return;
      const el = host.value;
      if (el) {
        el.scrollLeft = start.left;
        el.scrollTop = start.top;
      }
      from = null;
      panned = false;
    });
  };
  const onPointerup = () => {
    from = null;
    if (!panned) return;
    panned = false;
    // the release would otherwise land as a tap on whatever ended up under
    // the cursor — a drag is not a tap on either platform
    host.value?.addEventListener('click', swallowClick, {
      capture: true,
      once: true,
    });
  };
  return {
    onPointerdown,
    onPointermove,
    onPointerup,
    onPointercancel: onPointerup,
    onTouchmoveCapture,
  };
}

/** Whether anything between [target] and the scroller [stop] declared a
 * `touch-action` that takes the gesture away from the scroller. */
function claimsGesture(target: EventTarget | null, stop: Element): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== stop) {
    const action = getComputedStyle(node).touchAction;
    if (action && action !== 'auto' && action !== 'manipulation') return true;
    node = node.parentElement;
  }
  return false;
}

/** Container-ish tags all share tap/long-press and attr pass-through. */
export function container(tag: string, hostTag = tag) {
  return defineComponent({
    name: `Fjs${tag}`,
    inheritAttrs: false,
    emits: ['tap', 'longPress'],
    setup(_props, { attrs, slots, emit }) {
      const press = pressBindings(emit);
      return () =>
        h(hostTag, mergeBindings(hostAttrs(attrs), press), slots.default?.());
    },
  });
}
