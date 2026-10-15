<script setup lang="ts">
// "时下热门" card: small kicker, headline, then the first rows of the list.
// The header expands the card into the story (CardExpand); the rows below have
// their own taps (open detail) and Get buttons (see AppRow).
import { appsOf } from '../data/apps';
import type { Story } from '../data/stories';
import AppRow from './AppRow.vue';

const props = defineProps<{ story: Story }>();
const emit = defineEmits<{ open: [] }>();
const apps = appsOf(props.story.appIds).slice(0, 4);
</script>

<template>
  <view class="card">
    <!-- the header (no buttons in it) is the expand target; each row below handles
         its own taps, and its Get button is a sibling of the tappable part (AppRow) -->
    <view class="head" @tap="emit('open')">
      <text class="kicker">{{ story.kicker }}</text>
      <text class="title">{{ story.title }}</text>
    </view>
    <view class="rows">
      <AppRow v-for="(a, i) in apps" :key="a.id" :app="a" :divider="i < apps.length - 1" />
    </view>
  </view>
</template>

<style scoped>
.card {
  position: relative;
  border-radius: 20px;
  background-color: #ffffff;
  padding: 16px 16px 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  transition: transform 0.2s;
}
.card:active {
  transform: scale(0.97);
}
.kicker {
  font-size: 13px;
  font-weight: 700;
  color: #8e8e93;
}
.title {
  margin-top: 2px;
  font-size: 24px;
  font-weight: 800;
  color: #000000;
}
.rows {
  margin-top: 8px;
}
</style>
