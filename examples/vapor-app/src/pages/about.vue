<script setup vapor lang="ts">
import { useRoute } from 'fjs/router'

const route = useRoute()
</script>

<template>
  <view class="page">
    <text class="title">about</text>
    <text class="path">{{ route.fullPath }}</text>
  </view>
</template>

<style scoped>
.page { padding: 16px; }
.title { font-size: 20px; }
.path { font-size: 13px; opacity: 0.6; }
</style>
