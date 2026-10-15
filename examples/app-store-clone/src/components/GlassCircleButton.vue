<script setup lang="ts">
// Floating round button (close / back / share) with a glass face. `tone`
// "red" is the detail page's back button; the glass layer is a leaf under the
// glyph (specs/212 §3.1).
import Icon, { type IconName } from './Icon.vue';

withDefaults(
  defineProps<{ icon: IconName; tone?: 'glass' | 'red'; size?: number }>(),
  { tone: 'glass', size: 36 },
);
const emit = defineEmits<{ tap: [] }>();
</script>

<template>
  <view
    class="btn"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${size / 2}px` }"
    @tap="emit('tap')"
  >
    <view v-if="tone === 'red'" class="fill red" />
    <glass-surface v-else class="fill" :radius="size / 2" :blur="16" :refraction="0.3" :dark="false" />
    <!-- the glyph is ABSOLUTE like the fill, not a flow child: on both targets an
         absolutely positioned box paints over in-flow siblings (CSS stacking on web;
         the App stacks positioned children above flow content), so a flow glyph
         ends up under the glass / red fill. Two absolutes stack in DOM order. -->
    <view class="glyph">
      <Icon :name="icon" :size="size * 0.5" :color="tone === 'red' ? '#FFFFFF' : '#1A1A1A'" />
    </view>
  </view>
</template>

<style scoped>
.btn {
  position: relative;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
}
.btn:active {
  transform: scale(0.92);
}
.fill {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  border-radius: 999px;
}
.glyph {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  align-items: center;
  justify-content: center;
}
.red {
  background-color: #ff2d55;
}
</style>
