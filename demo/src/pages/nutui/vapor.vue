<route>
{"title": "nutui: vapor", "group": "NutUI", "desc": "Vue Vapor 页面里用 NutUI 组件（VDOM 互操作）+ Popup 探针"}
</route>

<script setup vapor lang="ts">
// specs/203：这一页是 Vue Vapor 组件（`<script setup vapor>`），NutUI 是编译
// 后的 VDOM 组件库，靠 Vue 的 VDOM ⇄ Vapor 互操作挂载（同 vant/vapor.vue，
// specs/148）。NutUI 没为 Vapor 做任何适配，出问题就是互操作层的缺口。
// Popup 探针：Vapor 树里挂载/卸载一个带遮罩的浮层子树。
import { ref } from 'vue';

const taps = ref(0);
const cellTaps = ref(0);
const on = ref(true);
const stars = ref(4);
const num = ref(5);
const popup = ref(false);
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">nutui · Vapor 页面</text>
    <text class="page-note">本页是 Vapor 组件，NutUI 组件经 VDOM 互操作挂载。</text>

    <view class="block">
      <text class="block-title">Button（点击 {{ taps }} 次）</text>
      <view class="row">
        <nut-button type="primary" @click="taps++">主要</nut-button>
        <nut-button plain type="success" @click="taps += 10">+10</nut-button>
        <nut-button disabled type="primary">禁用</nut-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Cell（点击 {{ cellTaps }} 次）</text>
      <nut-cell-group title="互操作里的 Cell">
        <nut-cell title="单元格" desc="描述文字" @click="cellTaps++" />
        <nut-cell title="开关">
          <nut-switch v-model="on" />
        </nut-cell>
      </nut-cell-group>
    </view>

    <view class="block">
      <text class="block-title">Rate（{{ stars }} 星）</text>
      <nut-rate v-model="stars" />
      <view class="row gap-top">
        <text class="state">InputNumber（{{ num }}）</text>
        <nut-input-number v-model="num" :min="0" :max="10" button-size="18px" />
      </view>
    </view>

    <view class="block">
      <text class="block-title">Popup（{{ popup ? '开' : '关' }}）</text>
      <nut-button type="warning" @click="popup = true">打开浮层</nut-button>
      <nut-popup v-model:visible="popup" :style="{ padding: '40px 60px' }">
        <text>Vapor 树里的 Popup 内容</text>
      </nut-popup>
    </view>

    <view v-if="stars === 5" class="hint">
      <text class="hint-text">5 星时出现（Vapor 的 v-if）</text>
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
.state {
  font-size: 13px;
  color: #333333;
}
.hint {
  padding: 8px 12px;
  background-color: #fff7f0;
  border-radius: 8px;
}
.hint-text {
  font-size: 12px;
  color: #fa6419;
}
</style>
