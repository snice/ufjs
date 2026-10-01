<route>
{"title": "关于"}
</route>

<script setup vapor lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRoute } from 'fjs/router'
import { useCounter } from '../stores/counter'

const route = useRoute()
const counter = useCounter()
onMounted(() => console.info('[vapor-app] about mounted'))
onUnmounted(() => console.info('[vapor-app] about unmounted'))
</script>

<template>
  <view class="page">
    <text class="title">about</text>
    <text class="path">{{ route.fullPath }}</text>
    <text class="path">store {{ counter.total }}</text>
  </view>
</template>

<style scoped>
.page { padding: 16px; }
.title { font-size: 20px; }
.path { font-size: 13px; opacity: 0.6; }
</style>
