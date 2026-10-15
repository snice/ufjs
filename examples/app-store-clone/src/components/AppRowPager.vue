<script setup lang="ts">
// Rows in groups of three; groups scroll sideways with the next group peeking in
// from the right, like the App Store's list shelves.
//
// scroll-x + fixed group width instead of `swiper`: swiper has no page margin,
// so the next page cannot peek (plan.md §3 revision). Known difference from iOS:
// there is no snap to a group edge (scroll-view has no snap attribute).
import { computed } from 'vue';
import type { AppItem } from '../data/apps';
import AppRow from './AppRow.vue';

const props = withDefaults(defineProps<{ apps: AppItem[]; per?: number }>(), { per: 3 });

const groups = computed(() => {
  const out: AppItem[][] = [];
  for (let i = 0; i < props.apps.length; i += props.per) out.push(props.apps.slice(i, i + props.per));
  return out;
});
</script>

<template>
  <scroll-view scroll-x class="pager" :bounces="true">
    <view class="track">
      <view v-for="(g, gi) in groups" :key="gi" class="group">
        <AppRow v-for="(a, i) in g" :key="a.id" :app="a" :divider="i < g.length - 1" />
      </view>
    </view>
  </scroll-view>
</template>

<style scoped>
.pager {
  width: 100%;
}
.track {
  flex-direction: row;
  padding: 0 20px;
  gap: 16px;
}
.group {
  /* leaves ~44px of the next group visible on a 390px-wide phone */
  width: 326px;
  flex-shrink: 0;
}
</style>
