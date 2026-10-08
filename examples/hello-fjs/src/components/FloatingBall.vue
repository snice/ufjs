<script setup lang="ts">
// 悬浮球 + 扇形菜单（specs/211）。作为全局组件由 createFjsApp 的
// globalComponents 挂载：全应用一份实例，跨路由状态（位置、是否展开）保留。
//
// 事件穿透：框架的全局层本身不接事件，这里的根节点也不铺背景——Flutter 侧
// 按「盒子绘制处命中」，空白处触摸落到页面；web 侧根节点显式
// pointer-events:none（子孙由全局层样式重新打开）。展开期间铺一层透明
// 遮罩用来「点空白收起」，那是组件有意拦截，仅展开时存在。
//
// 拖拽/点击全部走 touch 事件（两端同形，web 的鼠标也会合成）：位移超过
// SLOP 判拖拽，否则 touchend 当点击。松手后吸附到最近的左右边缘并露出
// 大部分球身（贴边半隐藏），y 夹在上下留白内。
import { computed, onMounted, ref } from 'vue';
import { hasNativeHost, invokeHost, type FjsTouchEvent } from 'fjs';
import { useRouter } from 'fjs/router';
import { useTheme } from '../theme';
import { rectOf } from '../hero';

const BALL = 52;
const ITEM = 44;
const RADIUS = 96;
const HIDE = BALL / 3; // 停靠时藏在屏外的部分
const SLOP = 6;
const EDGE = 12; // 展开时离屏幕边的距离
// 上下限 = 真实安全区：全局层铺满整个屏幕（含状态栏 / Home 指示条），
// 球不能越过去盖住它们，但也不替页面预留导航栏、tabBar 的位置。inset 由模板里
// 的 <safe-area> 探针量出（见 measure），不写死数值——刘海 / 灵动岛机型各不同
const MARGIN = 4;
const insetTop = ref(0);
const insetBottom = ref(0);

const router = useRouter();
const theme = useTheme();

const root = ref<unknown>(null);
const probe = ref<unknown>(null);
const probeArea = ref<unknown>(null);
const W = ref(375);
const H = ref(700);

const x = ref(0);
// null until the first drag: the resting spot is a fraction of the (measured) height
const y = ref<number | null>(null);
const side = ref<'left' | 'right'>('right');
const dragging = ref(false);
const open = ref(false);

function measure() {
  // The layer's own box is unreliable on Flutter: the global root is a
  // column that shrinks to its content, so with only absolute children its
  // height reads 0 (width stretches). The host's viewport is the layer's real
  // size there; web has the real box. Insets come from the <safe-area> probe
  // either way: an auto-height safe-area with an empty child is exactly
  // padding-top + padding-bottom tall, and the child's top is padding-top.
  if (hasNativeHost) {
    try {
      const vp = JSON.parse(invokeHost<string>('fjs.viewport.get') ?? '{}');
      if (vp.width > 0 && vp.height > 0) {
        W.value = vp.width;
        H.value = vp.height;
      }
    } catch {
      /* keep the last known size */
    }
  } else {
    const r = rectOf(root.value);
    if (r.width > 0 && r.height > 0) {
      W.value = r.width;
      H.value = r.height;
    }
  }
  const area = rectOf(probeArea.value);
  const fill = rectOf(probe.value);
  insetTop.value = Math.max(0, fill.top - area.top);
  insetBottom.value = Math.max(0, area.height - insetTop.value);
}

// native: the viewport is known synchronously, so the first render already has the real size
if (hasNativeHost) measure();

function dockX(s: 'left' | 'right') {
  return s === 'left' ? -HIDE : W.value - BALL + HIDE;
}
function clampY(v: number) {
  return Math.min(Math.max(v, insetTop.value + MARGIN), H.value - insetBottom.value - MARGIN - BALL);
}

// the layer's box can still be settling at mount (a page transition, the
// first layout pass): measure again a beat later instead of trusting one read
onMounted(() => {
  measure();
  setTimeout(measure, 120);
  setTimeout(measure, 600);
});

// 球实际位置：拖拽中跟手；展开时整球移入屏内；否则停靠
const bx = computed(() => {
  if (dragging.value) return x.value;
  if (open.value) return side.value === 'left' ? EDGE : W.value - BALL - EDGE;
  return dockX(side.value);
});
const by = computed(() => clampY(y.value ?? H.value * 0.45));

// ---- 扇形：球在左半屏向右展开，右半屏向左展开；贴上/下边时收窄圆弧避免出屏
const items = [
  { key: 'home', label: '首页', run: () => router.replace('/') },
  { key: 'api', label: '接口', run: () => router.replace('/api') },
  { key: 'back', label: '返回', run: () => router.back() },
  { key: 'theme', label: '主题', run: () => theme.toggle() },
];

const fan = computed(() => {
  const cy = by.value + BALL / 2;
  const room = RADIUS + ITEM / 2 + 8;
  const clip = (d: number) => (Math.asin(Math.min(Math.max(d / RADIUS, 0), 1)) * 180) / Math.PI;
  const lo = cy < room ? -clip(cy - ITEM / 2 - 8) : -90;
  const hi = H.value - cy < room ? clip(H.value - cy - ITEM / 2 - 8) : 90;
  const n = items.length;
  return items.map((_, i) => {
    const deg = lo + ((hi - lo) * i) / (n - 1);
    const rad = (deg * Math.PI) / 180;
    const dir = side.value === 'left' ? 1 : -1;
    return { dx: dir * RADIUS * Math.cos(rad), dy: RADIUS * Math.sin(rad) };
  });
});

