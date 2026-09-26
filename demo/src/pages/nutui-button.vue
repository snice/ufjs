<route>
{"title": "nutui: button", "group": "NutUI", "desc": "类型 / 朴素 / 禁用 / 形状 / 加载 / 图标 / 尺寸 / 块级 / 自定义颜色"}
</route>

<script setup lang="ts">
// NutUI Button 文档页（nutui.jd.com/h5/vue/4x/#/zh-CN/component/button）的
// 示例，一节一块。按钮是 inline-block，并排交给 .row 的 flex 换行，
// 两端不依赖行内盒排版。
import { ref } from 'vue';
import { Plus, Star } from '@nutui/icons-vue';

const taps = ref(0);
const submitting = ref(false);
function fakeSubmit(): void {
  if (submitting.value) return;
  submitting.value = true;
  setTimeout(() => (submitting.value = false), 2000);
}
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">nutui · Button</text>
    <text class="page-note">样式取 NutUI 各组件自带的 style/css.mjs；图标是 @nutui/icons-vue 的内联 SVG。</text>

    <view class="block">
      <text class="block-title">按钮类型（点击 {{ taps }} 次）</text>
      <view class="row">
        <nut-button type="primary" @click="taps++">主要按钮</nut-button>
        <nut-button type="info" @click="taps++">信息按钮</nut-button>
        <nut-button type="default" @click="taps++">默认按钮</nut-button>
      </view>
      <view class="row">
        <nut-button type="danger">危险按钮</nut-button>
        <nut-button type="warning">警告按钮</nut-button>
        <nut-button type="success">成功按钮</nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">朴素按钮</text>
      <view class="row">
        <nut-button plain type="primary">朴素按钮</nut-button>
        <nut-button plain type="info">朴素按钮</nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">禁用状态</text>
      <view class="row">
        <nut-button disabled type="primary">禁用状态</nut-button>
        <nut-button plain disabled type="info">禁用状态</nut-button>
        <nut-button plain disabled type="primary">禁用状态</nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">按钮形状</text>
      <view class="row">
        <nut-button shape="square" type="primary">方形按钮</nut-button>
        <nut-button type="info">圆形按钮</nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">加载状态</text>
      <view class="row">
        <nut-button loading type="info" />
        <nut-button loading type="warning">加载中...</nut-button>
        <nut-button :loading="submitting" type="success" @click="fakeSubmit">点击提交</nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">图标按钮</text>
      <view class="row">
        <nut-button shape="square" plain type="primary">
          <template #icon><Star /></template>
        </nut-button>
        <nut-button shape="square" type="primary">
          <template #icon><Star /></template>
          收藏
        </nut-button>
        <nut-button type="info">
          <template #icon><Plus /></template>
          新增
        </nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">按钮尺寸</text>
      <nut-button size="large" type="primary">大号按钮</nut-button>
      <view class="row gap-top">
        <nut-button type="primary">普通按钮</nut-button>
        <nut-button size="small" type="primary">小型按钮</nut-button>
        <nut-button size="mini" type="primary">迷你按钮</nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">块级元素</text>
      <nut-button block type="primary">块级元素</nut-button>
    </view>

    <view class="block">
      <text class="block-title">自定义颜色</text>
      <view class="row">
        <nut-button color="#7232dd">单色按钮</nut-button>
        <nut-button color="#7232dd" plain>单色按钮</nut-button>
        <nut-button color="linear-gradient(to right, #ff6034, #ee0a24)">渐变色按钮</nut-button>
      </view>
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
.gap-top {
  margin-top: 8px;
}
</style>
