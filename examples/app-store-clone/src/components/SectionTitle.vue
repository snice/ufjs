<script setup lang="ts">
// "Title ›" section header. The chevron is decoration only: in the real app it
// opens a chart page, here there is no destination (specs/217 §7).
import Icon from './Icon.vue';

defineProps<{ title: string }>();
</script>

<template>
  <view class="head">
    <text class="title">{{ title }}</text>
    <Icon name="chevron" :size="16" color="#8E8E93" />
  </view>
</template>

<style scoped>
.head {
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 18px 20px 6px;
}
.title {
  font-size: 22px;
  font-weight: 700;
  color: #000000;
}
</style>
