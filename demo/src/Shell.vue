<script setup lang="ts">
// 应用外壳：[导航栏 | 页面 | 底部安全区]。安全区不在外壳上整层包，而是各归
// 各位：顶部归导航栏——safe-area 只让出顶边，状态栏区域和 van-nav-bar 底色
// 连成一片（沉浸式导航），导航栏在页面滚动区之外、不随内容滚走；底部作为
// 外壳最后一段垫在页面下面。每个路由页面都被它包一层——Flutter 侧一个页面
// 就是一个原生 Navigator 路由（手势返回和转场由平台负责），web 侧是
// <router-view> 的内容。
import { computed } from 'vue';
import { useRouter, type RouteLocation } from 'fjs/router';

const props = defineProps<{ route: RouteLocation }>();

const router = useRouter();
const title = computed(() => String(props.route.meta.title ?? ''));
// 首页没有返回按钮
const back = computed(() => props.route.path !== '/');
</script>

<template>
  <view class="shell">
    <safe-area edges="top" class="nav">
      <van-nav-bar :title="title" :left-arrow="back" @click-left="router.back()" />
    </safe-area>
    <slot />
  </view>
</template>

<style scoped>
.shell {
  flex-grow: 1;
  background-color: #ffffff;
}
.nav {
  background-color: #ffffff;
}
</style>
