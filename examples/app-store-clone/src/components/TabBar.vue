<script setup lang="ts">
// The global floating tab bar (specs/210). Mounted by createFjsApp's `tabBar`
// option: one instance for the whole app, outside every page tree, floating
// over the content and not taking page height.
//
// This is only a dispatcher: the glass capsule + sliding slider come from
// @ufjs/liquidglass's 'liquid-glass' style; here we add the safe-area and the
// icons through the `item` slot. Switching tabs uses router.replace so the
// leaving tab page is parked (kept alive), not destroyed (docs/routing.md).
import { hasNativeHost } from 'fjs';
import { useRouter } from 'fjs/router';
import { getTabBarStyle } from '@ufjs/liquidglass';
import Icon, { type IconName } from './Icon.vue';

defineProps<{
  /** The current tab page's meta.tab; the bar shows only when it is a number */
  active: number | null;
  /** Tab pages from the route table, in meta.tab order */
  tabs: { path: string; title: string; tab: number }[];
}>();

const router = useRouter();
const style = getTabBarStyle('liquid-glass');

// Icon per meta.tab, in the same order as the pages' `tab` numbers
const icons: IconName[] = ['today', 'games', 'apps', 'arcade', 'search'];
const BLUE = '#0A84FF';
</script>

<template>
  <view class="tabbar">
    <!-- web has no home-indicator inset (0 on desktop), so the capsule would sit
         on the bottom edge: pin 20px there; the App takes half the inset -->
    <safe-area edges="bottom" :scale="0.5" :style="hasNativeHost ? undefined : { paddingBottom: '20px' }">
      <view class="dock">
        <component
          :is="style"
          :tabs="tabs"
          :active="active"
          :dark="false"
          :accent="BLUE"
          @select="(path: string) => router.replace(path)"
        >
          <template #item="{ item, active: on }">
            <Icon :name="icons[item.tab] ?? 'today'" :size="22" :color="on ? BLUE : '#1A1A1A'" />
            <text class="label" :style="{ color: on ? BLUE : '#1A1A1A' }">{{ item.title }}</text>
          </template>
        </component>
      </view>
    </safe-area>
  </view>
</template>

<style scoped>
.dock {
  margin: 0 20px;
}
.label {
  font-size: 10px;
  font-weight: 600;
}
</style>
