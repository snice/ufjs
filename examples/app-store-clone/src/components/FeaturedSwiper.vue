<script setup lang="ts">
// Featured cards: blue kicker, big title, grey subtitle, then a rounded
// gradient "artwork". Fixed card width inside a scroll-x so the next card
// peeks in (same trade-off as AppRowPager, no snapping).
import { appById } from '../data/apps';
import type { Featured } from '../data/stories';
import AppIcon from './AppIcon.vue';
import GetButton from './GetButton.vue';

defineProps<{ items: Featured[] }>();
</script>

<template>
  <scroll-view scroll-x class="wrap">
    <view class="track">
      <view v-for="f in items" :key="f.title" class="card">
        <text class="kicker">{{ f.kicker }}</text>
        <text class="title">{{ f.title }}</text>
        <text class="sub">{{ f.subtitle }}</text>
        <view class="art" :style="{ background: f.gradient }">
          <text class="emoji">{{ f.emoji }}</text>
          <view v-if="f.appId && appById(f.appId)" class="strip">
            <AppIcon
              :gradient="appById(f.appId)!.gradient"
              :emoji="appById(f.appId)!.emoji"
              :size="40"
            />
            <view class="strip-text">
              <text class="strip-name">{{ appById(f.appId)!.name }}</text>
              <text class="strip-sub">{{ appById(f.appId)!.subtitle }}</text>
            </view>
            <GetButton :id="f.appId" :on-glass="true" />
          </view>
        </view>
      </view>
    </view>
  </scroll-view>
</template>

<style scoped>
.wrap {
  width: 100%;
}
.track {
  flex-direction: row;
  gap: 14px;
  padding: 0 20px;
}
.card {
  width: 330px;
  flex-shrink: 0;
}
.kicker {
  font-size: 12px;
  font-weight: 700;
  color: #0a84ff;
}
.title {
  margin-top: 2px;
  font-size: 22px;
  font-weight: 700;
  color: #000000;
  max-lines: 1;
  overflow: ellipsis;
}
.sub {
  font-size: 22px;
  font-weight: 500;
  color: #8e8e93;
  max-lines: 1;
  overflow: ellipsis;
}
.art {
  margin-top: 10px;
  height: 220px;
  border-radius: 14px;
  overflow: hidden;
  align-items: center;
  justify-content: center;
  position: relative;
}
.emoji {
  font-size: 88px;
}
.strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background-color: rgba(0, 0, 0, 0.28);
}
.strip-text {
  flex-grow: 1;
  flex-shrink: 1;
  width: 0px;
}
.strip-name {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}
.strip-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  max-lines: 1;
  overflow: ellipsis;
}
</style>
