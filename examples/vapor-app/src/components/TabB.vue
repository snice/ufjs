<script setup lang="ts">
// specs/174: a component kept by <KeepAlive> on the motion page — its
// count survives switching tabs, and the hooks say when it comes and goes
import { ref, onActivated, onDeactivated } from 'vue'

defineOptions({ name: 'TabB' })
const n = ref(0)
onActivated(() => console.info('[vapor-app] TabB activated'))
onDeactivated(() => console.info('[vapor-app] TabB deactivated'))
</script>

<template>
  <view class="tab">
    <text class="label">Tab B · {{ n }}</text>
    <text class="btn" @tap="n++">+1</text>
  </view>
</template>

<style scoped>
.tab { flex-direction: row; align-items: center; padding: 12px; background-color: #f2f3f5; border-radius: 8px; }
.label { flex: 1; font-size: 15px; }
.btn { color: #1989fa; padding: 4px 12px; }
</style>
