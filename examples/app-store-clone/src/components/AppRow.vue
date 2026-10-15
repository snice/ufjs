<script setup lang="ts">
// One list row: icon, name + subtitle, right-hand GetButton, hairline below.
//
// Only the left part (.main) is tappable. The button is a SIBLING, not a child:
// a tap on "获取" must not also open the detail page, and an event modifier
// like `.stop` is not available on the fjs element API.
import { useRouter } from 'fjs/router';
import type { AppItem } from '../data/apps';
import AppIcon from './AppIcon.vue';
import GetButton from './GetButton.vue';

withDefaults(defineProps<{ app: AppItem; divider?: boolean }>(), { divider: true });

const router = useRouter();
</script>

<template>
  <view class="row">
    <view class="main" @tap="router.push({ path: '/detail', query: { id: app.id } })">
      <AppIcon :gradient="app.gradient" :emoji="app.emoji" :size="60" />
      <view class="text">
        <text class="name" :style="{ maxLines: 2, overflow: 'ellipsis' }">{{ app.name }}</text>
        <text class="sub" :style="{ maxLines: 1, overflow: 'ellipsis' }">{{ app.subtitle }}</text>
      </view>
    </view>
    <GetButton :id="app.id" :in-app="app.inApp" />
    <view v-if="divider" class="line" />
  </view>
</template>

<style scoped>
.row {
  flex-direction: row;
  align-items: center;
  padding: 10px 0;
  position: relative;
}
.main {
  flex-direction: row;
  align-items: center;
  flex-grow: 1;
  flex-shrink: 1;
  gap: 12px;
  margin-right: 12px;
  /* shrinks so the button never gets squeezed */
  width: 0px;
}
.text {
  flex-grow: 1;
  flex-shrink: 1;
  width: 0px;
}
.name {
  font-size: 16px;
  font-weight: 600;
  color: #000000;
}
.sub {
  margin-top: 2px;
  font-size: 13px;
  color: #8e8e93;
}
.line {
  position: absolute;
  left: 72px;
  right: 0;
  bottom: 0;
  height: 0.5px;
  background-color: #e5e5ea;
}
</style>
