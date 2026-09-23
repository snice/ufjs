<route>
{"title": "共享元素", "group": "动画演示", "desc": "缩略图放大成大图：同页面展开 / 跨页面飞入，一份代码两端同源"}
</route>

<script setup lang="ts">
// 共享元素（hero）动画示例，两个场景（spec 101）：
//
// 1. 同页面：点缩略图 → 飞行盒从槽位放大到中央大图（gif 参照：展开时
//    背景就是干净的页面，没有遮罩），✕ / 大图任意一处按下收回，
//    飞回原位后真身重新出现。
// 2. 跨页面：push 详情页，飞行盒从列表槽位飞进详情页的大图位置；
//    详情页的 ✕ 飞回槽位后再 back()。手势 / 浏览器后退不飞（JS 收不到
//    pop 起点信号），底层真身全程可见，淡出后自然对位——两端一致的降级。
//
// 全部由既有原语拼成：getBoundingClientRect 测距、position: fixed 进
// overlay 宿主（App 端不随滚动、盖住 NavBar）、几何 transition 两端同一份
// 补间。没有协议变更、没有 Dart 代码（宪法 VII）。
//
// 状态机 closed → opening → open → closing → closed 单向推进：飞行未落地
// 时的连点直接忽略，盒子 / 真身 opacity 两者不会错位。
//
// 关于「白幕」：gif 原片里展开时背景就是干净的页面底色，没有遮罩——
// 示例照做，不再叠白幕。曾经试过一版全屏 fixed 白幕，App 端挂载 ✓、
// rect 全屏 ✓，但底色任何写法（类+var / 内联+字面量 / <Transition>）
// 都画不出来，未根因，登记在 spec 101 §7；页面普通树里的 var() 不受
// 影响，照常用。
//
// 进 overlay 宿主的 ✕ 的颜色走 useTheme() 字面量而非 var()，与白幕
// 同一条存疑路径上求稳。
import { computed, ref } from 'vue';
import { useRouter } from 'fjs/router';
import HeroFly from '@/components/HeroFly.vue';
import Panel from '@/components/Panel.vue';
import { useTheme } from '@/theme';
import { FLY_MS, heroHidden, rectOf, rememberSource, type Rect } from '@/hero';

const router = useRouter();
const { palette } = useTheme();

const ITEMS = [
  '/images/test-square.png',
  '/images/test-portrait.png',
  '/images/test-landscape.png',
  '/images/test-alpha.png',
];
const idOf = (src: string) => `se:${src}`;

// 模板函数 ref：web 给组件实例、App 给元素，rectOf 两种都吃。两个场景
// 各持一张表——同场景网格与跨场景网格是两份 DOM，不能混一个 key。
const pageEl = ref<unknown>(null);
const openThumbs = new Map<string, unknown>();
const crossThumbs = new Map<string, unknown>();
const setOpenThumb = (src: string, el: unknown) => {
  if (el) openThumbs.set(src, el);
  else openThumbs.delete(src);
};
const setCrossThumb = (src: string, el: unknown) => {
  if (el) crossThumbs.set(src, el);
  else crossThumbs.delete(src);
};

// ── 场景 1：同页面展开 ────────────────────────────────────────────────
type Phase = 'closed' | 'opening' | 'open' | 'closing';
const phase = ref<Phase>('closed');
const hiddenSrc = ref(''); // 飞行中藏起来的缩略图（几何不动，只压 opacity）
const openSrc = ref('');const closeAt = ref<Rect | null>(null); // ✕ 的固定位：大图左上角、往上一格
const flight = ref<{ from: Rect; to: Rect; key: number } | null>(null);
let flySeq = 0;

function open(src: string) {
  if (phase.value !== 'closed') return;
  const from = rectOf(openThumbs.get(src));
  const page = rectOf(pageEl.value);
  if (!from.width || !page.width) return;
  const side = Math.min(page.width - 40, 260);
  const to: Rect = {
    left: page.left + (page.width - side) / 2,
    // 不低于 148：iOS 状态栏+导航栏约 91，✕ 还要再往上 44，
    // 这样 ✕ 永远落在导航栏之下、页面之上（页面滚动过也一样）
    top: Math.max(page.top + 100, 148),
    width: side,
    height: side,
  };
  phase.value = 'opening';
  openSrc.value = src;
  hiddenSrc.value = src;
  closeAt.value = { left: to.left, top: to.top - 44, width: 40, height: 36 };
  flight.value = { from, to, key: ++flySeq };
}

