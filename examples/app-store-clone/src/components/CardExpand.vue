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
// Take-off timing mirrors HeroFly: the box is first built at `from`, and the
// move to `to` is issued from a timer one frame later. Issuing it in the same
// frame makes web skip the transition and makes Flutter's tween start at the
// final value (the "first build is the end value" trap in HeroFly's header).
import { onBeforeUnmount, ref, watch } from 'vue';
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
const emit = defineEmits<{ closed: [] }>();

const EASE = 'cubic-bezier(0.32,0.72,0,1)';

// Mounted ONCE and shown/hidden with v-show, never v-if'd away: on the App,
// unmounting a position:fixed subtree does not take it out of the overlay host
// (the full-screen modal layer stayed behind and swallowed every touch, swipe
// and the back gesture), while display:none is honoured. specs/217 tasks, T052.
const shown = ref(false);
const root = ref<unknown>(null);
const box = ref<Rect>({ left: 0, top: 0, width: 0, height: 0 });
const radius = ref(20);
const flying = ref(true);
const contentOn = ref(false);
let timers: ReturnType<typeof setTimeout>[] = [];

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
  shown.value = true;
  // one frame at `from`, then fly to the full viewport
  later(() => {
    const full = rectOf(root.value);
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

onBeforeUnmount(() => timers.forEach(clearTimeout));

function close() {
  if (flying.value) return;
  flying.value = true;
  contentOn.value = false;
  radius.value = 20;
  // fade the content first, then fly back to where the card is NOW
  later(() => {
    box.value = props.measureCard();
    later(() => {
      shown.value = false;
      emit('closed');
    }, CLOSE_MS + 20);
  }, 120);
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
  transition: `left ${FLY_MS}ms ${EASE}, top ${FLY_MS}ms ${EASE}, width ${FLY_MS}ms ${EASE}, height ${FLY_MS}ms ${EASE}`,
});
</script>

<template>
  <!-- full-viewport fixed layer; only used to measure the screen size -->
  <view v-show="shown" ref="root" class="layer">
    <view class="hero" :style="boxStyle()" />
    <scroll-view class="content" :style="{ opacity: contentOn ? 1 : 0 }">
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
</template>

<style scoped>
.layer {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
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
