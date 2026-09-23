// view / text / safe-area / scroll-view / image / button / divider.
import {
  computed,
  defineComponent,
  h,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watch,
} from 'vue';
import { hostAttrs, normalizeStyleValues } from '../style';
import { isRichSpans } from '../../rich-text/spans';
import {
  encodeImageError,
  encodeImageLoad,
  ImageLoadCycle,
} from '../../image/events';
import { resolveImageMode } from '../../image/mode';
import { IMAGE_LAZY_PRELOAD_PX } from '../../image/lazy';
import { resolveImageSrc } from '../../image/src';
import { FORM_ACTIONS, warnControlOnce as warnScrollOnce } from './scope';
import {
  DEFAULT_SCROLL_THRESHOLD,
  edgeTransition,
  edgeZone,
  scrollPayload,
  type ScrollEdge,
} from '../../scroll/metrics';
import { container, dragPanBindings, mergeBindings, pressBindings } from './gestures';

export const FjsView = container('view');
/** `text`. Not a plain container any more (specs/035): rich-text hands a
 * paragraph over as ONE node with its runs in the internal `richSpans` prop,
 * and this renders them as `<span style>` — the twin of widgets/text.dart
 * building TextSpans. The prop must not fall through to the element either:
 * it would land in the DOM as `richspans="[object Object]"`. Without the
 * prop it is exactly the old container. */
export const FjsText = defineComponent({
  name: 'Fjstext',
  inheritAttrs: false,
  emits: ['tap', 'longPress'],
  setup(_props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    return () => {
      const { richSpans, ...rest } = attrs as Record<string, unknown>;
      const bound = mergeBindings(hostAttrs(rest), press);
      if (richSpans === undefined) return h('text', bound, slots.default?.());
      if (!isRichSpans(richSpans)) {
        warnScrollOnce('text:richSpans', '<text> internal prop richSpans is malformed; rendered empty');
        return h('text', bound);
      }
      if (slots.default) {
        warnScrollOnce('text:richSpans-children', '<text> got richSpans together with children; the children are ignored');
      }
      return h(
        'text',
        bound,
        richSpans.map((run) =>
          typeof run === 'string' ? run : h('span', { style: normalizeStyleValues(run.s) }, run.t),
        ),
      );
    };
  },
});
export const FjsSafeArea = container('safe-area');
/** A swiper page. No behaviour — but it renders as its own element so the
 * base stylesheet can size a page's content (`swiper-item > *`); mapping it
 * to a plain view would put an unstyled box between the track cell and the
 * content, and the content would collapse to its natural height. */
