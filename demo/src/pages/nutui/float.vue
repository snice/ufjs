<route>
{"title": "nutui: float", "group": "NutUI", "desc": "Popup / Overlay / Toast（命令式）/ Dialog（命令式）"}
</route>

<script setup lang="ts">
// NutUI 浮层类。specs/203：命令式 Toast/Dialog 走 createApp/teleport 路径
// （specs/137 处理过 vant 的同类问题），App 端表现是本页的探针；遮罩上的
// 点击、锁定滚动在两端都要过一遍。
import { ref } from 'vue';
import { showDialog } from '@nutui/nutui/dist/packages/dialog/index.mjs';
import { showToast } from '@nutui/nutui/dist/packages/toast/index.mjs';

const popup = ref(false);
const popupBottom = ref(false);
const overlay = ref(false);

function openDialog(): void {
  showDialog({
    title: '确认删除',
    content: '删除后不可恢复，确定吗？',
    onOk: () => showToast.text('已删除'),
    onCancel: () => showToast.text('已取消'),
  });
}
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">nutui · 浮层</text>
    <text class="page-note">命令式 Toast / Dialog 由 JS 直接挂载，不经过页面树。</text>

    <view class="block">
      <text class="block-title">Popup（中部，点击遮罩关闭）</text>
      <nut-button type="primary" @click="popup = true">打开 Popup</nut-button>
      <nut-popup v-model:visible="popup" :style="{ padding: '40px 60px' }">
        <text>中部弹出内容</text>
      </nut-popup>
    </view>

    <view class="block">
      <text class="block-title">Popup（底部）</text>
      <nut-button type="success" @click="popupBottom = true">底部弹出</nut-button>
      <nut-popup v-model:visible="popupBottom" position="bottom" :style="{ padding: '40px 16px' }">
        <text>底部弹出内容</text>
      </nut-popup>
    </view>

    <view class="block">
      <text class="block-title">Overlay</text>
      <nut-button type="warning" @click="overlay = true">打开遮罩</nut-button>
      <nut-overlay v-model:visible="overlay" :z-index="100">
        <text class="overlay-text">这里是遮罩上的文字</text>
      </nut-overlay>
    </view>

    <view class="block">
      <text class="block-title">Toast（命令式）</text>
      <view class="row">
        <nut-button @click="showToast.text('普通文本')">文本</nut-button>
        <nut-button type="success" @click="showToast.success('成功')">成功</nut-button>
        <nut-button type="danger" @click="showToast.fail('失败')">失败</nut-button>
        <nut-button type="info" @click="showToast.loading('加载中')">加载</nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Dialog（命令式）</text>
      <nut-button type="primary" @click="openDialog">确认对话框</nut-button>
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
.overlay-text {
  color: #ffffff;
  font-size: 16px;
}
</style>