function close() {
  if (phase.value !== 'open') return; // 起飞中 / 已收起的点击一律忽略
  const from = flight.value!.to;
  // 收回时重测槽位：展开期间若滚动漏进来，槽位的视口坐标已经变了，
  // 用 push 前的旧数字会飞偏（同页面拿得到元素，就永远测新鲜的）
  const to = rectOf(openThumbs.get(openSrc.value));
  if (!to.width) {
    finishClose();
    return;
  }
  phase.value = 'closing';
  closeAt.value = null; // ✕ 立刻撤（v-if 卸掉）
  flight.value = { from, to, key: ++flySeq };
}

function onFlyDone() {
  if (phase.value === 'opening') phase.value = 'open';
  else if (phase.value === 'closing') finishClose();
}

function finishClose() {
  phase.value = 'closed';
  flight.value = null;
  hiddenSrc.value = '';
  openSrc.value = '';
  closeAt.value = null;
}

// ✕ 是 fixed 盒：位置在展开那一刻一次算好，之后不动。
// 颜色走 useTheme() 字面量（见头注释里宿主子树 var() 的存疑路径）
const closeStyle = computed(() => {
  const r = closeAt.value;
  if (!r) return {};
  return {
    position: 'fixed',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    backgroundColor: palette.value.card,
    borderColor: palette.value.border,
  };
});

// ── 场景 2：跨页面 ────────────────────────────────────────────────────
function go(src: string) {
  // 起点槽位 push 前登记：页面被压栈后不会滚动，这张矩形回飞时仍有效
  rememberSource(idOf(src), rectOf(crossThumbs.get(src)));
  router.push({ path: '/example/animation/shared-element-detail', query: { src } });
}

function crossHidden(src: string) {
  return heroHidden(idOf(src)).value;
}
</script>

<template>
  <view class="page" ref="pageEl">
    <Panel
      title="同页面"
      desc="点缩略图放大，✕ / 大图收回。飞行盒是 position: fixed——App 端被提进页面的 overlay 宿主，不随页面滚动"
    >
      <view class="grid">
        <view
          v-for="s in ITEMS"
          :key="s"
          :ref="(el: unknown) => setOpenThumb(s, el)"
          class="thumb"
          :style="{ opacity: hiddenSrc === s ? 0 : 1 }"
          @tap="open(s)"
        >
          <image class="thumb-img" :src="s" mode="aspectFill" />
        </view>
      </view>
    </Panel>

    <Panel
      title="跨页面"
      desc="push 详情页时从槽位飞入，✕ 飞回后返回。手势 / 浏览器后退不飞（JS 收不到 pop 起点），真身原位淡出落位"
    >
      <view class="grid">
        <view
          v-for="s in ITEMS"
          :key="s"
          :ref="(el: unknown) => setCrossThumb(s, el)"
          class="thumb"
          :style="{ opacity: crossHidden(s) ? 0 : 1 }"
          @tap="go(s)"
        >
          <image class="thumb-img" :src="s" mode="aspectFill" />
        </view>
      </view>
    </Panel>

    <!-- 展开态两件套。顺序即层级：飞行盒 → ✕，后挂的盖前面的 -->
    <HeroFly
      v-if="flight"
      :key="flight.key"
      :src="openSrc"
      :from="flight.from"
      :to="flight.to"
      :duration="FLY_MS"
      @done="onFlyDone"
      @tap="close"
    />
    <view v-if="closeAt" class="close" :style="closeStyle" @tap="close">
      <text class="close-label" :style="{ color: palette.title }">✕</text>
    </view>
  </view>
</template>

<style scoped>
.page {
  padding-bottom: 24px;
}
.grid {
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}
.thumb {
  width: 150px;
  height: 150px;
  border-radius: 10px;
  overflow: hidden;
}
.thumb-img {
  width: 100%;
  height: 100%;
}
/* 底色 / 描边 / 字色都由模板内联（useTheme 字面量，原因见 script 头注释），
   类里只留几何与字形 */
.close {
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}
.close-label {
  font-size: 18px;
}
</style>