export const FjsSwiperItem = container('swiper-item');
export const FjsScrollView = defineComponent({
  name: 'FjsScrollView',
  inheritAttrs: false,
  props: {
    /** Direction. These win over the `direction` style key fjs shipped
     * first — different layers, both still valid (spec 009 Q1). */
    scrollX: { type: Boolean, default: false },
    scrollY: { type: Boolean, default: false },
    scrollTop: { type: [Number, String], default: undefined },
    scrollLeft: { type: [Number, String], default: undefined },
    scrollIntoView: { type: String, default: '' },
    scrollWithAnimation: { type: Boolean, default: false },
    upperThreshold: { type: [Number, String], default: DEFAULT_SCROLL_THRESHOLD },
    lowerThreshold: { type: [Number, String], default: DEFAULT_SCROLL_THRESHOLD },
  },
  emits: ['tap', 'longPress', 'scroll', 'scrolltoupper', 'scrolltolower'],
  setup(props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    const host = ref<HTMLElement | null>(null);
    const pan = dragPanBindings(host);

    const horizontal = () => {
      if (props.scrollX && props.scrollY) {
        warnScrollOnce(
          'scroll-both-axes',
          '<scroll-view> sets both scroll-x and scroll-y; fjs scrolls ' +
            'vertically. Pick one.',
        );
        return false;
      }
      if (props.scrollX) return true;
      if (props.scrollY) return false;
      // fall back to the style key
      return (
        (attrs.style as Record<string, unknown> | undefined)?.direction ===
        'horizontal'
      );
    };

    let edge: ScrollEdge = null;
    let lastReported = 0;
    let scrollQueued = false;
    /** Last position the PAGE asked for; only a change moves the scroller,
     * so a re-render cannot yank a finger-driven scroll back. */
    let lastRequestedOffset: number | undefined;
    let lastRequestedView = '';

    const num = (value: unknown): number | undefined => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };

    const moveTo = (offset: number) => {
      const el = host.value;
      if (!el) return;
      const behavior = props.scrollWithAnimation ? 'smooth' : 'auto';
      if (horizontal()) el.scrollTo({ left: offset, behavior });
      else el.scrollTo({ top: offset, behavior });
    };

    /** Same measurement the Dart side makes: the target's offset inside this
     * scroller, not scrollIntoView() with its own alignment rules. */
    const scrollIntoViewById = (id: string) => {
      const el = host.value;
      if (!el) return;
      const target = el.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (!target) {
        warnScrollOnce(
          `scroll-into-view:${id}`,
          `<scroll-view>: scroll-into-view="${id}" matches no descendant ` +
            'id — nothing scrolled.',
        );
        return;
      }
      // A target inside a sticky header is measured by its SECTION, never
      // by the header's own rect: once the header has pinned — or been
      // pushed out with its group — the painted rect no longer says where
      // the group starts, and the jump lands mid-transition with two
      // headers stacked (specs/054, found jumping A←D on the grouped
      // sticky demo). skyline's native scroll-into-view lands on the group
      // start; a sticky-section is plain flow so its rect IS the layout
      // answer. A bare sticky-header has no section, so its painted rect
      // remains the best available estimate.
      const header = target.closest('sticky-header');
      const section = header?.closest('sticky-section');
      const anchor =
        section && el.contains(section) ? (section as HTMLElement) : target;
      const delta = horizontal()
        ? anchor.getBoundingClientRect().left - el.getBoundingClientRect().left
        : anchor.getBoundingClientRect().top - el.getBoundingClientRect().top;
      moveTo((horizontal() ? el.scrollLeft : el.scrollTop) + delta);
    };

    const applyProps = () => {
      const target = num(horizontal() ? props.scrollLeft : props.scrollTop);
      if (target !== undefined && target !== lastRequestedOffset) {
        lastRequestedOffset = target;
        moveTo(target);
      }
      // Empty clears the memo instead of being ignored: the miniprogram
      // idiom for re-requesting the SAME id (jump away by hand, ask again)
      // is '' then the id on the next tick. Without this reset the same
      // page would re-jump on skyline but sit dead here — constitution I.
      if (!props.scrollIntoView) {
        lastRequestedView = '';
      } else if (props.scrollIntoView !== lastRequestedView) {
        lastRequestedView = props.scrollIntoView;
        scrollIntoViewById(props.scrollIntoView);
      }
    };

    /** Prime, do not report (scroll/metrics.ts): a list that opens at the
     * top is already in the upper zone.
     *
     * Synchronous on mount, NOT deferred to nextTick: a scroll that arrives
     * before the priming ran would be compared against a null state, report
     * its edge, and then be overwritten — the event would look swallowed on
     * whichever platform got there first. */
    const primeEdge = () => {
      const el = host.value;
      const x = horizontal();
      edge = edgeZone({
        offset: (x ? el?.scrollLeft : el?.scrollTop) ?? 0,
        viewport: (x ? el?.clientWidth : el?.clientHeight) ?? 0,
        content: (x ? el?.scrollWidth : el?.scrollHeight) ?? 0,
        upperThreshold: Number(props.upperThreshold) || 0,
        lowerThreshold: Number(props.lowerThreshold) || 0,
      });
    };

    onMounted(() => {
      primeEdge();
      nextTick(applyProps);
    });
    onUpdated(() => nextTick(applyProps));

    const report = () => {
      const el = host.value;
      if (!el) return;
      const x = horizontal();
      const offset = x ? el.scrollLeft : el.scrollTop;

      const step = edgeTransition(edge, {
        offset,
        viewport: x ? el.clientWidth : el.clientHeight,
        content: x ? el.scrollWidth : el.scrollHeight,
        upperThreshold: Number(props.upperThreshold) || 0,
        lowerThreshold: Number(props.lowerThreshold) || 0,
      });
      edge = step.state;
      if (step.emit === 'upper') emit('scrolltoupper');
      if (step.emit === 'lower') emit('scrolltolower');

      const delta = offset - lastReported;
      lastReported = offset;
      emit(
        'scroll',
        scrollPayload({
          scrollTop: x ? 0 : offset,
          scrollLeft: x ? offset : 0,
          scrollHeight: x ? 0 : el.scrollHeight,
          scrollWidth: x ? el.scrollWidth : 0,
          deltaX: x ? delta : 0,
          deltaY: x ? 0 : delta,
        }),
      );
    };

    // One report per frame, the rate Flutter's postFrame queue keeps.
    const onScroll = () => {
      if (scrollQueued) return;
      scrollQueued = true;
      const flush = () => {
        scrollQueued = false;
        report();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
      else flush();
    };

    return () =>
      h(
        'scroll-view',
        {
          ...mergeBindings(hostAttrs(attrs), press, pan, { onScroll }),
          ref: host,
        },
        slots.default?.(),
      );
  },
});

