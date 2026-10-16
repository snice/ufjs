<script setup lang="ts">
// Story card → full-screen story, as a shared-element flight on the same page
// (specs/217 plan §3; geometry trick from hello-fjs HeroFly, specs/101).
//
// Why a gradient box and not an <image>: the artwork here is a gradient. The
// box flies from the card's measured rect to the full viewport; the story's
// text fades in on top once it has landed, and fades out before it flies back.
//
// Why left/top/width/height (and not transform): the aspect ratio changes
// (card → screen), and translate+scale would stretch the content; inset and
// size transitions are the two-target supported pair (css-compat `transition`).
//
// Corner radius is NOT animated: border-radius is not in the App-side
// transition list. It stays 20px during the flight and snaps to 0 once the box
// covers the screen (the screen edge clips it, so the snap is invisible).
//
// Drag to dismiss (specs/218, 221; modelled on screen recordings of the real App
// Store): with the story scrolled to the top, pulling down shrinks the WHOLE page
// (cover + text + close button) about the screen centre — it does not follow the
// finger sideways — and rounds its corners, while the page behind is gaussian-
// blurred (`filter: blur()` on that page, specs/222; this component only reports
// how much, via `blur`) and dimmed. Shrunk to CLOSE_SCALE it closes by itself,
// finger still down. That is why hero, content and the close
// button live inside one `.pose` box: a single transform + radius moves them
// together. On release past a threshold the pose is converted into the hero's
// equivalent rect and the existing geometry flight takes over (see finishDrag).
//
// Take-off timing mirrors HeroFly: the box is first built at `from`, and the
// move to `to` is issued from a timer one frame later. Issuing it in the same
// frame makes web skip the transition and makes Flutter's tween start at the
// final value (the "first build is the end value" trap in HeroFly's header).
import { onBeforeUnmount, ref, watch } from 'vue';
import { nowMs, type FjsTouchEvent } from 'fjs';
import { CLOSE_MS, FLY_MS, rectOf, type Rect } from '../hero';
import { appsOf } from '../data/apps';
import type { Story } from '../data/stories';
import AppRow from './AppRow.vue';
import GlassCircleButton from './GlassCircleButton.vue';

const props = defineProps<{
  story: Story;
  /** non-null while this story should be open; carries the card's rect at tap time */
  request: { from: Rect } | null;
  /** re-measure the origin card: it is still mounted, so this is reliable */
  measureCard: () => Rect;
}>();
const emit = defineEmits<{
  closed: [];
  /** px of gaussian blur the page behind should carry right now (0: none) */
  blur: [px: number];
}>();

const EASE = 'cubic-bezier(0.32,0.72,0,1)';

// Mounted ONCE and shown/hidden with v-show: opening again then reuses the
// layer instead of rebuilding it. (Until specs/220 this was also a workaround:
// the root of this component is a Fragment — the template starts with a comment
// in dev builds — and unmounting a Fragment leaked its hoisted `position: fixed`
// layer into the overlay host, where a mask-shaped box swallowed every touch.
// That is fixed in the runtime; v-if works too.)
const shown = ref(false);
const root = ref<unknown>(null);
const box = ref<Rect>({ left: 0, top: 0, width: 0, height: 0 });
const radius = ref(20);
const flying = ref(true);
const contentOn = ref(false);
let timers: ReturnType<typeof setTimeout>[] = [];

// Drag-to-dismiss tuning, read off the recordings: the page shrank about the
// centre with ~25-30px corners, the page behind went soft and grey, and at about
// 0.85x it flew back on its own.
const PULL_RANGE = 0.4; // pull distance (x viewport height) that reaches full progress
const MIN_SCALE = 0.7; // 1 - 0.3 at full progress
const CLOSE_SCALE = 0.85; // shrunk this far the story closes by itself
const MAX_RADIUS = 28;
const MAX_BLUR = 20; // px of gaussian blur on the page behind at full progress
const MAX_DIM = 0.35; // black tint alpha on it
const CLOSE_SPEED = 0.7; // released faster than this (px/ms) before the threshold closes
const START_DOWN = 10; // px of downward travel before a pull is recognised
const ABORT_UP = 6; // px of upward travel that hands the gesture back to scrolling
const SPRING = '0.3s cubic-bezier(0.32,0.72,0,1)';

