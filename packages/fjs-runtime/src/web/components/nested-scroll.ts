// nested-scroll-header / nested-scroll-body (specs/208). The web substrate
// is a single scroller: the host scroll-view scrolls everything, the header
// rides out with its scroll, and the scroller sitting directly in the body
// is absorbed via base-css (overflow: visible, natural height) so its rows
// join the same scroll. The Dart side earns the identical single-scroll
// semantics in its CustomScrollView route (constitution I); skyline keeps
// the native pair, and the webview build flattens the pair at compile time.
//
// offset-top is the one measured behaviour: wx 3.6.2+ collapses the header
// only down to this inset — the body never rises closer to the viewport top
// and the inner content scrolls below it. The tail is a NEGATIVE-top sticky
// on the header (`top: offset-top - headerHeight`, pinned by the body that
// owns the prop): the header scrolls naturally until its bottom edge is
// offset-top from the viewport top, then holds there while the rows slide
// beneath it. Scroll stays fully native — no per-frame JS, no clamp (an
// earlier clamp at the collapse point froze the whole scroller: the rows
// scroll in the SAME scroller, so anything that caps it caps the list too,
// found on the hello-fjs page). skyline clips instead of overlaying; the
// see-through difference is registered in docs/ui-api.md.
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { hostAttrs } from '../style';
import { warnControlOnce } from './scope';
import { mergeBindings, pressBindings } from './gestures';

/** `<nested-scroll-header>`: a plain block container. wx renders exactly its
 * first element child — base-css hides the rest. */
export const FjsNestedScrollHeader = defineComponent({
  name: 'FjsNestedScrollHeader',
  inheritAttrs: false,
  emits: ['tap', 'longPress'],
  setup(_props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    return () =>
      h(
        'nested-scroll-header',
        mergeBindings(hostAttrs(attrs), press),
        slots.default?.(),
      );
  },
});

export const FjsNestedScrollBody = defineComponent({
  name: 'FjsNestedScrollBody',
  inheritAttrs: false,
  props: {
    /** Collapse inset from the viewport top, px (wx offset-top, 3.6.2+). */
    offsetTop: { type: [Number, String], default: 0 },
  },
  emits: ['tap', 'longPress'],
  setup(props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    const host = ref<HTMLElement | null>(null);
    let header: HTMLElement | null = null;
    let observer: ResizeObserver | undefined;

    const offsetTop = () => {
      const n = Number(props.offsetTop);
      return Number.isFinite(n) ? n : 0;
    };

    /** The tail: pin the header so its bottom edge rests offset-top from the
     * viewport top. sticky's containing block is the scroll content itself,
     * so the pin holds for the whole scroll and reverses on the way back —
     * the CSS answer to the Dart collapse sliver. */
    const pinHeader = () => {
      if (!header) return;
      header.style.position = 'sticky';
      header.style.top = `${Math.min(offsetTop() - header.offsetHeight, 0)}px`;
      header.style.zIndex = '1';
    };

    const unpinHeader = () => {
      if (!header) return;
      header.style.removeProperty('position');
      header.style.removeProperty('top');
      header.style.removeProperty('z-index');
    };

    onMounted(() => {
      const el = host.value;
      if (!el) return;
      const scroller = el.closest('scroll-view') as HTMLElement | null;
      if (!scroller) {
        warnControlOnce(
          'nested-scroll-body:scroller',
          '<nested-scroll-body> has no <scroll-view> ancestor; offset-top has nothing to pin against.',
        );
        return;
      }
      if (scroller.getAttribute('type') !== 'nested') {
        warnControlOnce(
          'nested-scroll-body:host',
          '<nested-scroll-body> outside <scroll-view type="nested">: it scrolls as ordinary content and offset-top is ignored.',
        );
        return;
      }
      // wx semantics put the tail on the LAST header, which is the one that
      // sits right before the body in the ordinary layout.
      const prev = el.previousElementSibling;
      if (offsetTop() <= 0) return;
      if (!prev || prev.tagName.toLowerCase() !== 'nested-scroll-header') {
        warnControlOnce(
          'nested-scroll-body:header',
          `<nested-scroll-body offset-top> has no <nested-scroll-header> right before it — the inset has no header to pin.`,
        );
        return;
      }
      header = prev as HTMLElement;
      pinHeader();
      // Header content height is a layout product (async images, rerenders);
      // the pin line must follow it.
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(pinHeader);
        observer.observe(header);
      }
    });
    onBeforeUnmount(() => {
      observer?.disconnect();
      unpinHeader();
    });

    return () =>
      h(
        'nested-scroll-body',
        { ...mergeBindings(hostAttrs(attrs), press), ref: host },
        slots.default?.(),
      );
  },
});
