<route>
{"title": "nutui: nav", "group": "NutUI", "desc": "Grid / Tabs / Steps / Pagination / Swiper"}
</route>

<script setup lang="ts">
// NutUI 导航/布局类组件。specs/203：Swiper 是触摸手势 + transform 的组合
// 探针，Tabs 是「多面板 + 滑块定位」探针，都是 App 端易出差异的类目。
import { ref } from 'vue';
import { Dongdong } from '@nutui/icons-vue';

const tab = ref(0);
const page = ref(1);
const swiperIndex = ref(0);

const slides = ['第一屏', '第二屏', '第三屏'];
function onChange(i: number): void {
  swiperIndex.value = i;
}
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">nutui · 导航</text>

    <view class="block">
      <text class="block-title">Grid</text>
      <nut-grid :column-num="3" border>
        <nut-grid-item text="文字"><Dongdong /></nut-grid-item>
        <nut-grid-item text="文字"><Dongdong /></nut-grid-item>
        <nut-grid-item text="文字"><Dongdong /></nut-grid-item>
      </nut-grid>
    </view>

    <view class="block">
      <text class="block-title">Tabs（第 {{ tab + 1 }} 个）</text>
      <nut-tabs v-model="tab">
        <nut-tab-pane title="标签一" pane-key="0">内容一</nut-tab-pane>
        <nut-tab-pane title="标签二" pane-key="1">内容二</nut-tab-pane>
        <nut-tab-pane title="标签三" pane-key="2">内容三</nut-tab-pane>
      </nut-tabs>
    </view>

    <view class="block">
      <text class="block-title">Steps</text>
      <nut-steps :current="2">
        <nut-step title="步骤一">一</nut-step>
        <nut-step title="步骤二">二</nut-step>
        <nut-step title="步骤三">三</nut-step>
      </nut-steps>
    </view>

    <view class="block">
      <text class="block-title">Pagination（第 {{ page }} 页）</text>
      <nut-pagination v-model="page" :total-items="25" :items-per-page="5" />
    </view>

    <view class="block">
      <text class="block-title">Swiper（第 {{ swiperIndex + 1 }} 屏）</text>
      <!-- width/height props：挂载帧读 rect 还是 0（specs/150 同款首帧问题），
           props 优先于测量，两端一致；334 = 390 - 页面 32 - 卡片 24 -->
      <nut-swiper :auto-play="0" :width="334" :height="124" @change="onChange">
        <nut-swiper-item v-for="s in slides" :key="s">
          <view class="slide"><text class="slide-text">{{ s }}</text></view>
        </nut-swiper-item>
      </nut-swiper>
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
.slide {
  height: 120px;
  align-items: center;
  justify-content: center;
  background-color: #fa2c19;
  border-radius: 8px;
  margin: 2px;
}
.slide-text {
  color: #ffffff;
  font-size: 18px;
  font-weight: 700;
}
</style>
