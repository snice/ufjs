<route>
{"title": "Anime.js", "group": "动画演示", "desc": "stagger / 时间轴 / 缓动，动的是普通对象"}
</route>

<script setup lang="ts">
// Anime.js v4 on both hosts, one source (spec 031).
//
// The target is never a node: on the app a template ref is not a DOM
// element, so Anime.js's CSS / transform channels have nothing to write to.
// A plain reactive object is a target both hosts can hand over — Anime.js
// tweens it through its OBJECT path (`target[prop] = value`), and Vue folds
// every write of a tick into one setProps per node. Positions and scales
// stay on `transform`, so nothing reflows while it plays.
//
// The polyfill must come first: on the app Anime.js looks for `setImmediate`
// while its module evaluates (see src/adapters/anime/native-polyfills.ts).
import '@/adapters/anime/native-polyfills';
import { onBeforeUnmount, reactive, ref, onMounted } from 'vue';
// import { onPageSettled } from 'fjs/router';
import {
  animate,
  spring,
  createTimeline,
  stagger,
  utils,
  type JSAnimation,
  type Timeline,
} from 'animejs';
import Panel from '@/components/Panel.vue';

/** Everything started here, reverted on unmount — the app has no
 *  `visibilitychange`, so the engine would keep ticking a page that's gone. */
const running: (JSAnimation | Timeline)[] = [];

function keep<T extends JSAnimation | Timeline>(instance: T): T {
  running.push(instance);
  return instance;
}

// ── stagger grid ─────────────────────────────────────────────────────────

const GRID = 5;
const DOT_COLORS = ['#007aff', '#07c160', '#fa9d3b', '#fa5151', '#8e5cf7'];

const dots = Array.from({ length: GRID * GRID }, (_, i) =>
  reactive({ id: i, scale: 1, rotate: 0, y: 0, color: DOT_COLORS[(i % GRID + Math.floor(i / GRID)) % DOT_COLORS.length] }),
);

type StaggerFrom = 'center' | 'first' | 'last' | 'random';
const staggerFrom = ref<StaggerFrom>('center');
let gridAnim: JSAnimation | null = null;

function playGrid(): void {
  gridAnim?.revert();
  gridAnim = keep(
    animate(dots, {
      scale: { from: 1, to: 0.25 },
      rotate: { from: 0, to: 180 },
      y: { from: 0, to: -6 },
      ease: 'inOutSine',
      duration: 700,
      delay: stagger(70, { grid: [GRID, GRID], from: staggerFrom.value }),
      alternate: true,
      loop: true,
    }),
  );
}

function setFrom(from: StaggerFrom): void {
  staggerFrom.value = from;
  playGrid();
}

function dotStyle(dot: (typeof dots)[number]) {
  return {
    backgroundColor: dot.color,
    transform: `translateY(${dot.y}px) scale(${dot.scale}) rotate(${dot.rotate}deg)`,
  };
}

// ── timeline + playback ──────────────────────────────────────────────────

const boxes = ['A', 'B', 'C'].map((label, i) =>
  reactive({ label, x: -60, rotate: -90, opacity: 0, color: DOT_COLORS[i] }),
);
const bar = reactive({ width: 0 });
const progress = ref(0);
const paused = ref(true);
let tl: Timeline | null = null;

function buildTimeline(): void {
  tl = keep(
    createTimeline({
      autoplay: false,
      defaults: { duration: 600, ease: 'outBack' },
      // There is no onPlay callback: the play-side transitions happen in
      // toggle / reverse / restart below, which set `paused` themselves.
      onUpdate: (self) => (progress.value = self.progress),
      onPause: () => (paused.value = true),
      onComplete: () => (paused.value = true),
    })
      .add(boxes, { x: 0, rotate: 0, opacity: 1, delay: stagger(120) })
      .add(bar, { width: 100, duration: 800, ease: 'inOutQuad' }, '-=300')
      .add(boxes, { rotate: 360, duration: 500, delay: stagger(80, { from: 'last' }) }),
  );
}

function toggle(): void {
  if (!tl) return;
  if (tl.paused) {
    // Finished forward or rewound to 0 backwards: start over instead of
    // sitting at the end.
    if ((tl.progress >= 1 && !tl.reversed) || (tl.progress <= 0 && tl.reversed)) tl.restart();
    else tl.play();
    paused.value = false;
  } else {
    tl.pause();
  }
}

function reverse(): void {
  if (!tl) return;
  tl.reverse();
  paused.value = false;
}

function restart(): void {
  if (!tl) return;
  tl.restart();
  paused.value = false;
}

function seek(value: string): void {
  if (!tl) return;
  tl.pause();
  tl.seek((tl.duration * Number(value)) / 100);
  progress.value = tl.progress;
}

function boxStyle(box: (typeof boxes)[number]) {
  return {
    backgroundColor: box.color,
    opacity: box.opacity,
    transform: `translateX(${box.x}px) rotate(${box.rotate}deg)`,
  };
}