type DragPhase = 'idle' | 'armed' | 'dragging' | 'settling';
const phase = ref<DragPhase>('idle');
// the page's pose while it is pulled: scale about the centre + corner radius
const pose = ref({ scale: 1, radius: 0 });
// The page behind: how soft and how dark. Dark is a plain black layer under the
// pose; soft is the parent's `filter: blur()`, reported through `blur`.
const backdrop = ref({ blur: 0, dim: 0 });
watch(
  () => backdrop.value.blur,
  (px) => emit('blur', px),
);
let fade: ReturnType<typeof setInterval> | undefined;
// true while a release animation (spring back) wants the transform to transition
const springing = ref(false);
// true for the one frame in which the hero is swapped in for the pose
const instant = ref(false);
let viewport: Rect = { left: 0, top: 0, width: 0, height: 0 };
let scrollTop = 0;
// While the story rests at the top it declares `touch-action: pan-up` — see the
// note on `.content` below. Off the top it is `auto` and the scroll-view alone
// handles every drag.
const atTop = ref(true);
// bumped on every open: remounting the scroll-view puts it back at the top
const openCount = ref(0);
let startX = 0;
let startY = 0;
let lastY = 0;
let lastT = 0;
let speed = 0; // px/ms, positive = downward

function later(fn: () => void, ms: number) {
  timers.push(setTimeout(fn, ms));
}

function open(from: Rect) {
  timers.forEach(clearTimeout);
  timers = [];
  box.value = { ...from };
  radius.value = 20;
  flying.value = true;
  contentOn.value = false;
  resetPose();
  scrollTop = 0;
  atTop.value = true;
  openCount.value += 1;
  shown.value = true;
  // one frame at `from`, then fly to the full viewport
  later(() => {
    const full = rectOf(root.value);
    viewport = full;
    box.value = { left: 0, top: 0, width: full.width, height: full.height };
    later(() => {
      radius.value = 0;
      flying.value = false;
      contentOn.value = true;
    }, FLY_MS + 20);
  }, 40);
}

watch(
  () => props.request,
  (req) => {
    if (req) open(req.from);
  },
);

onBeforeUnmount(() => {
  timers.forEach(clearTimeout);
  if (fade) clearInterval(fade);
});

function resetPose() {
  phase.value = 'idle';
  springing.value = false;
  instant.value = false;
  pose.value = { scale: 1, radius: 0 };
  if (fade) clearInterval(fade);
  backdrop.value = { blur: 0, dim: 0 };
}

/** Takes the blur and dim on the page behind down to nothing over [ms]. Stepped
 * from JS: `filter` does not interpolate on the App (specs/222). */
function fadeBackdrop(ms: number) {
  if (fade) clearInterval(fade);
  const from = backdrop.value;
  const t0 = nowMs();
  fade = setInterval(() => {
    const k = Math.min(1, (nowMs() - t0) / ms);
    backdrop.value = { blur: from.blur * (1 - k), dim: from.dim * (1 - k) };
    if (k >= 1 && fade) clearInterval(fade);
  }, 40);
}

/** Fly the hero back onto the card and hide the layer. Shared by the ✕ button and
 * the drag release (each does its own content fade-out first). */
function flyBack() {
  box.value = props.measureCard();
  radius.value = 20;
  // the page behind clears as the card lands
  if (backdrop.value.blur > 0) fadeBackdrop(CLOSE_MS);
  later(() => {
    shown.value = false;
    resetPose();
    emit('closed');
  }, CLOSE_MS + 20);
}

function close() {
  if (flying.value || phase.value !== 'idle') return;
  flying.value = true;
  contentOn.value = false;
  radius.value = 20;
  // fade the content first, then fly back to where the card is NOW
  later(flyBack, 120);
}

