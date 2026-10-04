<script setup lang="ts">
// 两端同源的 PullRefresh 包装（specs/205 §7；App 端头部 specs/206）。
//
// van-pull-refresh 的手势依赖浏览器滚动语义：非 passive touchmove 抢手势
// + window scrollTop 门控。App 端手势竞技场把垂直拖动判给页面
// scroll-view（track 的 touchmove 被 cancel），拉不出来；纯 JS 自绘也被
// 同一层否定——「滚到顶 + 拖动距离」只有原生滚动层有。所以 App 端走
// fjs refresh 标签的自定义头部模式（specs/206）：两个子级 = 头部内容 +
// 嵌套 scroll-view（高度 scrollHeight，页面按布局给）。原生只管手势与
// 几何（头部随拉动平移、裁剪、收口），JS 渲染与 web 相同的 vant 头部：
// 状态由 @statuschange 驱动（{"status":...} JSON 串）；loading 相直接用
// van-loading（内联 SVG 引擎原生渲染，spinner+文字由 vant 自己的 CSS
// 排成一行，两端同款），头部数值取 vant 默认（head 50px、#969799、
// 14px）。scroll-view 上 bounces=false 关掉 iOS 的 rubber-band：弹性的
// 视觉过滚会叠在拉动的 translate 上，内容位移变成两份、头部和内容之间
// 空出一段（微信 scroll-view 同名属性）。web 端原样 van-pull-refresh
// （@vant/touch-emulator 让桌面浏览器鼠标也能拉）。
//
// 对外契约与 van-pull-refresh 一致：v-model:refreshing + @refresh + 默认
// 插槽；刷新态要调用方把 v-model 置回 false 才结束（specs/205 §7.11）。
// App 端触发时包装组件替 vant 把 model 置 true（vant 触发即 emit
// update:modelValue true），false 回来后先亮 500ms「刷新成功」
// （vant successDuration 默认值），再把原生 refreshing prop 翻 false
// ——头部模式的收口由 prop 翻转驱动（原生只认翻转，specs/206）。
// 调用方在 @refresh 里清数据后要手动 listRef.check()（List 的 check 只由
// loading/finished 变化与滚动事件触发，清空后两者都可能无变化；App 端
// 无滚动事件兜底）。
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{ scrollHeight?: number }>(), {
  scrollHeight: 420,
});
const emit = defineEmits<{ refresh: [] }>();
const refreshing = defineModel<boolean>('refreshing', { default: false });
// dom-env 给 App 端的 userAgent 是 'fjs'（浏览器是真实 UA）。
const isApp = navigator.userAgent === 'fjs';

// ---- App 分支：vant 样式头部（specs/206）----
type PullStatus = 'pulling' | 'loosing' | 'loading' | 'success';
// 原生把收口开始报告为 normal（文案复位 = vant 的 status normal），这里
// 归位成 pulling（下拉刷新）。
type NativeStatus = PullStatus | 'normal';
const status = ref<PullStatus>('pulling');
const STATUS_TEXT: Record<PullStatus, string> = {
  pulling: '下拉刷新',
  loosing: '松开刷新',
  loading: '加载中...',
  success: '刷新成功',
};
// 原生 refresh 的 refreshing prop：触发瞬间置 true（让 success 结束时的
// false 成为一次数值翻转），500ms 文案展示完再翻 false 触发收口。
const nativeRefreshing = ref(false);

function onNativeStatus(payload?: unknown): void {
  try {
    const next = JSON.parse(String(payload)).status as NativeStatus;
    status.value = next === 'normal' ? 'pulling' : next;
  } catch {
    // 载荷固定是本仓库写的 JSON；坏串按无事件处理
  }
}

function onNativeRefresh(): void {
  refreshing.value = true;
  nativeRefreshing.value = true;
  status.value = 'loading';
  emit('refresh');
}

watch(refreshing, (value, previous) => {
  if (!isApp || value || previous !== true) return;
  if (!nativeRefreshing.value) {
    // 没有原生触发在途（调用方程序性置 false）：直接复位，不走 success
    status.value = 'pulling';
    return;
  }
  status.value = 'success';
  window.setTimeout(() => {
    nativeRefreshing.value = false;
  }, 500);
});
</script>

<template>
  <refresh
    v-if="isApp"
    :refreshing="nativeRefreshing"
    @refresh="onNativeRefresh"
    @statuschange="onNativeStatus"
  >
    <view class="pf-head">
      <view v-if="status === 'loading'" class="pf-spin"><view class="pf-spinner" /></view>
      <text class="pf-text">{{ STATUS_TEXT[status] }}</text>
    </view>
    <scroll-view scroll-y :bounces="false" :style="{ height: props.scrollHeight + 'px' }">
      <slot />
    </scroll-view>
  </refresh>
  <van-pull-refresh v-else v-model="refreshing" success-text="刷新成功" @refresh="emit('refresh')">
    <slot />
  </van-pull-refresh>
</template>

<style scoped>
/* vant __head 的数值（specs/206 §4）：50px 高、#969799、14px、内容居中。 */
.pf-head {
  height: 50px;
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  color: #969799;
  font-size: 14px;
}
.pf-text {
  color: #969799;
  font-size: 14px;
  /* fjs 的文字在 50px 行盒里字形墨水比盒子中心低 ~2px（web 的行内居中
     结果不同），静态上移补齐——补齐不要放到旋转元素上：relative 偏移是
     装饰层的 paint 平移，keyframe 旋转包在它外层、绕外层盒中心转，
     旋转元素自带偏移会变成绕小圈的公转（specs/206 §7.12）。 */
  position: relative;
}
/* spinner：C 形环（缺口 = 透明的底边），16px（pull-refresh 的
   loading-icon-size）、#c8c9cc（--van-gray-5）、0.8s（vant 的
   spinner-duration）。动画复用 vant 已注册的 van-rotate keyframes——
   盒子旋转走 keyframeNode 的 Transform 路径（探针实证有 tick，specs/206
   §7.12）；自定义 keyframes 在页面 chunk 里注册不生效是另一件事。 */
/* 间距放在不转的外层：fjs 里 margin 属于被 keyframe Transform 包住的盒子，
   旋转中心会算进 margin，spinner 就绕偏心点公转（视觉上"中心漂移"）。 */
.pf-spin {
  margin-right: 8px;
}
.pf-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #c8c9cc;
  border-bottom-color: transparent;
  border-radius: 50%;
  animation: van-rotate 0.8s linear infinite;
}
</style>
