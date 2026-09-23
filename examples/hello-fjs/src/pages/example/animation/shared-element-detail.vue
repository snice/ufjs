<route>
{"title": "共享元素详情", "transition": "fjs-fade"}
</route>

<script setup lang="ts">
// 跨共享元素场景的落地端（spec 101）。
//
// 列表页 push 前把缩略图槽位记进了 hero.ts 的登记表；本页挂载后量自己的
// 大图位置，让飞行盒从槽位飞过来，落地交还给真身。路由转场是 fjs-fade：
// 280ms 的淡入与去程飞行同拍，两端一致。飞行盒本身不参与路由淡出——
// App 端它在 overlay 宿主（独立条目）里，web 端它是页面 DOM 的一部分会
// 随页面淡入淡出——这是登记过的两端差异（spec 101 §4）。
//
// ✕ 是 JS 发起的关闭：先起飞再 back()，240ms 的回飞先于 280ms 的路由
// 淡出结束。手势 / NavBar 返回 / 浏览器后退没有起点信号，走普通转场：
// 列表真身全程可见（共享开关是开着的），淡出后自然对位——两端一致的降级。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'fjs/router';
import HeroFly from '@/components/HeroFly.vue';
import { CLOSE_MS, FLY_MS, heroHidden, rectOf, sourceOf, type Rect } from '@/hero';

const route = useRoute();
const router = useRouter();

// query 在一次页面生命周期里不变（换 src 是新的 push），不需要响应式
const src = String(route.query.src ?? '/images/test-square.png');
const hidden = heroHidden(`se:${src}`);

const heroEl = ref<unknown>(null);
const flight = ref<{ from: Rect; to: Rect; duration: number; key: number } | null>(null);
let flySeq = 0;

onMounted(() => {
  // 测距推迟到 rAF：onMounted 跑在 navMount 的 dispatch 栈里，同步
  // flushNow + fjs.ui.rect 在 Android 上拿到的是全 0 矩形 → 守卫静默
  // 跳过飞行（用户实测「跨页面飞入没动画」的根因；同页面场景在 tap 栈里
  // 同步测距是好的，差异就在这）。rAF 在 dispatch 返回之后执行，宿主这
  // 时已经收到本页的节点，矩形非零（模拟器 PROBE-OK 验证）。
  requestAnimationFrame(() => {
    const from = sourceOf(`se:${src}`);
    const to = rectOf(heroEl.value);
    // 直达（web 刷新、手输 URL）没有来源槽位：不飞，大图直接可见
    if (!from?.width || !to.width) return;
    hidden.value = true; // 真身（本页大图 + 列表槽位）一起藏，盒子接手
    flight.value = { from, to, duration: FLY_MS, key: ++flySeq };
  });
});

function onFlyDone() {
  hidden.value = false;
  flight.value = null;
}

function back() {
  if (flight.value) return; // 飞行中不响应，防连点
  const from = rectOf(heroEl.value);
  const to = sourceOf(`se:${src}`);
  if (!from.width || !to?.width) {
    router.back();
    return;
  }
  hidden.value = true;
  flight.value = { from, to, duration: CLOSE_MS, key: ++flySeq };
  router.back(); // 280ms 的 fjs-fade 淡出窗口，回飞 240ms 内完成
}

// 兜底：路由先死（时序抖动、连点）时 done 永远到不了，不在 unmount 里
// 复位的话列表缩略图会卡在 opacity 0——静默失效（宪法 V）
onBeforeUnmount(() => {
  hidden.value = false;
});
</script>

<template>
  <view class="page">
    <view class="bar">
      <view class="close" @tap="back">
        <text class="close-label">✕</text>
      </view>
      <text class="bar-hint">点 ✕ 飞回列表槽位；NavBar / 手势返回走普通淡出</text>
    </view>

    <view ref="heroEl" class="hero" :style="{ opacity: hidden ? 0 : 1 }">
      <image class="hero-img" :src="src" mode="aspectFill" />
    </view>

    <text class="title">共享元素落点</text>
    <text class="body">
      这张大图就是列表里那张缩略图。去程：飞行盒从列表槽位飞到这里（280ms，
      与 fjs-fade 路由淡入同拍），落地后交给页面自己的 image；回程：点 ✕
      先起飞再返回（240ms，先于路由淡出结束），落地时列表真身重新出现。
    </text>
    <text class="body">
      两端差异（登记过）：App 端飞行盒在 overlay 宿主里、不参与路由淡出；
      web 端它是页面 DOM 的一部分，会随页面一起淡入淡出。
    </text>

    <HeroFly
      v-if="flight"
      :key="flight.key"
      :src="src"
      :from="flight.from"
      :to="flight.to"
      :duration="flight.duration"
      @done="onFlyDone"
    />
  </view>
</template>

<style scoped>
.page {
  padding: 16px;
  padding-bottom: 32px;
}
.bar {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.close {
  width: 40px;
  height: 36px;
  align-items: center;
  justify-content: center;
  background-color: var(--fjs-card);
  border: 1px solid var(--fjs-border);
  border-radius: 6px;
}
.close-label {
  font-size: 18px;
  color: var(--fjs-title);
}
.bar-hint {
  font-size: 12px;
  color: var(--fjs-faint);
  flex-shrink: 1;
}
.hero {
  width: 100%;
  height: 300px;
  border-radius: 12px;
  overflow: hidden;
}
.hero-img {
  width: 100%;
  height: 100%;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--fjs-title);
  margin-top: 16px;
}
.body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--fjs-text);
  margin-top: 10px;
}
</style>