// ---- drag to dismiss ---------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function onScroll(payload: string) {
  // payload is the six-field JSON string (docs/ui-api.md `@scroll`)
  try {
    scrollTop = (JSON.parse(payload) as { scrollTop: number }).scrollTop;
  } catch {
    scrollTop = 0;
  }
  atTop.value = scrollTop <= 0.5;
}

function onTouchStart(e: FjsTouchEvent) {
  if (!contentOn.value || flying.value || phase.value !== 'idle') return;
  if (e.touches.length > 1) return;
  const t = e.changedTouches[0];
  if (!t) return;
  // only a story resting at the top can be pulled; anywhere else it is a scroll
  if (scrollTop > 0.5) return;
  phase.value = 'armed';
  startX = t.clientX;
  startY = t.clientY;
  lastY = t.clientY;
  lastT = e.timeStamp;
  speed = 0;
}

function onTouchMove(e: FjsTouchEvent) {
  if (phase.value !== 'armed' && phase.value !== 'dragging') return;
  const t = e.changedTouches[0];
  if (!t) return;
  const dt = e.timeStamp - lastT;
  if (dt > 0) speed = (t.clientY - lastY) / dt;
  lastY = t.clientY;
  lastT = e.timeStamp;

  if (phase.value === 'armed') {
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (dy < -ABORT_UP) {
      // going up: that is a scroll. `pan-up` left it to the scroll-view, which
      // scrolls natively (momentum included); nothing for us to do.
      phase.value = 'idle';
      return;
    }
    if (dy > START_DOWN && dy > Math.abs(dx)) {
      phase.value = 'dragging';
      // re-base so the page does not jump by the recognition distance
      startX = t.clientX;
      startY = t.clientY;
    }
    return;
  }

  // locked to the centre: only the pull distance counts, never where the finger is
  const dy = t.clientY - startY;
  const p = clamp01(Math.max(dy, 0) / (viewport.height * PULL_RANGE));
  const scale = 1 - (1 - MIN_SCALE) * p;
  pose.value = { scale, radius: MAX_RADIUS * p };
  backdrop.value = { blur: MAX_BLUR * p, dim: MAX_DIM * p };
  // shrunk far enough: go, without waiting for the finger to lift
  if (scale <= CLOSE_SCALE) finishDrag();
}

function onTouchEnd(e: FjsTouchEvent) {
  if (phase.value === 'armed') {
    phase.value = 'idle';
    return;
  }
  if (phase.value !== 'dragging') return;
  const cancelled = e.type === 'touchcancel';
  if (!cancelled && speed > CLOSE_SPEED) finishDrag();
  else springBack();
}

function springBack() {
  phase.value = 'settling';
  springing.value = true;
  pose.value = { scale: 1, radius: pose.value.radius };
  fadeBackdrop(300);
  // corner radius is not in the App-side transition list, so it is set directly
  // once the transform has landed (the screen edge clips it by then anyway)
  later(() => resetPose(), 320);
}

/** Release past the threshold. The pose is a transform but the flight back is a
 * geometry transition (left/top/width/height), and the two cannot interpolate
 * together, so: fade the content, then swap the transformed page for a hero box
 * covering exactly the same rect (no transition for that one frame, same corner
 * radius), and let the existing flight carry it to the card. */
function finishDrag() {
  if (phase.value === 'settling') return;
  phase.value = 'settling';
  flying.value = true;
  contentOn.value = false;
  later(() => {
    const { scale, radius: r } = pose.value;
    const w = viewport.width * scale;
    const h = viewport.height * scale;
    instant.value = true;
    box.value = {
      left: (viewport.width - w) / 2,
      top: (viewport.height - h) / 2,
      width: w,
      height: h,
    };
    radius.value = r * scale;
    // the page is gone (content faded), the hero stands in at the same rect
    pose.value = { scale: 1, radius: 0 };
    later(() => {
      instant.value = false;
      flyBack();
    }, 40);
  }, 130);
}

