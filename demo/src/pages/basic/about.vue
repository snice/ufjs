<route>
{"title": "about", "group": "基础能力", "desc": "pinia store 跨页面共享"}
</route>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useCounter } from '@/stores/counter';

// Same store instance as / — on Flutter this page is a separate Vue app,
// so seeing the count carry over is the proof that the Pinia instance in
// src/plugins/pinia.ts is shared rather than per-page.
//
// The direct `pinia` import is the reason package.json lists pinia under
// fjs.shared: without it a --pages build gives this chunk its own copy of
// pinia, with its own activePinia — a different store than the one above.
const counter = useCounter();
const { count } = storeToRefs(counter);
</script>

<template>
  <view class="page">
    <text class="title">about sees count: {{ count }}</text>
    <button class="btn" @tap="counter.inc()">+1 from /basic/about</button>
  </view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出） */
  height: 0px;
  flex-grow: 1;
  align-items: center;
  justify-content: center;
}
.title {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
}
.btn {
  margin-top: 12px;
  padding: 8px 16px;
  background-color: #16a34a;
  color: #ffffff;
  border-radius: 6px;
}
</style>
