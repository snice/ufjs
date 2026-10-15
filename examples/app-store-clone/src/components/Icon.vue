<script setup lang="ts">
// Hand-drawn inline SVG glyphs. @ufjs/iconmind has no newspaper / rocket /
// stack / gamepad (it is an AI-themed set), so the handful of icons this app
// needs are paths here. Only solid colors and plain `d` strings: gradients
// (`url(#…)`) do not render in the Flutter SVG painter (css-compat.md).
import { computed } from 'vue';

export type IconName =
  | 'today'
  | 'games'
  | 'apps'
  | 'arcade'
  | 'search'
  | 'cloud-down'
  | 'share'
  | 'back'
  | 'close'
  | 'star'
  | 'chevron';

const props = withDefaults(defineProps<{ name: IconName; size?: number; color?: string }>(), {
  size: 24,
  color: '#000000',
});

// 24x24 viewBox. `stroke` glyphs are outlines, `fill` glyphs are solid.
const GLYPHS: Record<IconName, { d: string; mode: 'stroke' | 'fill' }[]> = {
  today: [
    { d: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', mode: 'fill' },
  ],
  games: [
    {
      d: 'M12 2c3 2 5 5 5 9l2 3-3 1-1 3h-6l-1-3-3-1 2-3c0-4 2-7 5-9zM12 9a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 12 9z',
      mode: 'fill',
    },
  ],
  apps: [
    { d: 'M12 3l9 4.5-9 4.5-9-4.5L12 3z', mode: 'fill' },
    { d: 'M3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5', mode: 'stroke' },
  ],
  arcade: [
    { d: 'M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z', mode: 'fill' },
    { d: 'M11 9h2v4h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h5V9z', mode: 'fill' },
  ],
  search: [{ d: 'M10.5 3a7.5 7.5 0 1 0 4.4 13.6l4.3 4.3 1.4-1.4-4.3-4.3A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z', mode: 'fill' }],
  'cloud-down': [
    { d: 'M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17.5 18', mode: 'stroke' },
    { d: 'M12 11v8m-3-3l3 3 3-3', mode: 'stroke' },
  ],
  share: [{ d: 'M12 15V3m0 0L8 7m4-4l4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1', mode: 'stroke' }],
  back: [{ d: 'M15 4l-8 8 8 8', mode: 'stroke' }],
  close: [{ d: 'M6 6l12 12M18 6L6 18', mode: 'stroke' }],
  star: [{ d: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9L12 2.5z', mode: 'fill' }],
  chevron: [{ d: 'M9 5l7 7-7 7', mode: 'stroke' }],
};

const glyphs = computed(() => GLYPHS[props.name]);
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" :style="{ color }">
    <path
      v-for="(g, i) in glyphs"
      :key="i"
      :d="g.d"
      :fill="g.mode === 'fill' ? 'currentColor' : 'none'"
      :stroke="g.mode === 'stroke' ? 'currentColor' : 'none'"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
