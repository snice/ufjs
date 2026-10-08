<script setup lang="ts">
// 底部全局 tabBar（specs/210）的分发器。组件由 createFjsApp 的 tabBar 选项挂载，
// 整个应用只有这一份、游离在所有页面树之外，悬浮在页面内容之上、不占页面高度，
// 只在 tab 页显示。
//
// 外观风格（specs/212）：这里只做三件事——给悬浮层挂主题变量与底部安全区、
// 按「关于」页选的风格名从 @ufjs/liquidglass 的注册表取组件、把每一项的图标
// 通过 item 插槽交给它。切 tab 仍用 router.replace，栈里只有基页时原地换页、
// 离开的一侧被 park 保活。风格组件自己不碰 router（避免模块与应用各持一份
// router 单例）。
//
// 配色自带，不依赖页面 CSS 变量链：悬浮层不在任何 Shell 底下，页面根上
// 挂的 --fjs-* 够不着它，所以在自己根节点再挂一份——两处读同一个
// useTheme 单例，切主题仍然只改一处状态。
import { computed } from 'vue';
import { hasNativeHost } from 'fjs';
import { useRouter } from 'fjs/router';
import type { IconName } from '@ufjs/iconmind';
import { getTabBarStyle } from '@ufjs/liquidglass';
import { useTheme } from '../theme';
import { useTabBarStyle } from '../tabBarStyle';

defineProps<{
  /** 当前 tab 页的 meta.tab；bar 只在该值非空（tab 页）时显示 */
  active: number | null;
  /** 路由表派生的 tab 页（{ path, title, tab }），按 meta.tab 排序 */
  tabs: { path: string; title: string; tab: number }[];
}>();

const router = useRouter();
const { vars, mode, palette } = useTheme();
const { style } = useTabBarStyle();
const current = computed(() => getTabBarStyle(style.value));

// 图标只能自己配，顺序即 meta.tab 序号
const icons: IconName[] = ['code', 'api', 'experiment', 'info'];
</script>

<template>
  <view class="tabbar" :style="vars">
    <!-- 底部安全区归 tabBar：胶囊悬浮在 Home 指示条之上，指示条那一段
         保持透明，页面内容从 bar 底下透出来（fixed 不占页面高度） -->
    <!-- web 没有 Home 指示条 inset（桌面浏览器为 0），胶囊会贴底：web 端用
         safe-area 的"显式 padding 覆盖 inset"固定留 20px；App 端仍取 inset 的一半 -->
    <safe-area edges="bottom" :scale="0.5" :style="hasNativeHost ? undefined : { paddingBottom: '20px' }">
      <view class="dock">
        <component
          :is="current"
          :tabs="tabs"
          :active="active"
          :dark="mode === 'dark'"
          :accent="palette.primary"
          @select="(path: string) => router.replace(path)"
        >
          <template #item="{ item }">
            <icon-mind class="icon" :name="icons[item.tab] ?? 'info'" :size="20" weight="regular" />
            <text class="label">{{ item.title }}</text>
          </template>
        </component>
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
.icon {
  width: 20px;
  height: 20px;
}
.label {
  font-size: 10px;
}
</style>
