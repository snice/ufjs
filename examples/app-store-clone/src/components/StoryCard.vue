<script setup lang="ts">
// Today's big story card: full-bleed artwork, a gradient scrim carrying the
// kicker / headline / subtitle, and a glass strip at the bottom with the
// featured app.
//
// The glass layer is a <glass-surface> LEAF positioned absolutely under its
// siblings (specs/212 §3.1) — never put the text inside it. Radius is written
// on the glass and on the clipping box on purpose: they must be the same number.
import { appById } from '../data/apps';
import type { Story } from '../data/stories';
import AppIcon from './AppIcon.vue';
import GetButton from './GetButton.vue';

const props = defineProps<{ story: Story }>();
const emit = defineEmits<{ open: [] }>();
const app = appById(props.story.appIds[0]!);
</script>

<template>
  <view class="card" :style="{ background: story.gradient }">
    <!-- tap target for "expand": a SIBLING under the strip, not a wrapper around
         the card, so a tap on the Get button (above it) never reaches it and
         no `.stop` modifier is needed -->
    <view class="hit" @tap="emit('open')" />
    <text class="emoji">{{ story.emoji }}</text>
    <view class="scrim" />
    <view class="copy">
      <text class="kicker">{{ story.kicker }}</text>
      <text class="title">{{ story.title }}</text>
      <text class="sub">{{ story.subtitle }}</text>
    </view>
    <view v-if="app" class="strip">
      <glass-surface class="glass" :radius="0" :blur="20" :refraction="0" :dark="true" tint="rgba(20,20,30,0.35)" />
      <view class="strip-row">
        <view class="strip-main" @tap="emit('open')">
          <AppIcon :gradient="app.gradient" :emoji="app.emoji" :size="48" />
          <view class="strip-text">
            <text class="strip-name">{{ app.name }}</text>
            <text class="strip-sub">{{ app.subtitle }}</text>
          </view>
        </view>
        <GetButton :id="app.id" :in-app="app.inApp" :on-glass="true" />
      </view>
    </view>
  </view>
</template>

<style scoped>
.card {
  height: 430px;
  border-radius: 20px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  /* press feedback: shrink while held, spring back on release */
  transition: transform 0.2s;
}
.card:active {
  transform: scale(0.96);
}
.hit {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
}
.emoji {
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 150px;
  /* decorative: let the tap through to .hit */
  pointer-events: none;
}
.scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 250px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.55));
  pointer-events: none;
}
.copy {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 96px;
  pointer-events: none;
}
.kicker {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.78);
}
.title {
  margin-top: 4px;
  font-size: 28px;
  font-weight: 800;
  color: #ffffff;
}
.sub {
  margin-top: 4px;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.82);
  max-lines: 2;
  overflow: ellipsis;
}
.strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 76px;
}
.glass {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
}
.strip-row {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}
.strip-main {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  flex-grow: 1;
  flex-shrink: 1;
  width: 0px;
}
.strip-text {
  flex-grow: 1;
  flex-shrink: 1;
  width: 0px;
}
.strip-name {
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
  max-lines: 1;
  overflow: ellipsis;
}
.strip-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  max-lines: 1;
  overflow: ellipsis;
}
</style>