// moved next to the canvas image loader's use of it; re-exported for callers
// that already import it from here
export { resolveImageSrc };

export const FjsImage = defineComponent({
  name: 'FjsImage',
  inheritAttrs: false,
  props: {
    src: { type: String, default: '' },
    mode: { type: String, default: undefined },
    fit: { type: String, default: undefined },
    lazyLoad: { type: Boolean, default: false },
  },
  emits: ['tap', 'longPress', 'load', 'error'],
  setup(props, { attrs, emit }) {
    const press = pressBindings(emit);
    const image = ref<HTMLImageElement | null>(null);
    const activeSrc = ref('');
    const cycle = new ImageLoadCycle();
    let observer: IntersectionObserver | null = null;
    let generation = cycle.begin();

    const mode = () =>
      resolveImageMode(props.mode, props.fit, (message) =>
        warnScrollOnce(`image-mode:${message}`, message),
      );

    // heightFix, measured (specs/102): WeChat keeps a *declared* width and
    // derives the height from it — with both width and height in the page's
    // CSS it renders exactly like widthFix (281x188 on dist/mp against our
    // old 257x170) — and only honours the declared height when width is not
    // declared (`height: 64px` alone stayed 32x64 on both ends).
    // The declared width usually lives in the page's class CSS, which this
    // render pass cannot see, so don't guess it: measure the width the
    // browser actually laid out and pin `height = w * nh / nw` *only* when
    // the page's own CSS does not already produce that height — reading the
    // un-pinned height first keeps the class authoritative everywhere
    // except the one case WeChat overrides too. The measure is idempotent:
    // a declared width does not move when the height changes, and an auto
    // width is derived from the height we are about to compute.
    const fixHeight = ref<string | null>(null);
    const syncFixHeight = async () => {
      const before = image.value;
      if (mode().fix !== 'height') {
        fixHeight.value = null;
        return;
      }
      if (!before || !before.naturalWidth || !before.naturalHeight) return;
      // Drop any pin from the previous src/mode first, or the comparison
      // would only ever confirm itself.
      fixHeight.value = null;
      await nextTick();
      const el = image.value;
      if (!el || el !== before || !el.naturalWidth) return;
      const box = el.getBoundingClientRect();
      if (!box.width) return;
      const derived = (box.width * el.naturalHeight) / el.naturalWidth;
      if (Math.abs(box.height - derived) > 0.5) {
        fixHeight.value = `${derived}px`;
      }
    };

    const stopObserver = () => {
      observer?.disconnect();
      observer = null;
    };

    const start = () => {
      stopObserver();
      activeSrc.value = resolveImageSrc(props.src);
    };

    const watchVisibility = () => {
      if (!props.lazyLoad) {
        start();
        return;
      }
      if (typeof IntersectionObserver !== 'function') {
        warnScrollOnce(
          'image-lazy-load',
          '<image lazy-load> is not supported by this browser; loading now.',
        );
        start();
        return;
      }
      const target = image.value;
      if (!target) return;
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) start();
        },
        // Not a bare intersection: Flutter preloads by the same margin
        // (image/lazy.ts), and without it the two ends start loading at
        // visibly different scroll offsets.
        { rootMargin: `${IMAGE_LAZY_PRELOAD_PX}px` },
      );
      observer.observe(target);
    };

    const restart = () => {
      generation = cycle.begin();
      activeSrc.value = '';
      nextTick(watchVisibility);
    };

    watch(() => [props.src, props.lazyLoad], restart);
    // A pin from the previous mode/src must not survive into the new layout:
    // the page's CSS decides again until syncFixHeight has re-measured.
    watch(
      () => [props.mode, props.src],
      () => {
        fixHeight.value = null;
        nextTick(syncFixHeight);
      },
    );
    onMounted(() => {
      if (!props.lazyLoad) start();
      else nextTick(watchVisibility);
      nextTick(syncFixHeight);
    });
    onBeforeUnmount(stopObserver);

    const imageAttrs = () => {
      const base = hostAttrs(attrs);
      const raw = base.style;
      const style: Record<string, unknown> =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : {};
      const resolved = mode();
      style.objectFit = resolved.objectFit;
      style.objectPosition = resolved.objectPosition;
      if (resolved.fix === 'width') style.height = 'auto';
      if (resolved.fix === 'height') {
        // WeChat derives heightFix's height from a declared width instead of
        // the other way round (specs/102), so the page's width must stay
        // untouched: the old `width: auto` threw a declared 280px away and
        // shrank the box to height * ratio. syncFixHeight pins the height
        // that the measured width implies, and only when the page's own CSS
        // does not already give it.
        // In a column flex — which every <view> is — the width still has to
        // leave the cross-axis stretch, or the measured width would be the
        // container's rather than the image's (and the browser could not
        // derive width from the declared height either).
        if (style.alignSelf === undefined) style.alignSelf = 'flex-start';
        if (fixHeight.value !== null) style.height = fixHeight.value;
      }
      return { ...base, style };
    };

    return () => {
      const renderGeneration = generation;
      return h(
        'img',
        {
          ...mergeBindings(imageAttrs(), press),
          key: renderGeneration,
          ref: image,
          class: ['fjs-image', attrs.class],
          // asset:// is the Flutter asset scheme; on the web the same files
          // are served from the bundle root
          src: activeSrc.value || undefined,
          onLoad: (event: Event) => {
            const target = event.currentTarget as HTMLImageElement;
            if (renderGeneration !== generation) return;
            if (cycle.finish(renderGeneration, 'load')) {
              emit(
                'load',
                encodeImageLoad(target.naturalWidth, target.naturalHeight),
              );
            }
            // heightFix only becomes measurable once the ratio is known.
            void syncFixHeight();
          },
          onError: () => {
            if (renderGeneration !== generation) return;
            if (cycle.finish(renderGeneration, 'error')) {
              emit('error', encodeImageError());
            }
          },
        },
      );
    };
  },
});

