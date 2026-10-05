<script setup lang="ts">
// 演示小节：灰色标题 + 白色卡片，详情页里反复使用。
// fill：整节撑满父容器剩余高度（全屏列表 / 画布演示用）。撑满样式必须
// 长在组件自己的模板里——skyline 下页面样式进不了组件模板、组件标签上的
// class 也穿不进组件根（specs/046 T041/T047），页面级的 :deep 与 class
// 穿透在 mp 上全是静默 no-op（specs/209），只能走属性开关。
defineProps<{ title?: string; desc?: string; fill?: boolean }>();
</script>

<template>
  <view class="section" :class="{ 'section--fill': fill }">
    <text v-if="title" class="section-title">{{ title }}</text>
    <text v-if="desc" class="section-desc">{{ desc }}</text>
    <view class="card" :class="{ 'card--fill': fill }">
      <slot />
    </view>
  </view>
</template>

<style scoped>
.section {
  margin: 16px 12px 0 12px;
}
.section-title {
  font-size: 13px;
  color: var(--fjs-muted);
  margin: 0 4px 4px 4px;
}
.section-desc {
  font-size: 12px;
  color: var(--fjs-faint);
  margin: 0 4px 8px 4px;
}
.card {
  background-color: var(--fjs-card);
  border-radius: 10px;
  padding: 16px;
  gap: 12px;
}
/* 撑满链的每一环：section 在页面根里长高，card 在 section 里长高，
   再由 slot 里的内容（如 .list）用 flex-grow 接走剩余高度。 */
.section--fill {
  flex-grow: 1;
  flex-basis: 0%;
  min-height: 0;
}
.card--fill {
  flex-grow: 1;
  flex-basis: 0%;
}
</style>
