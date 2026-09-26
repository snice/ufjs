<route>
{"title": "vant: basic", "group": "Vant", "desc": "Button / Tag / Cell / Divider / Grid / Badge"}
</route>

<script setup lang="ts">
import { ref } from 'vue';

const cellTaps = ref(0);
const submitting = ref(false);
function fakeSubmit(): void {
  if (submitting.value) return;
  submitting.value = true;
  setTimeout(() => (submitting.value = false), 2000);
}
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · 基础展示</text>
    <text class="page-note">vant 样式两端都打包；App 端伪元素（发丝线、图标字形）由 CSS 引擎合成，图标字体经 @font-face 加载。</text>

    <view class="block">
      <text class="block-title">Button</text>
      <view class="row">
        <van-button type="primary">主要</van-button>
        <van-button type="success">成功</van-button>
        <van-button type="danger">危险</van-button>
      </view>
      <view class="row">
        <van-button plain type="primary">朴素</van-button>
        <van-button round type="primary">圆形</van-button>
        <van-button disabled type="primary">禁用</van-button>
      </view>
      <view class="row">
        <van-button loading type="primary" loading-text="加载中" />
        <van-button size="large" type="primary">块级按钮</van-button>
      </view>
      <view class="row">
        <van-button :loading="submitting" type="primary" loading-text="提交中" @click="fakeSubmit">
          点击提交
        </van-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Tag</text>
      <view class="row">
        <van-tag type="primary">主</van-tag>
        <van-tag type="success">成</van-tag>
        <van-tag type="danger">危</van-tag>
        <van-tag plain type="primary">朴素</van-tag>
        <van-tag round type="warning">圆角</van-tag>
        <van-tag mark type="primary">标记</van-tag>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Cell（点击 {{ cellTaps }} 次）</text>
      <van-cell-group inset>
        <van-cell title="单元格" value="值" label="描述信息" is-link @click="cellTaps++" />
        <van-cell title="跳转样式" value="is-link" is-link />
        <van-cell title="垂直居中" value="center" center />
      </van-cell-group>
    </view>

    <!-- 首屏以下：页面转场结束后才挂（specs/118）。占位高度约等于这几块的总高，
         内容补上时滚动条不跳。 -->
    <defer placeholder-height="500">
      <view class="block">
        <text class="block-title">Divider</text>
        <van-divider>默认文字</van-divider>
        <van-divider dashed :hairline="false" content-position="left">虚线·左</van-divider>
        <van-divider :hairline="false">粗线</van-divider>
      </view>

      <view class="block">
        <text class="block-title">Grid（图标来自 @font-face 字体）</text>
        <van-grid :column-num="3" :border="true">
          <van-grid-item icon="home-o" text="首页" />
          <van-grid-item icon="search" text="搜索" />
          <van-grid-item icon="setting-o" text="设置" />
        </van-grid>
        <text class="block-sub">正方形格子（square，padding-top 百分比撑高）</text>
        <van-grid square :column-num="4" class="square-grid">
          <van-grid-item v-for="i in 8" :key="i" icon="photo-o" text="文字" />
        </van-grid>
      </view>

      <view class="block">
        <text class="block-title">Badge（依赖 absolute 定位）</text>
        <view class="row">
          <van-badge :content="5">
            <van-button type="primary">消息</van-button>
          </van-badge>
          <van-badge dot>
            <van-button>红点</van-button>
          </van-badge>
        </view>
      </view>
    </defer>
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
  color: #323233;
  margin-bottom: 4px;
}
.page-note {
  font-size: 12px;
  color: #969799;
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
  color: #646566;
  margin-bottom: 8px;
}
.block-sub {
  font-size: 12px;
  color: #969799;
  margin: 12px 0 8px;
}
.row {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
