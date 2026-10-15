<script setup lang="ts">
// App shell: white page + (for tab pages) a vertical scroll area. There is no
// nav bar — the App Store uses large titles that scroll with the content.
//
// Pages that manage their own scrolling (the app detail page, whose cover and
// floating buttons sit outside the scroll area) opt out with
// `<route>{"scroll": false}</route>`, same switch as hello-fjs's shell.
import { computed } from 'vue';
import type { RouteLocation } from 'fjs/router';

const props = defineProps<{ route: RouteLocation }>();

const scrolls = computed(() => props.route.meta.scroll !== false);
const withBar = computed(
  () => typeof props.route.meta.tab === 'number' && props.route.meta.tabBar !== false,
);
</script>

<template>
  <view class="shell">
    <scroll-view v-if="scrolls" class="body">
      <safe-area edges="top" />
      <slot />
      <!-- the floating bar sits over the content: leave its height (56 + 8 gap)
           at the end so the last row can scroll clear of it -->
      <view v-if="withBar" class="tab-clearance" />
      <safe-area edges="bottom" />
    </scroll-view>
    <view v-else class="body">
      <slot />
    </view>
  </view>
</template>

<style scoped>
.shell {
  flex-grow: 1;
  background-color: #ffffff;
}
.body {
  /* 0px + flex-grow: a scroll-view needs a definite height on every target */
  height: 0px;
  flex-grow: 1;
}
.tab-clearance {
  height: 80px;
}
</style>