// ── easing lanes + counter ───────────────────────────────────────────────

/** Fixed lane length: transform takes px, and a phone card is ~320 wide. */
const LANE = 220;
const BALL = 20;

const lanes = [
  { name: 'linear', ease: 'linear' as const },
  { name: 'outExpo', ease: 'outExpo' as const },
  { name: 'inOutBack', ease: 'inOutBack' as const },
  { name: 'outElastic', ease: 'outElastic(1, .5)' as const },
  { name: 'spring', ease: spring({ stiffness: 120, damping: 8 }) },
].map((lane) => ({ ...lane, ball: reactive({ p: 0 }) }));

const counter = reactive({ value: 0 });
let forward = true;

function runLanes(): void {
  const to = forward ? 1 : 0;
  forward = !forward;
  for (const lane of lanes) {
    keep(animate(lane.ball, { p: to, duration: 1200, ease: lane.ease }));
  }
  keep(
    animate(counter, {
      value: to ? 98765 : 0,
      duration: 1200,
      ease: 'outExpo',
      modifier: utils.round(0),
    }),
  );
}

function ballStyle(ball: { p: number }) {
  return { transform: `translateX(${ball.p * (LANE - BALL)}px)` };
}

// Heavy-ish per-frame work shouldn't fight the route transition (spec 027):
// the first frame paints the resting state, animations start once it settles.
// onPageSettled(() => {
onMounted(() => {
  playGrid();
  buildTimeline();
  tl?.play();
  paused.value = false;
  runLanes();
});

onBeforeUnmount(() => {
  for (const instance of running) instance.revert();
  running.length = 0;
});
</script>

<template>
  <view>
    <Panel title="stagger 网格" :desc="`25 个圆点，按 grid 从 ${staggerFrom} 起波`">
      <view class="grid-wrap">
        <view class="grid">
          <view v-for="dot in dots" :key="dot.id" class="dot" :style="dotStyle(dot)" />
        </view>
      </view>
      <view class="row">
        <button
          v-for="from in (['center', 'first', 'last', 'random'] as const)"
          :key="from"
          size="mini"
          :type="staggerFrom === from ? 'primary' : 'default'"
          @tap="setFrom(from)"
        >
          {{ from }}
        </button>
      </view>
    </Panel>

    <Panel title="时间轴" :desc="`三段编排 · 进度 ${Math.round(progress * 100)}%`">
      <view class="stage">
        <view v-for="box in boxes" :key="box.label" class="box" :style="boxStyle(box)">
          <text class="box-label">{{ box.label }}</text>
        </view>
      </view>
      <view class="track">
        <view class="track-fill" :style="{ width: `${bar.width}%` }" />
      </view>
      <slider :value="Math.round(progress * 100)" :min="0" :max="100" @change="seek" />
      <view class="row">
        <button size="mini" type="primary" @tap="toggle()">{{ paused ? '播放' : '暂停' }}</button>
        <button size="mini" @tap="reverse()">反向</button>
        <button size="mini" @tap="restart()">重播</button>
      </view>
    </Panel>

    <Panel title="缓动对比" desc="同一段位移，五种 ease；数字用 utils.round(0) 取整">
      <view v-for="lane in lanes" :key="lane.name" class="lane-row">
        <text class="lane-name">{{ lane.name }}</text>
        <view class="lane">
          <view class="ball" :style="ballStyle(lane.ball)" />
        </view>
      </view>
      <text class="counter">{{ counter.value }}</text>
      <button size="mini" type="primary" @tap="runLanes()">再跑一次</button>
    </Panel>
  </view>
</template>

<style scoped>
/* No align-self here: a row parent is how a fixed-size child gets centred */
.grid-wrap {
  flex-direction: row;
  justify-content: center;
}
.grid {
  flex-direction: row;
  flex-wrap: wrap;
  width: 200px;
  height: 200px;
}
.dot {
  width: 24px;
  height: 24px;
  margin: 8px;
  border-radius: 12px;
}
.row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}
.stage {
  flex-direction: row;
  justify-content: center;
  gap: 16px;
  height: 64px;
  align-items: center;
}
.box {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  align-items: center;
  justify-content: center;
}
.box-label {
  color: #ffffff;
  font-size: 18px;
  font-weight: 700;
}
.track {
  height: 6px;
  border-radius: 3px;
  background-color: var(--fjs-border);
  overflow: hidden;
}
.track-fill {
  height: 6px;
  background-color: var(--fjs-success);
}
.lane-row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.lane-name {
  width: 76px;
  font-size: 12px;
  color: var(--fjs-muted);
}
.lane {
  position: relative;
  width: 220px;
  height: 20px;
  border-radius: 10px;
  background-color: var(--fjs-border);
}
.ball {
  position: absolute;
  left: 0;
  top: 0;
  width: 20px;
  height: 20px;
  border-radius: 10px;
  background-color: var(--fjs-primary);
}
.counter {
  font-size: 28px;
  font-weight: 700;
  color: var(--fjs-title);
  text-align: center;
}
</style>