// ---- 手势
let startX = 0;
let startY = 0;
let originX = 0;
let originY = 0;
let moved = false;

function onStart(e: FjsTouchEvent) {
  measure();
  const t = e.changedTouches[0];
  startX = t.clientX;
  startY = t.clientY;
  originX = bx.value;
  originY = by.value;
  moved = false;
}

function onMove(e: FjsTouchEvent) {
  const t = e.changedTouches[0];
  const dx = t.clientX - startX;
  const dy = t.clientY - startY;
  if (!moved && Math.hypot(dx, dy) < SLOP) return;
  if (!moved) {
    moved = true;
    open.value = false;
    dragging.value = true;
  }
  x.value = originX + dx;
  y.value = clampY(originY + dy);
}

function onEnd() {
  if (moved) {
    side.value = x.value + BALL / 2 < W.value / 2 ? 'left' : 'right';
    // 先让 transition 生效（dragging 在下一帧才关），球从手指处滑向边缘
    x.value = dockX(side.value);
    dragging.value = false;
    return;
  }
  open.value = !open.value;
}

function pick(run: () => void) {
  open.value = false;
  run();
}

// Flutter: explicit px size. The layer has no in-flow content so `100%` lays
// out at height 0 there; a real box keeps children inside their parent (the
// normal hit walk) and lets the component measure its coordinate space.
const rootStyle = computed(() =>
  hasNativeHost ? { width: W.value + 'px', height: H.value + 'px' } : { pointerEvents: 'none' },
);
const probeStyle = hasNativeHost ? undefined : { pointerEvents: 'none' };
</script>

<template>
  <view ref="root" class="gb" :style="rootStyle">
    <!-- 安全区探针：不画、不接事件，只用来量 inset -->
    <safe-area ref="probeArea" class="probe" edges="top bottom" :style="probeStyle">
      <view ref="probe" class="probe-fill" />
    </safe-area>

    <!-- 展开时的透明遮罩：点空白收起（有意拦截，只在展开期间存在） -->
    <!-- always the first child, shown with display: a v-if mask is inserted
         later and (on Flutter) landed above its siblings, eating the taps meant
         for the fan items -->
    <view
      class="mask"
      :style="{ width: W + 'px', height: H + 'px', display: open ? 'flex' : 'none' }"
      @tap="open = false"
    />

    <view
      v-for="(item, i) in items"
      :key="item.key"
      class="item"
      :class="{ open, still: dragging }"
      :style="{
        // positioned with left/top, NOT translate: on Flutter a transform
        // moves the paint only, hit-testing stays at the layout box — a
        // translated item would be tappable at the ball, not where it shows
        left: bx + BALL / 2 - ITEM / 2 + (open ? fan[i].dx : 0) + 'px',
        top: by + BALL / 2 - ITEM / 2 + (open ? fan[i].dy : 0) + 'px',
        transform: open ? 'scale(1)' : 'scale(0.3)',
      }"
      @tap="() => pick(item.run)"
    >
      <icon-mind v-if="item.key === 'home'" name="home" :size="22" color="#ffffff" />
      <icon-mind v-else-if="item.key === 'api'" name="api" :size="22" color="#ffffff" />
      <icon-mind v-else-if="item.key === 'back'" name="undo" :size="22" color="#ffffff" />
      <icon-mind v-else name="moon" :size="22" color="#ffffff" />
    </view>

    <view
      class="ball"
      :class="{ still: dragging, open }"
      :style="{ left: bx + 'px', top: by + 'px' }"
      @touchstart="onStart"
      @touchmove="onMove"
      @touchend="onEnd"
      @touchcancel="onEnd"
    >
      <icon-mind v-if="open" name="close" :size="24" color="#ffffff" />
      <icon-mind v-else name="menu" :size="24" color="#ffffff" />
    </view>
  </view>
</template>

<style scoped>
.gb {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.probe {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
}
.probe-fill {
  height: 0;
}
/* size comes from the template (W×H): inset-only collapses to height 0 on Flutter */
.mask {
  position: absolute;
  left: 0;
  top: 0;
  /* explicit stacking among the absolute siblings (mask < items < ball): on
     Flutter the toggled mask otherwise ended up above the fan items and ate
     their taps */
  z-index: 1;
  background-color: rgba(0, 0, 0, 0.18);
}
.ball {
  position: absolute;
  z-index: 3;
  width: 52px;
  height: 52px;
  border-radius: 26px;
  align-items: center;
  justify-content: center;
  background-color: #007aff;
  box-shadow: 0 6px 18px rgba(0, 122, 255, 0.4);
  touch-action: none;
  transition: left 0.25s ease-out, top 0.25s ease-out;
}
.item {
  position: absolute;
  z-index: 2;
  width: 44px;
  height: 44px;
  border-radius: 22px;
  align-items: center;
  justify-content: center;
  background-color: #34c759;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  opacity: 0;
  transition: transform 0.28s ease-out, opacity 0.2s ease-out, left 0.25s ease-out, top 0.25s ease-out;
  /* collapsed items sit under the ball (scale .3, opacity 0); no
     pointer-events toggle — Flutter only honours a static "none" */
}
.item.open {
  opacity: 1;
}
.ball.still,
.item.still {
  transition: none;
}
</style>
