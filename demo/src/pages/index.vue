<route>
{"title": "demo"}
</route>

<script setup lang="ts">
import { useRouter } from 'fjs/router';
import { useCounter } from '@/stores/counter';

const counter = useCounter();
const router = useRouter();
</script>

<template>
  <scroll-view class="page">
    <text class="title">count: {{ counter.count }}</text>
    <button class="btn" @tap="counter.inc()">+1</button>
    <button class="btn" @tap="router.push('/about')">go to /about</button>
    <button class="btn" @tap="router.push('/fetch')">fetch live check</button>
    <button class="btn" @tap="router.push('/icons')">iconmind module</button>
    <button class="btn" @tap="router.push('/drag')">touch: 块拖拽</button>
    <button class="btn" @tap="router.push('/dnd')">touch: 拖拽排序</button>
    <button class="btn" @tap="router.push('/vant-basic')">vant-basic</button>
    <button class="btn" @tap="router.push('/vant-feedback')">vant-feedback</button>
    <button class="btn" @tap="router.push('/vant-form')">vant-form</button>
    <button class="btn" @tap="router.push('/vant-more')">vant-more</button>
    <button class="btn" @tap="router.push('/vant-nav')">vant-nav</button>
    <button class="btn" @tap="router.push('/vant-float')">vant-float</button>
    <button class="btn" @tap="router.push('/vant-watermark')">vant-watermark</button>
  </scroll-view>
</template>

<style scoped>
.page {
  flex-grow: 1;
  padding: 24px 16px;
  background-color: #ffffff;
}
.title {
  font-size: 24px;
  font-weight: 700;
  color: #111827;
}
.btn {
  margin-top: 12px;
  padding: 8px 16px;
  background-color: #2563eb;
  color: #ffffff;
  border-radius: 6px;
}
</style>
