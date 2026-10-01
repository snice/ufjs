// swiper -> PageView.
import {
  Comment,
  Fragment,
  Text,
  cloneVNode,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  watch,
  watchEffect,
  type VNode,
} from 'vue';
import { hostAttrs } from '../style';
import { wrapIndex } from '../../scroll/metrics';
import { FjsSwiperItem } from './basic';
import { warnControlOnce } from './scope';

const TRACK_CELL = 'fjs-swiper-item';

/** The page's own <swiper-item> becomes the track cell. The compiler
 * already rejects anything else in a template (specs/051), so a bare child
 * here came from a render function or a <slot>: it still gets a page — a
 * wrapper of our own — and a warning, the way Flutter's adapter does. */
function trackCell(page: VNode, key: PropertyKey | undefined): VNode {
  // a vapor page's <swiper-item> reaches here as a host marker carrying its
  // tag (vapor/render-host.ts, specs/171)
  if (page.type === FjsSwiperItem || page.type === 'swiper-item' || (page.props as { __fjsTag?: unknown } | null)?.__fjsTag === 'swiper-item') {
    return key === undefined
      ? cloneVNode(page, { class: TRACK_CELL })
      : cloneVNode(page, { class: TRACK_CELL, key });
  }
  warnControlOnce(
    'swiper:bare-page',
    '<swiper> child is not a <swiper-item>; it is shown as a page anyway, but wrap it in <swiper-item>',
  );
  return h('swiper-item', { class: TRACK_CELL, key: key ?? page.key ?? undefined }, [page]);
}

/** A circular clone: its own key (the real page is a sibling with the same
 * one) and no template ref, which belongs to the real page. */
function cloneCell(page: VNode, key: string): VNode {
  const cell = trackCell(cloneVNode(page), key);
  cell.ref = null;
  return cell;
}

/** One page per real child, the way PageView counts them.
 *
 * `<swiper><swiper-item v-for=... /></swiper>` hands the slot a single
 * Fragment vnode, not three items — taking the slot's vnodes as they come
 * would make the whole v-for one page. Flutter never sees this: the JS renderer
 * flattens fragments before the ops reach Dart, so `buildKids()` there is
 * already the list of real children. Comments (v-if anchors) and blank text
 * take no page, as FjsNodeRenderer.isHidden drops them on the Flutter side. */
function swiperPages(nodes: VNode[]): VNode[] {
  const out: VNode[] = [];
  for (const vnode of nodes) {
    if (vnode == null) continue;
    if (vnode.type === Fragment) {
      out.push(...swiperPages((vnode.children ?? []) as VNode[]));
      continue;
    }
    if (vnode.type === Comment) continue;
    if (vnode.type === Text && String(vnode.children ?? '').trim() === '') continue;
    out.push(vnode);
  }
  return out;
}

