<route>
{"title": "demo"}
</route>

<script setup lang="ts">
// 首页：计数器 + 分类手风琴（同 examples/hello-fjs 首页）。条目来自各页面
// <route> 里的 group，见 src/catalog.ts。计数器留在这里：它和 /basic/about 共用
// 一个 pinia store，是 pinia 在 App 端跨页面共享的回归点。
import { ref } from 'vue';
import { useRouter } from 'fjs/router';
import { useCounter } from '@/stores/counter';
import { catalog } from '@/catalog';

const counter = useCounter();
const router = useRouter();
const groups = catalog();

const open = ref<string | null>(groups[0]?.name ?? null);

function toggle(name: string) {
  open.value = open.value === name ? null : name;
}
</script>

<template>
  <scroll-view class="page">
    <view class="hero">
      <text class="hero-count">count: {{ counter.count }}</text>
      <button class="hero-btn" @tap="counter.inc()">+1</button>
    </view>

    <view v-for="cat in groups" :key="cat.name" class="group">
      <view class="group-head" @tap="() => toggle(cat.name)">
        <text class="group-title">{{ cat.name }}</text>
        <text class="chev">{{ open === cat.name ? '⌃' : '⌄' }}</text>
      </view>

      <view v-if="open === cat.name">
        <view v-for="item in cat.items" :key="item.path">
          <view class="hairline" />
          <view class="item" @tap="() => router.push(item.path)">
            <view class="item-main">
              <text class="item-title">{{ item.title }}</text>
              <text v-if="item.desc" class="item-desc">{{ item.desc }}</text>
            </view>
            <text class="chev">›</text>
          </view>
        </view>
      </view>
    </view>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出） */
  height: 0px;
  flex-grow: 1;
  padding-bottom: 24px;
  background-color: #f5f5f5;
}
.hero {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 24px;
  gap: 16px;
}
.hero-count {
  font-size: 24px;
  font-weight: 700;
  color: #111827;
}
.hero-btn {
  padding: 6px 16px;
  background-color: #2563eb;
  color: #ffffff;
  border-radius: 6px;
}
.group {
  background-color: #ffffff;
  border-radius: 10px;
  margin: 0 12px 12px 12px;
  overflow: hidden;
}
.group-head {
  flex-direction: row;
  align-items: center;
  padding: 16px;
}
.group-title {
  flex-grow: 1;
  font-size: 16px;
  color: #1a1a1a;
}
.chev {
  font-size: 16px;
  color: #c0c0c0;
}
.hairline {
  height: 1px;
  background-color: #f0f0f0;
  margin: 0 16px;
}
.item {
  flex-direction: row;
  align-items: center;
  padding: 12px 16px;
}
.item:active {
  background-color: #f7f7f7;
}
.item-main {
  flex-grow: 1;
  gap: 2px;
}
.item-title {
  font-size: 14px;
  color: #007aff;
}
.item-desc {
  font-size: 12px;
  color: #999999;
}
</style>