const apps = appsOf(props.story.appIds);
const boxStyle = () => ({
  // absolute INSIDE the fixed .layer, not fixed itself: on the App every
  // position:fixed box is hoisted to the overlay host on its own (overlay-host.md),
  // so a fixed hero would be lifted out and paint over its sibling content layer
  position: 'absolute',
  left: `${box.value.left}px`,
  top: `${box.value.top}px`,
  width: `${box.value.width}px`,
  height: `${box.value.height}px`,
  borderRadius: `${radius.value}px`,
  background: props.story.gradient,
  transition: instant.value
    ? 'none'
    : `left ${FLY_MS}ms ${EASE}, top ${FLY_MS}ms ${EASE}, width ${FLY_MS}ms ${EASE}, height ${FLY_MS}ms ${EASE}`,
});

const poseStyle = () => ({
  transform: `scale(${pose.value.scale})`,
  borderRadius: `${pose.value.radius}px`,
  // no transition while the finger is down: the page must track it exactly
  transition: springing.value ? `transform ${SPRING}` : 'none',
});

</script>

<template>
  <!-- full-viewport fixed layer; only used to measure the screen size -->
  <view v-show="shown" ref="root" class="layer">
    <view class="dim" :style="{ backgroundColor: `rgba(0,0,0,${backdrop.dim})` }" />
    <view class="pose" :style="poseStyle()">
      <view class="hero" :style="boxStyle()" />
      <!-- touch-action: at the top the story declares `pan-up`: an upward swipe stays
           the scroll-view's (native scroll with momentum) and a downward pull is
           ours. Without a claim the scroll-view wins the gesture arena as soon as the
           finger travels 18px and the page gets `touchcancel` (flutter_fjs
           render/touch.dart), so a pull could never be followed. Off the top it is
           `auto`. (specs/219; specs/218 had to claim every vertical drag with pan-x
           and scroll the first upward swipe by hand.) -->
      <scroll-view
        :key="openCount"
        class="content"
        :style="{ opacity: contentOn ? 1 : 0, touchAction: atTop ? 'pan-up' : 'auto' }"
        :bounces="false"
        @scroll="onScroll"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <view class="top">
          <text class="emoji">{{ story.emoji }}</text>
          <text class="kicker">{{ story.kicker }}</text>
          <text class="title">{{ story.title }}</text>
          <text class="sub">{{ story.subtitle }}</text>
        </view>
        <view class="sheet">
          <text class="body">{{ story.body }}</text>
          <view class="rows">
            <AppRow v-for="(a, i) in apps" :key="a.id" :app="a" :divider="i < apps.length - 1" />
          </view>
          <view class="gap" />
        </view>
      </scroll-view>
      <view class="close" :style="{ opacity: contentOn ? 1 : 0 }">
        <safe-area edges="top">
          <view class="close-pad">
            <GlassCircleButton icon="close" @tap="close" />
          </view>
        </safe-area>
      </view>
    </view>
  </view>
</template>

<style scoped>
.layer {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
}
.dim {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
}
.pose {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  /* a mouse drag on web would otherwise select the story text */
  user-select: none;
}
.content {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  transition: opacity 0.2s;
}
.top {
  min-height: 470px;
  padding: 120px 20px 24px;
  justify-content: flex-end;
}
.emoji {
  font-size: 110px;
  text-align: center;
  margin-bottom: 24px;
}
.kicker {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
}
.title {
  margin-top: 4px;
  font-size: 30px;
  font-weight: 800;
  color: #ffffff;
}
.sub {
  margin-top: 6px;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.85);
}
.sheet {
  background-color: #ffffff;
  border-radius: 20px 20px 0 0;
  padding: 24px 20px 0;
  min-height: 500px;
}
.body {
  font-size: 17px;
  line-height: 26px;
  color: #1c1c1e;
}
.rows {
  margin-top: 20px;
}
.gap {
  height: 40px;
}
.close {
  position: absolute;
  top: 0;
  right: 0;
  transition: opacity 0.2s;
}
.close-pad {
  padding: 10px 16px 0 0;
  align-items: flex-end;
}
</style>
