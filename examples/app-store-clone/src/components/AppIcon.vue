<script setup lang="ts">
// Gradient + emoji stand-in for an app icon. iOS icons are a superellipse
// whose corner radius is ~22.4% of the side; plain border-radius is close
// enough at these sizes.
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ gradient: string; emoji: string; size?: number }>(),
  { size: 60 },
);

const box = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${props.size * 0.224}px`,
  background: props.gradient,
}));
</script>

<template>
  <view class="icon" :style="box">
    <text :style="{ fontSize: `${size * 0.5}px` }">{{ emoji }}</text>
  </view>
</template>

<style scoped>
.icon {
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* a hairline edge like the system icons, so light icons do not melt into white */
  border: 0.5px solid rgba(0, 0, 0, 0.08);
}
</style>
