<route>
{"title": "详情", "tabBar": false, "scroll": false}
</route>

<script setup lang="ts">
// App detail, `/app/:id`. The cover bleeds under the status bar and the white
// panel rides up over its bottom edge, so the page owns its scroll-view
// (`scroll: false` in the route block) and the back / share buttons float above it.
import { computed } from 'vue';
import { useRoute, useRouter } from 'fjs/router';
import { appById } from '@/data/apps';
import AppIcon from '@/components/AppIcon.vue';
import GetButton from '@/components/GetButton.vue';
import InfoStrip from '@/components/InfoStrip.vue';
import GlassCircleButton from '@/components/GlassCircleButton.vue';

const route = useRoute();
const router = useRouter();
const app = computed(() => appById(String(route.params.id)));

// an unknown id (stale link) goes home instead of rendering an empty page
if (!appById(String(route.params.id))) router.replace('/');

const shots = [0, 1, 2, 3];
</script>

<template>
  <view v-if="app" class="page">
    <scroll-view class="scroll">
      <view class="cover" :style="{ background: app.gradient }">
        <text class="cover-emoji">{{ app.emoji }}</text>
      </view>
      <view class="panel">
        <view class="head">
          <AppIcon :gradient="app.gradient" :emoji="app.emoji" :size="100" />
          <view class="head-text">
            <text class="name">{{ app.name }}</text>
            <text class="dev">{{ app.developer }}</text>
            <view class="get"><GetButton :id="app.id" :in-app="app.inApp" /></view>
          </view>
        </view>
        <InfoStrip :app="app" />
        <view class="hair" />
        <view class="block">
          <text class="h">新功能</text>
          <text class="ver">版本 {{ app.version }}</text>
          <text class="notes">{{ app.notes }}</text>
        </view>
        <text class="h pad">预览</text>
        <scroll-view scroll-x class="shots">
          <view class="shots-track">
            <view v-for="i in shots" :key="i" class="shot" :style="{ background: app.gradient }">
              <text class="shot-emoji">{{ app.emoji }}</text>
            </view>
          </view>
        </scroll-view>
        <safe-area edges="bottom" />
        <view class="end" />
      </view>
    </scroll-view>

    <!-- floating controls: above the scroll area, under the status bar -->
    <view class="float">
      <safe-area edges="top">
        <view class="float-row">
          <GlassCircleButton icon="back" tone="red" @tap="router.back()" />
          <GlassCircleButton icon="share" />
        </view>
      </safe-area>
    </view>
  </view>
</template>

<style scoped>
.page {
  flex-grow: 1;
  background-color: #ffffff;
  /* containing block for .float: without it the App leaves the absolute
     controls in flow (they landed at the bottom of the screen) */
  position: relative;
}
.scroll {
  height: 0px;
  flex-grow: 1;
}
.cover {
  height: 230px;
  align-items: center;
  justify-content: center;
}
.cover-emoji {
  font-size: 90px;
  opacity: 0.55;
}
.panel {
  margin-top: -22px;
  background-color: #ffffff;
  border-radius: 22px 22px 0 0;
  padding-top: 20px;
}
.head {
  flex-direction: row;
  gap: 16px;
  padding: 0 20px 6px;
}
.head-text {
  flex-grow: 1;
  flex-shrink: 1;
  width: 0px;
  justify-content: space-between;
}
.name {
  font-size: 22px;
  font-weight: 800;
  color: #000000;
}
.dev {
  margin-top: 2px;
  font-size: 15px;
  color: #8e8e93;
}
.get {
  margin-top: 10px;
  align-items: flex-start;
}
.hair {
  height: 0.5px;
  margin: 0 20px;
  background-color: #e5e5ea;
}
.block {
  padding: 16px 20px 0;
}
.h {
  font-size: 22px;
  font-weight: 800;
  color: #000000;
}
.h.pad {
  padding: 22px 20px 10px;
}
.ver {
  margin-top: 6px;
  font-size: 14px;
  color: #8e8e93;
}
.notes {
  margin-top: 10px;
  font-size: 16px;
  color: #1c1c1e;
}
.shots {
  width: 100%;
}
.shots-track {
  flex-direction: row;
  gap: 12px;
  padding: 0 20px;
}
.shot {
  width: 200px;
  height: 400px;
  border-radius: 24px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.shot-emoji {
  font-size: 72px;
  opacity: 0.7;
}
.end {
  height: 30px;
}
.float {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.float-row {
  flex-direction: row;
  justify-content: space-between;
  padding: 8px 16px 0;
}
</style>
