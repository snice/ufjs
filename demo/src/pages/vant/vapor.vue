<route>
{"title": "vant: Vapor 页", "group": "Vant", "desc": "Vue Vapor 页面里用 vant 组件（VDOM 互操作）"}
</route>

<script setup vapor lang="ts">
// specs/148：这一页是 Vue Vapor 组件（`<script setup vapor>`），vant 是编译后
// 的 VDOM 组件库，靠 Vue 的 VDOM ⇄ Vapor 互操作挂在这里——不需要为 vant
// 做任何适配。按钮 / 单元格的点击、Stepper 的 v-model、Switch 都走一遍。
import { ref } from 'vue';

const taps = ref(0);
const cellTaps = ref(0);
const count = ref(1);
const on = ref(true);
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · Vapor 页面</text>
    <text class="page-note">本页是 Vapor 组件，vant 组件经 VDOM 互操作挂载。</text>

    <view class="block">
      <text class="block-title">Button（点击 {{ taps }} 次）</text>
      <view class="row">
        <van-button type="primary" @click="taps++">主要</van-button>
        <van-button plain type="success" @click="taps += 10">+10</van-button>
        <van-button disabled type="primary">禁用</van-button>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Cell（点击 {{ cellTaps }} 次）</text>
      <van-cell-group inset>
        <van-cell title="单元格" value="值" label="描述信息" is-link @click="cellTaps++" />
        <van-cell title="开关">
          <template #right-icon>
            <van-switch v-model="on" size="20px" />
          </template>
        </van-cell>
      </van-cell-group>
      <text class="state">开关：{{ on ? '开' : '关' }}</text>
    </view>

    <view class="block">
      <text class="block-title">Stepper（{{ count }}）</text>
      <van-stepper v-model="count" />
      <view v-if="count > 3" class="hint"><text class="hint-text">大于 3 时出现（Vapor 的 v-if）</text></view>
    </view>
  </scroll-view>
</template>

<style scoped>
.page {
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
.row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}
.state {
  margin-top: 8px;
  font-size: 13px;
  color: #323233;
}
.hint {
  margin-top: 8px;
}
.hint-text {
  font-size: 12px;
  color: #ee0a24;
}
</style>