export const FjsButton = defineComponent({
  name: 'FjsButton',
  inheritAttrs: false,
  props: {
    disabled: { type: Boolean, default: false },
    /** default (hairline) / primary / warn; `plain` is the outlined one.
     * The numbers behind these live in base-css.ts and, on the other side,
     * in widgets/button.dart. */
    type: { type: String, default: 'default' },
    size: { type: String, default: 'default' },
    plain: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    /** submit / reset on the nearest enclosing <form>. */
    formType: { type: String, default: '' },
  },
  emits: ['tap', 'longPress'],
  setup(props, { attrs, slots, emit }) {
    const press = pressBindings(emit);
    const form = inject(FORM_ACTIONS, null);
    // A loading button is inert too — same rule as fjsButtonIsInteractive
    // on the Dart side.
    const inert = computed(() => props.disabled || props.loading);
    const variant = computed(() => {
      const type = props.type === 'primary' || props.type === 'warn'
        ? props.type
        : 'default';
      return [
        `fjs-button--${type}`,
        ...(props.plain ? ['fjs-button--plain'] : []),
        ...(props.size === 'mini' ? ['fjs-button--mini'] : []),
        ...(props.loading ? ['fjs-button--loading'] : []),
      ];
    });
    const onFormType = () => {
      if (inert.value) return;
      if (props.formType === 'submit') form?.submit();
      if (props.formType === 'reset') form?.reset();
    };
    return () =>
      h(
        'button',
        {
          ...mergeBindings(
            hostAttrs(attrs),
            // An inert button must not emit tap or long-press either.
            inert.value ? {} : press,
            { onClick: onFormType },
          ),
          type: 'button',
          // Only `disabled` fades the button (`.fjs-button:disabled`);
          // `loading` is inert without fading, which is what the Dart side
          // does too (widgets/button.dart returns no Opacity for it).
          disabled: props.disabled,
          class: ['fjs-button', ...variant.value, attrs.class],
        },
        props.loading
          ? [h('i', { class: 'fjs-button-spinner' }), slots.default?.()]
          : slots.default?.(),
      );
  },
});

export const FjsDivider = defineComponent({
  name: 'FjsDivider',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h('divider', { ...hostAttrs(attrs) });
  },
});
