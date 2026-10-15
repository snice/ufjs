<script setup lang="ts">
// Rounded search field with a leading magnifier. :value + @input (the fjs
// `input` does not support v-model; the payload is the text as a string).
import Icon from './Icon.vue';

defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <view class="box">
    <Icon name="search" :size="18" color="#8E8E93" />
    <input
      class="field"
      :value="modelValue"
      :placeholder="placeholder ?? '游戏、App、故事等'"
      @input="(t: string) => emit('update:modelValue', t)"
    />
  </view>
</template>

<style scoped>
.box {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 44px;
  margin: 0 20px;
  padding: 0 14px;
  border-radius: 22px;
  background-color: #ffffff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
.field {
  flex-grow: 1;
  width: 0px;
  font-size: 17px;
  color: #000000;
}
</style>
