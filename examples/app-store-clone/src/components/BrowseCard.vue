<script setup lang="ts">
// "浏览" category tile: gradient, white title bottom-left, big emoji top-right
// standing in for the illustration. Press feedback only, no destination
// (specs/217 §7).
defineProps<{ title: string; gradient: string; emoji: string }>();
</script>

<template>
  <view class="tile" :style="{ background: gradient }">
    <text class="emoji">{{ emoji }}</text>
    <text class="title">{{ title }}</text>
  </view>
</template>

<style scoped>
.tile {
  flex-grow: 1;
  flex-basis: 0px;
  height: 104px;
  border-radius: 16px;
  padding: 12px;
  justify-content: flex-end;
  position: relative;
  overflow: hidden;
  transition: transform 0.15s;
}
.tile:active {
  transform: scale(0.96);
}
.emoji {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 38px;
}
.title {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
}
</style>
