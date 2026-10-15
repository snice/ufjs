<script setup lang="ts">
// Horizontally scrolling category pills; the last one overhangs the edge on
// purpose so the row reads as scrollable.
defineProps<{ chips: string[] }>();
</script>

<template>
  <scroll-view scroll-x class="chips">
    <view class="track">
      <view v-for="c in chips" :key="c" class="chip">
        <view class="dot" />
        <text class="label">{{ c }}</text>
      </view>
    </view>
  </scroll-view>
</template>

<style scoped>
.chips {
  width: 100%;
}
.track {
  flex-direction: row;
  gap: 10px;
  padding: 4px 20px 8px;
}
.chip {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px 0 10px;
  border-radius: 18px;
  background-color: #ffffff;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
  transition: transform 0.15s;
}
.chip:active {
  transform: scale(0.95);
}
.dot {
  width: 16px;
  height: 16px;
  border-radius: 5px;
  background: linear-gradient(135deg, #34c759, #0a84ff);
}
.label {
  font-size: 15px;
  font-weight: 600;
  color: #000000;
}
</style>
