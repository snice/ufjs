<script setup vapor lang="ts">
// the drag page's shape: every frame one dragged cell moves (dx / dy), the
// rest answer with their own computed style object (same as dnd.vue itemStyle)
const props = defineProps<{ dx: number; dy: number; from: number }>();
function itemStyle(index: number): Record<string, unknown> {
  if (index === props.from) {
    return { transform: `translate(${props.dx}px, ${props.dy}px) scale(1.06)`, transition: 'none', opacity: 0.96 };
  }
  return {};
}
</script>

<template>
  <view>
    <view v-for="i in 9" :key="i" class="cell" :style="itemStyle(i - 1)">
      <text>{{ i }}</text>
    </view>
  </view>
</template>

<style scoped>
.cell { width: 96px; height: 96px; }
</style>
