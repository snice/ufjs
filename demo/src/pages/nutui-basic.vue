<route>
{"title": "nutui: basic", "group": "NutUI", "desc": "Cell / CellGroup / Tag / Divider / Icon"}
</route>

<script setup lang="ts">
// NutUI 基础组件，各取文档基础用法。图标是 @nutui/icons-vue 的内联 SVG
// 组件（<svg viewBox><path fill="currentColor">），color/width/height 走 props。
import { ref } from 'vue';
import { Dongdong, Heart, Location, My, Setting, StarFillN } from '@nutui/icons-vue';

const cellTaps = ref(0);
const tags = ref(['标签一', '标签二', '标签三']);
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">nutui · 基础组件</text>

    <view class="block">
      <text class="block-title">Cell（点击 {{ cellTaps }} 次）</text>
      <nut-cell-group title="基础用法">
        <nut-cell title="我是标题" desc="描述文字" />
        <nut-cell title="我是标题" sub-title="副标题描述" desc="描述文字" />
        <nut-cell title="点击测试" is-link @click="cellTaps++" />
        <nut-cell title="圆角设置 0" round-radius="0" />
      </nut-cell-group>
      <nut-cell-group title="尺寸与对齐">
        <nut-cell title="大尺寸" size="large" desc="描述文字" />
        <nut-cell title="垂直居中" sub-title="副标题描述" desc="描述文字" center />
      </nut-cell-group>
      <nut-cell-group title="自定义图标与内容">
        <nut-cell title="姓名" desc="张三">
          <template #icon><My /></template>
        </nut-cell>
        <nut-cell title="位置" is-link desc="北京">
          <template #icon><Location /></template>
        </nut-cell>
        <nut-cell>
          <text>自定义内容（默认插槽）</text>
        </nut-cell>
      </nut-cell-group>
    </view>

    <view class="block">
      <text class="block-title">Tag</text>
      <view class="row">
        <nut-tag type="primary">主要</nut-tag>
        <nut-tag type="success">成功</nut-tag>
        <nut-tag type="danger">危险</nut-tag>
        <nut-tag type="warning">警告</nut-tag>
        <nut-tag>默认</nut-tag>
      </view>
      <view class="row">
        <nut-tag plain type="primary">空心</nut-tag>
        <nut-tag round type="primary">圆角</nut-tag>
        <nut-tag mark type="primary">标记</nut-tag>
        <nut-tag color="#fa685d">自定义</nut-tag>
        <nut-tag color="#e9e9e9" text-color="#999999">自定义字色</nut-tag>
      </view>
      <view class="row">
        <nut-tag
          v-for="(tag, i) in tags"
          :key="tag"
          closeable
          type="primary"
          @close="tags.splice(i, 1)"
        >
          {{ tag }}
        </nut-tag>
        <text v-if="!tags.length" class="hint">都关掉了</text>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Divider</text>
      <nut-divider />
      <nut-divider>文本</nut-divider>
      <nut-divider content-position="left">文本</nut-divider>
      <nut-divider content-position="right">文本</nut-divider>
      <nut-divider dashed>虚线</nut-divider>
      <nut-divider :style="{ color: '#1989fa', borderColor: '#1989fa', padding: '0 16px' }">
        自定义样式
      </nut-divider>
      <view class="row">
        <text>文本</text>
        <nut-divider direction="vertical" />
        <text>链接</text>
        <nut-divider direction="vertical" />
        <text>链接</text>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Icon</text>
      <view class="row icons">
        <Dongdong />
        <Heart />
        <Setting />
        <StarFillN />
      </view>
      <view class="row icons">
        <Heart color="#fa2c19" />
        <Heart color="#64b578" />
        <Heart color="#ffd700" />
      </view>
      <view class="row icons">
        <Dongdong width="16" height="16" />
        <Dongdong width="24" height="24" />
        <Dongdong width="32" height="32" />
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
  margin-bottom: 8px;
}
.icons {
  gap: 16px;
}
.hint {
  font-size: 12px;
  color: #999999;
}
</style>
