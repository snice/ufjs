<script setup lang="ts">
// 底部全局 tabBar（specs/210）。组件由 createFjsApp 的 tabBar 选项挂载，
// 整个应用只有这一份、游离在所有页面树之外，悬浮在页面内容之上、不占
// 页面高度（TabGroup 里的 fixed 层），只在 tab 页显示——push 出的二级页
// 整页盖住它，微信语义。框架注入的 active 是当前 tab 页的 meta.tab；切
// tab 仍用 router.replace，栈里只有基页时原地换页、离开的一侧被 park 保活。
//
// 配色自带，不依赖页面 CSS 变量链：悬浮层不在任何 Shell 底下，页面根上
// 挂的 --fjs-* 够不着它，所以在自己根节点再挂一份——两处读同一个
// useTheme 单例，切主题仍然只改一处状态。
//
// 外观是悬浮胶囊：底色半透明，web 端再加 backdrop-filter 毛玻璃；
// Flutter 端没有模糊 tag，靠胶囊透明度近似（差异登记 docs/routing.md）。
// hasNativeHost 区分两端——不支持的性质干脆不写进 Flutter 的样式，省得
// 样式引擎每次启动 warnOnce（宪法 V）。
import { hasNativeHost } from 'fjs';
import { useRouter } from 'fjs/router';
import type { IconName } from '@ufjs/iconmind';
import { useTheme } from '../theme';

defineProps<{
  /** 当前 tab 页的 meta.tab；bar 只在该值非空（tab 页）时显示 */
  active: number | null;
  /** 路由表派生的 tab 页（{ path, title, tab }），按 meta.tab 排序。
   * 这里图标只能自己配，所以列表留在下面——顺序即 meta.tab 序号。 */
  tabs: unknown[];
}>();

const router = useRouter();
const { vars } = useTheme();

const items: { label: string; icon: IconName; path: string }[] = [
  { label: '内置组件', icon: 'code', path: '/' },
  { label: '接口', icon: 'api', path: '/api' },
  { label: '示例', icon: 'experiment', path: '/example' },
  { label: '关于', icon: 'info', path: '/about' },
];
</script>

<template>
  <view class="tabbar" :style="vars">
    <!-- 底部安全区归 tabBar：胶囊悬浮在 Home 指示条之上，指示条那一段
         保持透明，页面内容从 bar 底下透出来（fixed 不占页面高度） -->
    <!-- web 没有 Home 指示条 inset（桌面浏览器为 0），胶囊会贴底：web 端用
         safe-area 的"显式 padding 覆盖 inset"固定留 20px；App 端仍取 inset 的一半 -->
    <safe-area edges="bottom" :scale="0.5" :style="hasNativeHost ? undefined : { paddingBottom: '20px' }">
      <view class="dock">
        <view class="capsule" :class="{ blur: !hasNativeHost }">
          <view
            v-for="(item, i) in items"
            :key="item.label"
            class="item"
            :class="{ active: active === i }"
            @tap="() => router.replace(item.path)"
          >
            <icon-mind class="icon" :name="item.icon" :size="20" weight="regular" />
            <text class="label">{{ item.label }}</text>
          </view>
        </view>
      </view>
    </safe-area>
  </view>
</template>

<style scoped>
.dock {
  /* no bottom margin: the safe-area inset (scaled to half, App Store's
     floating bar sits lower than the full home-indicator strip) is already
     the gap to the screen edge */
  margin: 0 20px;
}
.capsule {
  flex-direction: row;
  height: 52px;
  border-radius: 26px;
  background-color: var(--fjs-capsule);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
/* 只有 web 有毛玻璃；样式引擎没这个性质，App 端不挂这个 class */
.capsule.blur {
  backdrop-filter: blur(24px) saturate(180%);
}
.item {
  flex-grow: 1;
  align-items: center;
  justify-content: center;
  gap: 1px;
  /* 颜色沿树继承：选中态只要换 .item 上的 color，图标和文字一起变。
     未选中照 App Store 用近黑的标题色，不用 muted */
  color: var(--fjs-title);
}
.item.active {
  color: var(--fjs-primary);
}
.icon {
  width: 20px;
  height: 20px;
}
.label {
  font-size: 10px;
}
</style>
