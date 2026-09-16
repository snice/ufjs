// `page-container` — the route-level overlay, web half (specs/065).
//
// Flutter pushes a transparent route so the edge-swipe gesture closes the
// container; the browser has no page semantics to hook, so intercepting
// back is this adapter's known difference (docs/ui-api.md). Everything else
// is the same contract: props spelled like wx's, the leave chain fires on
// every close (mask handler / close-on-slide-down / `show = false`), and
// @after-leave is where the page syncs `show` back to false — the adapter
// owns the transition clock either way.
//
// The lifecycle is phase-driven, not v-if-driven: the panel must mount at
// its "out" transform, take one frame, then flip to "in" so the CSS
// transition has a from-value. transitionend on the panel settles a phase,
// with a duration+50ms timer as the fallback (a zero duration, or a
// display:none tab, never fires transitionend).
import { Teleport, computed, defineComponent, h, onBeforeUnmount, ref, watch } from 'vue';
import { hostAttrs } from '../style';
import { warnControlOnce } from './scope';

const KNOWN_POSITIONS = new Set(['top', 'bottom', 'right', 'center']);

// The same number as fjsPageContainerRadius in widgets/page_container.dart.
const ROUND_RADIUS: Record<string, string> = {
  bottom: '24px 24px 0 0',
  top: '0 0 24px 24px',
  right: '24px 0 0 24px',
  center: '24px',
};

type Phase = 'closed' | 'entering' | 'open' | 'leaving';

export const FjsPageContainer = defineComponent({
  name: 'FjsPageContainer',
  inheritAttrs: false,
  props: {
    show: { type: Boolean, default: false },
    duration: { type: Number, default: 300 },
    zIndex: { type: Number, default: 100 },
    overlay: { type: Boolean, default: true },
    position: { type: String, default: 'bottom' },
    round: { type: Boolean, default: false },
    closeOnSlideDown: { type: Boolean, default: false },
    overlayStyle: { type: String, default: '' },
    customStyle: { type: String, default: '' },
  },
  emits: [
    'beforeEnter',
    'enter',
    'afterEnter',
    'beforeLeave',
    'leave',
    'afterLeave',
    'clickoverlay',
  ],
  setup(props, { attrs, slots, emit }) {
    const position = computed(() => {
      if (!KNOWN_POSITIONS.has(props.position)) {
        warnControlOnce(
          `page-container:position:${props.position}`,
          `<page-container> does not know position="${props.position}"; ` +
            'expected top, bottom, right or center. Falling back to bottom.',
        );
        return 'bottom';
      }
      return props.position;
    });
    const radius = computed(() =>
      props.round ? (ROUND_RADIUS[position.value] ?? '0') : '0',
    );

    const phase = ref<Phase>('closed');
    // Node exists (teleported); `open` is the transition target the CSS
    // classes key off.
    const mounted = ref(false);
    const open = ref(false);
    const panel = ref<HTMLElement | null>(null);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    onBeforeUnmount(clearTimer);

    const beginLeave = () => {
      phase.value = 'leaving';
      open.value = false;
      emit('beforeLeave');
      emit('leave');
      clearTimer();
      timer = setTimeout(settle, props.duration + 50);
    };

    const settle = () => {
      clearTimer();
      if (phase.value === 'entering') {
        phase.value = 'open';
        emit('afterEnter');
      } else if (phase.value === 'leaving') {
        phase.value = 'closed';
        mounted.value = false;
        open.value = false;
        emit('afterLeave');
      }
    };

    watch(
      () => props.show,
      (show) => {
        if (show) {
          if (phase.value !== 'closed') return;
          emit('beforeEnter');
          emit('enter');
          phase.value = 'entering';
          mounted.value = true;
          open.value = false;
          // Two frames: the "out" styles must be committed before "in"
          // flips, or the browser skips the transition entirely.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              open.value = true;
              clearTimer();
              timer = setTimeout(settle, props.duration + 50);
            }),
          );
        } else if (phase.value === 'entering' || phase.value === 'open') {
          beginLeave();
        }
      },
    );

    const onTransitionEnd = (event: TransitionEvent) => {
      // children's own transitions bubble up to the panel
      if (event.target === panel.value) settle();
    };

    // close-on-slide-down: down for bottom/center, up for top, right for
    // right; a fling in the close direction closes without the distance.
    const touch = { x: 0, y: 0, t: 0, tracking: false };
    const onTouchstart = (event: TouchEvent) => {
      touch.tracking = props.closeOnSlideDown;
      touch.x = event.touches[0].clientX;
      touch.y = event.touches[0].clientY;
      touch.t = event.timeStamp;
    };
    const onTouchend = (event: TouchEvent) => {
      if (!touch.tracking || phase.value === 'closed') return;
      touch.tracking = false;
      const sign = position.value === 'top' ? -1 : 1;
      const dx = event.changedTouches[0].clientX - touch.x;
      const dy = event.changedTouches[0].clientY - touch.y;
      const distance = position.value === 'right' ? dx : dy;
      const seconds = Math.max((event.timeStamp - touch.t) / 1000, 0.001);
      const velocity = (sign * distance) / seconds;
      if ((sign * distance >= 80 || velocity > 600) && phase.value !== 'leaving') {
        beginLeave();
      }
    };

    return () => {
      if (!mounted.value) return null;
      const host = hostAttrs(attrs);
      const pos = position.value;
      return h(
        Teleport,
        { to: 'body' },
        [
          h('div', {
            class: [
              'fjs-page-container',
              `fjs-page-container--${pos}`,
              { 'is-open': open.value },
            ],
            style: {
              '--fjs-pc-dur': `${props.duration}ms`,
              zIndex: String(props.zIndex),
            },
          }, [
            props.overlay
              ? h('div', {
                  class: 'fjs-page-container-mask',
                  style: props.overlayStyle,
                  onClick: () => emit('clickoverlay'),
                })
              : null,
            h('div', {
              ref: panel,
              class: ['fjs-page-container-panel', `fjs-page-container-panel--${pos}`],
              style: [host, { borderRadius: radius.value }, props.customStyle],
              onTransitionend: onTransitionEnd,
              onTouchstart,
              onTouchend,
            }, slots.default?.()),
          ]),
        ],
      );
    };
  },
});
