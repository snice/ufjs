<script setup lang="ts">
// 两端同源的 PullRefresh 包装（specs/205 §7）。
//
// van-pull-refresh 的手势依赖浏览器滚动语义：非 passive touchmove 抢手势
// + window scrollTop 门控。App 端手势竞技场把垂直拖动判给页面
// scroll-view（track 的 touchmove 被 cancel），拉不出来；给根无条件
// touch-action: none 又会杀死区域内的页面滚动。App 端正解是 fjs refresh
// 标签（Flutter RefreshIndicator）：内层滚到顶才放行下拉，列表滚动照常
// ——RefreshIndicator 要求可见的滚动子级，所以 App 分支带嵌套
// scroll-view（高度 scrollHeight，页面按布局给）。web 端原样
// van-pull-refresh（@vant/touch-emulator 让桌面浏览器鼠标也能拉）。
//
// 对外契约与 van-pull-refresh 一致：@refresh + 默认插槽。调用方在
// @refresh 里清数据后要手动 listRef.check()（List 的 check 只由
// loading/finished 变化与滚动事件触发，清空后两者都可能无变化；App 端
// 无滚动事件兜底）。差异：App 端是 Material 转圈、无 success 文案阶段
// ——RefreshIndicator 的自定义参数（color 等）当前不经 refresh 标签
// 透出，要换拉动 UI 得扩 refresh 标签的 props（needs-a-spec）。
import { ref } from 'vue';

const props = withDefaults(defineProps<{ scrollHeight?: number }>(), {
  scrollHeight: 420,
});
const emit = defineEmits<{ refresh: [] }>();
const refreshing = ref(false);
// dom-env 给 App 端的 userAgent 是 'fjs'（浏览器是真实 UA）。
const isApp = navigator.userAgent === 'fjs';
</script>

<template>
  <refresh v-if="isApp" @refresh="emit('refresh')">
    <scroll-view scroll-y :style="{ height: props.scrollHeight + 'px' }">
      <slot />
    </scroll-view>
  </refresh>
  <van-pull-refresh v-else v-model="refreshing" success-text="刷新成功" @refresh="emit('refresh')">
    <slot />
  </van-pull-refresh>
</template>
