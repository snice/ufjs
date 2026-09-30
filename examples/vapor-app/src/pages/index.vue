<script setup vapor lang="ts">
import { ref } from 'vue'
import { useRouter } from 'fjs/router'

const router = useRouter()
const n = ref(3)
const show = ref(true)
const rows = ref(['a', 'b', 'c'])
const add = () => {
  n.value++
  rows.value.push(`row ${rows.value.length}`)
}
</script>

<template>
  <view class="page">
    <text class="title">vapor home</text>
    <text class="count" @tap="add">{{ n }}</text>
    <text v-if="show" class="hint" @tap="show = false">tap to hide</text>
    <text v-else class="hint" @tap="show = true">tap to show</text>
    <text class="nav" @tap="router.push('/about')">go /about →</text>
    <view v-for="(r, i) in rows" :key="i" class="row">
      <text class="cell">{{ r }} ({{ i }})</text>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 16px; }
.title { font-size: 20px; font-weight: bold; }
.count { font-size: 32px; color: v-bind(n > 5 ? '#e02020' : '#2080f0'); }
.hint { font-size: 13px; opacity: 0.6; }
.nav { font-size: 14px; color: #2080f0; padding: 8px 0; }
.row { flex-direction: row; padding: 4px 0; }
.cell { font-size: 14px; }
</style>
