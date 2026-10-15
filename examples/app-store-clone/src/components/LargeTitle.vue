<script setup lang="ts">
// Large left-aligned page title with the round account avatar on the right.
// It scrolls away with the content (the App Store has no pinned mini title).
defineProps<{ title: string }>();
</script>

<template>
  <view class="bar">
    <text class="title">{{ title }}</text>
    <view class="avatar">
      <text class="avatar-text">MT</text>
    </view>
  </view>
</template>

<style scoped>
.bar {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px 10px;
}
.title {
  font-size: 34px;
  font-weight: 800;
  color: #000000;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #8e9eea, #6a5acd);
}
.avatar-text {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}
</style>
