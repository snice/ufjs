<route>
{"title": "Vapor 首页"}
</route>

<script setup vapor lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'fjs/router'
import { useCounter } from '../stores/counter'

const router = useRouter()
const counter = useCounter()
const n = ref(3)
const show = ref(true)
const rows = ref(['a', 'b', 'c'])
const add = () => {
  n.value++
  rows.value.push(`row ${rows.value.length}`)
  counter.add()
}
// lifecycle in a vapor page (specs/167): the timer starts once the page is
// on screen and stops when the page goes away
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  counter.mounted = true
  timer = setInterval(() => counter.tick(), 1000)
  console.info('[vapor-app] index mounted, timer started')
})
onUnmounted(() => {
  clearInterval(timer)
  console.info('[vapor-app] index unmounted, timer cleared')
})
</script>

<template>
  <view class="page">
    <text class="title">vapor home</text>
    <text class="count" @tap="add">{{ n }}</text>
    <text v-if="show" class="hint" @tap="show = false">tap to hide</text>
    <text v-else class="hint" @tap="show = true">tap to show</text>
    <text class="store">store {{ counter.total }} · ticks {{ counter.ticks }}</text>
    <text class="nav" @tap="router.push('/about')">go /about →</text>
    <text class="nav form-link" @tap="router.push('/controls')">表单控件 →</text>
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
.store { font-size: 13px; }
.nav { font-size: 14px; color: #2080f0; padding: 8px 0; }
.row { flex-direction: row; padding: 4px 0; }
.cell { font-size: 14px; }
</style>