export const FjsSwiper = defineComponent({
  name: 'FjsSwiper',
  inheritAttrs: false,
  props: {
    /** Controlled page. Only a CHANGE turns the pager, so a re-render never
     * drags the user's own swipe back (same rule as scroll-top). */
    current: { type: [Number, String], default: undefined },
    autoplay: { type: Boolean, default: false },
    interval: { type: [Number, String], default: 5000 },
    duration: { type: [Number, String], default: 500 },
    circular: { type: Boolean, default: false },
    vertical: { type: Boolean, default: false },
    indicatorDots: { type: Boolean, default: false },
    indicatorColor: { type: String, default: '' },
    indicatorActiveColor: { type: String, default: '' },
  },
  emits: ['pageChanged', 'change'],
  setup(props, { attrs, slots, emit }) {
    // Paging is driven here rather than left to CSS scroll-snap: a fling or
    // a long drag crosses several snap points at once, while a PageView
    // turns exactly one page per gesture. The track keeps `overflow` hidden
    // (still scrollable through scrollLeft/scrollTop) and a `touch-action`
    // that leaves the other axis to the page.
    const track = ref<HTMLElement | null>(null);
    /** The REAL index, 0..count-1 — never a clone's slot. */
    const index = ref(0);
    /** Reactive: the count is only known once the slot has rendered, and
     * autoplay's timer depends on it — a plain variable meant the timer was
     * decided at setup time, when there were still zero pages, and autoplay
     * silently never started. */
    const pageCount = ref(0);
    let lastRequestedCurrent: number | undefined;
    let held = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const vertical = () => props.vertical;
    const extent = () =>
      Math.max(
        1,
        (vertical() ? track.value?.clientHeight : track.value?.clientWidth) ?? 1,
      );
    /** With `circular` the track carries [lastClone, ...pages, firstClone],
     * so a real index sits one slot in. */
    const slotOf = (real: number) => (props.circular ? real + 1 : real);
    const scrollOffset = () =>
      (vertical() ? track.value?.scrollTop : track.value?.scrollLeft) ?? 0;

    const setOffset = (offset: number, animate: boolean) => {
      const el = track.value;
      if (!el) return;
      const behavior = animate ? 'smooth' : 'auto';
      if (vertical()) el.scrollTo({ top: offset, behavior });
      else el.scrollTo({ left: offset, behavior });
    };

    /** Moves to a real index, reporting it once. `via` lets a wrap step
     * through the clone so the motion stays in one direction. */
    const goTo = (next: number, { animate = true, silent = false } = {}) => {
      if (pageCount.value === 0) return;
      const real = props.circular
        ? wrapIndex(next, pageCount.value)
        : Math.max(0, Math.min(pageCount.value - 1, next));
      const slot = props.circular && next !== real ? slotOf(next) : slotOf(real);
      setOffset(slot * extent(), animate);
      if (props.circular && next !== real) {
        // landed on a clone: after the animation, jump to the real page with
        // no animation so the next swipe continues from the right place
        setTimeout(
          () => setOffset(slotOf(real) * extent(), false),
          Number(props.duration) || 0,
        );
      }
      if (real === index.value) return;
      index.value = real;
      if (silent) return;
      emit('pageChanged', String(real));
      emit('change', String(real));
    };

    watch(
      () => props.current,
      (raw) => {
        if (raw == null) return;
        const target = Number(raw);
        if (!Number.isFinite(target) || target === lastRequestedCurrent) return;
        lastRequestedCurrent = target;
        goTo(target);
      },
      { immediate: true },
    );

    const restartTimer = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      if (!props.autoplay || pageCount.value <= 1) return;
      timer = setInterval(() => {
        if (held) return;
        if (!props.circular && index.value >= pageCount.value - 1) return;
        goTo(index.value + 1);
      }, Math.max(50, Number(props.interval) || 5000));
    };
    watch(
      () => [props.autoplay, props.interval, props.circular, pageCount.value],
      restartTimer,
      { immediate: true },
    );
    onBeforeUnmount(() => {
      if (timer !== null) clearInterval(timer);
    });

    let drag: { at: number; from: number } | null = null;
    const pointerPos = (event: PointerEvent) =>
      vertical() ? event.clientY : event.clientX;

    const onPointerdown = (event: PointerEvent) => {
      const el = track.value;
      if (!el || (event.pointerType === 'mouse' && event.button !== 0)) return;
      held = true;
      drag = { at: pointerPos(event), from: scrollOffset() };
      // an enclosing scroll-view pans on drags too; the page under a
      // PageView does not move with it on Flutter either
      event.stopPropagation();
      el.setPointerCapture(event.pointerId);
    };
    const onPointermove = (event: PointerEvent) => {
      const el = track.value;
      if (!drag || !el) return;
      event.preventDefault(); // otherwise the drag selects text
      const size = extent();
      // the drag never reaches past a neighbour, however far it goes
      const offset = Math.max(-size, Math.min(size, drag.at - pointerPos(event)));
      const next = drag.from + offset;
      if (vertical()) el.scrollTop = next;
      else el.scrollLeft = next;
    };
    const onPointerup = (event: PointerEvent) => {
      held = false;
      if (!drag) return;
      const delta = pointerPos(event) - drag.at;
      drag = null;
      const size = extent();
      // a fifth of the page is PageView's own threshold for turning one
      goTo(index.value + (delta <= -size * 0.2 ? 1 : delta >= size * 0.2 ? -1 : 0));
    };

    // a resize (rotation, a split window) leaves the offset between two
    // pages; PageView stays on its page across a relayout
    let observer: ResizeObserver | null = null;
    watchEffect(() => {
      observer?.disconnect();
      const el = track.value;
      if (!el || typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(() =>
        setOffset(slotOf(index.value) * extent(), false),
      );
      observer.observe(el);
    });
    onBeforeUnmount(() => observer?.disconnect());

    // trackpads and horizontal wheels: one page per gesture, and the
    // momentum tail of that gesture must not turn another
    let wheelLockUntil = 0;
    const onWheel = (event: WheelEvent) => {
      const along = vertical() ? event.deltaY : event.deltaX;
      const across = vertical() ? event.deltaX : event.deltaY;
      if (Math.abs(along) <= Math.abs(across)) return; // page scroll
      event.preventDefault();
      const now = Date.now();
      if (now < wheelLockUntil || along === 0) return;
      wheelLockUntil = now + 400;
      goTo(index.value + (along > 0 ? 1 : -1));
    };

    return () => {
      const pages = swiperPages(slots.default?.() ?? []);
      pageCount.value = pages.length;
      const slots_: VNode[] = pages.map((page) => trackCell(page, undefined));
      // Clones make the wrap seamless, the way Flutter's unbounded PageView
      // does. `@change` still reports the real index either way.
      const children =
        props.circular && pageCount.value > 1
          ? [
              cloneCell(pages[pageCount.value - 1], '__fjs-swiper-head'),
              ...slots_,
              cloneCell(pages[0], '__fjs-swiper-tail'),
            ]
          : slots_;

      if (props.indicatorDots && pageCount.value > 0) {
        children.push(
          h(
            'swiper-dots',
            {
              class: ['fjs-swiper-dots', { vertical: props.vertical }],
            },
            Array.from({ length: pageCount.value }, (_, i) =>
              h('swiper-dot', {
                class: ['fjs-swiper-dot', { active: i === index.value }],
                style: {
                  background:
                    i === index.value
                      ? props.indicatorActiveColor || undefined
                      : props.indicatorColor || undefined,
                },
              }),
            ),
          ),
        );
      }

      return h(
        'swiper',
        {
          ...hostAttrs(attrs),
          class: ['fjs-swiper', { vertical: props.vertical }, attrs.class],
          ref: track,
          onPointerdown,
          onPointermove,
          onPointerup,
          onPointercancel: onPointerup,
          onWheel,
        },
        children,
      );
    };
  },
});
