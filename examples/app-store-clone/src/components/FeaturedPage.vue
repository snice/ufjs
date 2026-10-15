<script setup lang="ts">
// Shared skeleton of the 游戏 and App tabs: title, category chips, featured
// shelf, then titled shelves of app rows (three per column, scrolling sideways).
import { appsOf } from '../data/apps';
import type { Featured } from '../data/stories';
import LargeTitle from './LargeTitle.vue';
import ChipRow from './ChipRow.vue';
import FeaturedSwiper from './FeaturedSwiper.vue';
import SectionTitle from './SectionTitle.vue';
import AppRowPager from './AppRowPager.vue';

defineProps<{
  title: string;
  chips: string[];
  featured: Featured[];
  sections: { title: string; appIds: string[] }[];
}>();
</script>

<template>
  <view>
    <LargeTitle :title="title" />
    <ChipRow :chips="chips" />
    <view class="gap" />
    <FeaturedSwiper :items="featured" />
    <view v-for="s in sections" :key="s.title">
      <SectionTitle :title="s.title" />
      <AppRowPager :apps="appsOf(s.appIds)" />
    </view>
  </view>
</template>

<style scoped>
.gap {
  height: 14px;
}
</style>
