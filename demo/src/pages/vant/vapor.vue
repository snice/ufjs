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
// specs/203 batch 2 probes
const tabIndex = ref(0);
const checked = ref(false);
const rate = ref(3);
const popup = ref(false);
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

    <!-- specs/203：以下为第二批追加的互操作探针。Tabs 带滑块定位与多面板
         切换；Popup 带遮罩与 Teleport —— 都是 Vapor 树里挂载/卸载较复杂的
         子树，出问题多半出在互操作层的 unmount/teleport 处理。 -->
    <view class="block">
      <text class="block-title">Tabs（第 {{ tabIndex + 1 }} 个）</text>
      <van-tabs v-model:active="tabIndex">
        <van-tab title="标签一">内容一</van-tab>
        <van-tab title="标签二">内容二</van-tab>
        <van-tab title="标签三">内容三</van-tab>
      </van-tabs>
    </view>

    <view class="block">
      <text class="block-title">Checkbox / Rate（{{ checked ? '勾选' : '未勾' }} · {{ rate }} 星）</text>
      <view class="row">
        <van-checkbox v-model="checked">勾选框</van-checkbox>
        <van-rate v-model="rate" />
      </view>
    </view>

    <view class="block">
      <text class="block-title">Popup（{{ popup ? '开' : '关' }}）</text>
      <van-button type="warning" @click="popup = true">打开浮层</van-button>
      <van-popup v-model:show="popup" :style="{ padding: '40px 60px' }">
        <text>Vapor 树里的 Popup 内容</text>
      </van-popup>
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
