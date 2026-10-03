<route>
{"title": "nutui: display", "group": "NutUI", "desc": "Badge / Progress / CircleProgress / Skeleton / Empty / Noticebar / Image / CountDown"}
</route>

<script setup lang="ts">
// NutUI 展示类组件。specs/203：Noticebar 是 rAF 驱动的跑马灯、CircleProgress
// 是 SVG stroke-dasharray —— 两者都是引擎适配的重点探针。
import { onUnmounted, ref } from 'vue';
import { Dongdong } from '@nutui/icons-vue';

const progress = ref(30);
const circle = ref(25);
const imgFailed = ref(false);

const timer = setInterval(() => {
  progress.value = progress.value >= 100 ? 0 : progress.value + 10;
  circle.value = circle.value >= 100 ? 0 : circle.value + 25;
}, 2000);
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">nutui · 展示</text>
    <text class="page-note">Progress / CircleProgress 每 2s 自增，跑马灯与 SVG 圆环在两端的行为是本页重点。</text>

    <view class="block">
      <text class="block-title">Badge</text>
      <view class="row">
        <nut-badge :value="8"><Dongdong /></nut-badge>
        <nut-badge :value="76"><Dongdong /></nut-badge>
        <nut-badge dot><Dongdong /></nut-badge>
        <nut-badge value="NEW"><nut-button size="small" type="success">标签</nut-button></nut-badge>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Progress（{{ progress }}%）</text>
      <nut-progress :percentage="progress" />
      <nut-progress :percentage="progress" stroke-color="linear-gradient(270deg, #fa2c19, #fa6419)" status="active" />
    </view>

    <view class="block">
      <text class="block-title">CircleProgress（{{ circle }}%）</text>
      <view class="row">
        <nut-circle-progress :progress="circle" />
        <nut-circle-progress :progress="circle" path-color="#ffece8" />
      </view>
    </view>

    <view class="block">
      <text class="block-title">Skeleton</text>
      <nut-skeleton width="60px" height="15px" round animated />
      <nut-skeleton width="100%" height="15px" row="3" title animated />
    </view>

    <view class="block">
      <text class="block-title">Empty</text>
      <nut-empty description="无数据" />
    </view>

    <view class="block">
      <text class="block-title">Noticebar</text>
      <nut-noticebar text="华为畅享10 plus 抢先购，最高直降 200 元；爆款手机限时秒杀。" :scrollable="true" />
      <nut-noticebar text="这是一条不会滚动的公告，closeable。" :scrollable="false" close-mode />
    </view>

    <view class="block">
      <text class="block-title">Image（加载失败 {{ imgFailed ? '已' : '未' }}触发）</text>
      <view class="row">
        <nut-image src="https://img13.360buyimg.com/imagetools/jfs/t1/216359/7/6117/17547/61ca54f3E6d2d1e0c/e0b99fc7b6a9d0e6.png" width="90" height="90" fit="cover" radius="8" />
        <nut-image src="https://invalid.example/x.png" width="90" height="90" fit="cover" radius="8" @error="imgFailed = true" />
      </view>
    </view>

    <view class="block">
      <text class="block-title">CountDown</text>
      <nut-countdown :end-time="Date.now() + 90 * 60 * 1000" />
    </view>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出） */
  height: 0px;
  flex-grow: 1;
  padding: 16px;
  background-color: #f7f8fa;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 4px;
}
.page-note {
  font-size: 12px;
  color: #909ca4;
  margin-bottom: 12px;
}
.block {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.block-title {
  font-size: 14px;
  font-weight: 600;
  color: #666666;
  margin-bottom: 8px;
}
.row {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
