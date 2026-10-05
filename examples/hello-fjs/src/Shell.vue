<script setup lang="ts">
// 应用外壳：[导航栏 | 可滚动页面]。
//
// tabBar 不在这里（specs/210）：它由 createFjsApp 的 tabBar 选项全局挂载
// （整个应用一份、只在 tab 页显示，悬浮在内容上不占页面高度），外壳只在
// tab 页给滚动内容补留白与底部安全区。安全区各归各位：顶部归导航栏（NavBar 自带），
// 底部作为滚动内容的最后一段，内容能滚到 Home 指示条下面。
// 每个路由页面都被它包一层——Flutter 侧一个页面就是一个原生 Navigator
// 路由（手势返回和转场由平台负责），web 侧是 <router-view> 的内容。
import { computed } from 'vue';
import type { RouteLocation } from 'fjs/router';
import NavBar from './components/NavBar.vue';
import { useTheme } from './theme';

// 主题只在这里落地一次：整棵页面树都在 .shell 底下，自定义属性沿树继承，
// 所以切主题就是改这一个节点的内联样式。悬浮 tabBar 游离在页面树外，
// 它在自己根节点挂同一份（两处读同一个 useTheme 单例）。
const { vars } = useTheme();

const props = defineProps<{ route: RouteLocation }>();

// tab 首页没有返回按钮
const tab = computed(() =>
  typeof props.route.meta.tab === 'number' ? (props.route.meta.tab as number) : null,
);
const title = computed(() => String(props.route.meta.title ?? ''));

// tabBar 只在 tab 页显示（specs/210，微信语义：push 出的二级页没有
// tabBar），全屏页再配 "tabBar": false 也不显示。bar 悬浮在内容之上、
// 不占页面高度（TabGroup 里的 fixed 层），tab 页的滚动内容末尾要留出它
// 压住的高度；小程序端 tabBar 是微信原生的，占的是页面区域之外的位置——
// 判定方式与 fjs-safe-area 相同：wx 运行时在共享 chunk 里发布 __fjsWx。
const isMp =
  typeof (globalThis as { __fjsWx?: { isTabPagePath?: unknown } }).__fjsWx
    ?.isTabPagePath === 'function';
const withBar = computed(
  () =>
    !isMp &&
    typeof props.route.meta.tab === 'number' &&
    props.route.meta.tabBar !== false,
);

// 页面可以用 `<route>{"scroll": false}</route>` 说「我自己管滚动」。
//
// 这不是个偏好开关，是个正确性开关：外壳的 scroll-view 给内容的是**无界**高度，
// 所以页面里再套一个滚动容器，内层视口就和它的内容一样高——`list-view` 没有可
// 虚拟化的窗口，离屏 paint 裁剪也没有可裁的窗口。自带长列表的页面必须关掉它。
const scrolls = computed(() => props.route.meta.scroll !== false);
</script>

<template>
  <view class="shell" :style="vars">
    <NavBar :title="title" :back="tab === null" />
    <scroll-view v-if="scrolls" class="body">
      <slot />
      <!-- 悬浮 bar 压在内容上：内容末尾留出「胶囊 52 + 与内容的间距 8」，
           滚到底时最后一行停在胶囊之上而不是被它盖住；末尾这条 safe-area
           是 Home 指示条（有 bar 时它那一层自己也有，这里保证最后一行
           停在指示条之上）。没有 bar 的页面（二级页 / tabBar:false）照旧
           只有安全区 -->
      <view v-if="withBar" class="tab-clearance" />
      <safe-area edges="bottom" />
    </scroll-view>
    <view v-else class="body">
      <slot />
    </view>
    <!-- 自己管滚动的页面没法往它的滚动区里塞，只能在外面留一条 -->
    <safe-area v-if="!withBar && !scrolls" edges="bottom" />
  </view>
</template>

<style scoped>
.shell {
  flex-grow: 1;
  background-color: var(--fjs-page);
}
.body {
  /* 0px + flex-grow：skyline 要求 scroll-view 有确定的 height，0 基数
     配合 flex-grow 由父级分配（web/app 行为不变） */
  height: 0px;
  flex-grow: 1;
}
.tab-clearance {
  /* 和 TabBar.vue 的胶囊几何对齐：52px 胶囊 + 8px 与内容的间距 */
  height: 60px;
}
</style>
