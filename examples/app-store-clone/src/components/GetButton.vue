<script setup lang="ts">
// The right-hand control of an app row, four states (specs/217 §3.4):
//   none        → grey "获取" pill (+ "App 内购买" caption when the app has IAP)
//   installed   → same pill, "打开"
//   cloud       → blue cloud-download glyph, no pill
//   downloading → progress ring
import { computed } from 'vue';
import { download, installState, progress } from '../store';
import Icon from './Icon.vue';

const props = withDefaults(
  defineProps<{
    id: string;
    inApp?: boolean;
    /** translucent variant for use over a glass strip / photo */
    onGlass?: boolean;
  }>(),
  { inApp: false, onGlass: false },
);

const state = computed(() => installState[props.id] ?? 'none');

// Ring geometry: r = 10 → circumference 62.83. The arc starts at 12 o'clock
// through a transform ATTRIBUTE (supported by the Flutter SVG painter), not
// CSS, so both targets read the same.
const C = 62.83;
const dash = computed(() => `${C * (progress[props.id] ?? 0)} ${C}`);

function tap() {
  if (state.value === 'none' || state.value === 'cloud') download(props.id);
}
</script>

<template>
  <view class="wrap">
    <view v-if="state === 'cloud'" class="cloud" @tap="tap">
      <Icon name="cloud-down" :size="26" color="#0A84FF" />
    </view>
    <view v-else-if="state === 'downloading'" class="ring">
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="10" fill="none" stroke="#D1D1D6" stroke-width="2.5" />
        <circle
          cx="14"
          cy="14"
          r="10"
          fill="none"
          stroke="#0A84FF"
          stroke-width="2.5"
          stroke-linecap="round"
          transform="rotate(-90 14 14)"
          :stroke-dasharray="dash"
        />
      </svg>
    </view>
    <view v-else class="pill" :class="{ glass: onGlass }" @tap="tap">
      <text class="pill-text" :class="{ glass: onGlass }">{{ state === 'installed' ? '打开' : '获取' }}</text>
    </view>
    <text v-if="inApp && state === 'none'" class="caption" :class="{ glass: onGlass }">App 内购买</text>
  </view>
</template>

<style scoped>
.wrap {
  align-items: center;
  flex-shrink: 0;
  min-width: 72px;
}
.pill {
  height: 30px;
  min-width: 72px;
  padding: 0 18px;
  border-radius: 15px;
  background-color: #f2f2f7;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
}
.pill:active {
  transform: scale(0.94);
}
.pill.glass {
  background-color: rgba(255, 255, 255, 0.28);
}
.pill-text {
  font-size: 15px;
  font-weight: 700;
  color: #0a84ff;
}
.pill-text.glass {
  color: #ffffff;
}
.caption {
  margin-top: 3px;
  font-size: 10px;
  color: #8e8e93;
}
.caption.glass {
  color: rgba(255, 255, 255, 0.75);
}
.cloud,
.ring {
  height: 30px;
  align-items: center;
  justify-content: center;
}
</style>
