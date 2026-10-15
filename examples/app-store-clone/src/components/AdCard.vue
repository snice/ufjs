<script setup lang="ts">
// NB: the wrapper is `.icon-wrap`, not `.icon`: a scoped parent rule also hits the
// child component's ROOT element, and AppIcon's root is `.icon`.
// Sponsored card: dim blurred-looking backdrop, centred large icon, "广告"
// tag + name + subtitle bottom-left, "打开/获取" on the right. The backdrop is
// a gradient (the real one is a blurred screenshot).
import { appById } from '../data/apps';
import AppIcon from './AppIcon.vue';
import GetButton from './GetButton.vue';

const props = defineProps<{ appId: string }>();
const app = appById(props.appId)!;
</script>

<template>
  <view class="card">
    <view class="icon-wrap">
      <AppIcon :gradient="app.gradient" :emoji="app.emoji" :size="80" />
    </view>
    <view class="row">
      <view class="text">
        <text class="name">{{ app.name }}</text>
        <view class="meta">
          <view class="tag"><text class="tag-text">广告</text></view>
          <text class="sub">{{ app.subtitle }}</text>
        </view>
      </view>
      <GetButton :id="app.id" :in-app="app.inApp" :on-glass="true" />
    </view>
  </view>
</template>

<style scoped>
.card {
  height: 160px;
  border-radius: 20px;
  overflow: hidden;
  position: relative;
  background: linear-gradient(160deg, #8e8e93, #3a3a3c);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  transition: transform 0.2s;
}
.card:active {
  transform: scale(0.96);
}
.icon-wrap {
  position: absolute;
  top: 14px;
  left: 0;
  right: 0;
  align-items: center;
}
.row {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 12px;
  flex-direction: row;
  align-items: flex-end;
  gap: 12px;
}
.text {
  flex-grow: 1;
  flex-shrink: 1;
  width: 0px;
}
.name {
  font-size: 17px;
  font-weight: 700;
  color: #ffffff;
}
.meta {
  margin-top: 4px;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.tag {
  padding: 1px 6px;
  border-radius: 4px;
  background-color: #0a84ff;
}
.tag-text {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
}
.sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
  max-lines: 1;
  overflow: ellipsis;
  flex-shrink: 1;
}
</style>
