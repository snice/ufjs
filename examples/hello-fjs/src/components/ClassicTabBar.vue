<script setup lang="ts">
// tabbar 风格 "classic"：specs/210 的半透明纯色胶囊（web 端加 backdrop-filter）。
// 与 @ufjs/liquidglass 的风格组件同一份契约：props tabs/active/dark，
// 事件 select(path)，具名插槽 item 画每一项的内容。
import { hasNativeHost } from 'fjs';

defineProps<{
  tabs: { path: string; title: string; tab: number }[];
  active: number | null;
  dark?: boolean;
  accent?: string;
}>();
const emit = defineEmits<{ (e: 'select', path: string): void }>();
</script>

<template>
  <view class="capsule" :class="{ blur: !hasNativeHost, dark }">
    <view
      v-for="(tab, i) in tabs"
      :key="tab.path"
      class="item"
      :class="{ active: active === i }"
      @tap="() => emit('select', tab.path)"
    >
      <slot name="item" :item="tab" :active="active === i" :index="i">
        <text class="label">{{ tab.title }}</text>
      </slot>
    </view>
  </view>
</template>

<style scoped>
.capsule {
  flex-direction: row;
  height: 52px;
  border-radius: 26px;
  background-color: var(--fjs-capsule);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
/* 只有 web 有毛玻璃；样式引擎没这个性质，App 端不挂这个 class */
.capsule.blur {
  backdrop-filter: blur(24px) saturate(180%);
}
.item {
  flex-grow: 1;
  align-items: center;
  justify-content: center;
  gap: 1px;
  /* 颜色沿树继承：选中态只要换 .item 上的 color，图标和文字一起变。
     未选中照 App Store 用近黑的标题色，不用 muted */
  color: var(--fjs-title);
}
.item.active {
  color: var(--fjs-primary);
}
.label {
  font-size: 10px;
}
</style>
