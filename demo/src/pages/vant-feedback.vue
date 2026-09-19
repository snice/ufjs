<route>
{"title": "vant: feedback"}
</route>

<script setup lang="ts">
import { ref } from 'vue';
import { showToast, showConfirmDialog, type ActionSheetAction } from 'vant';

// ---- component-form overlays -----------------------------------------------

const showPopup = ref(false);
const showSheet = ref(false);
const showDialog = ref(false);
const sheetPicked = ref('');
const dialogResult = ref('');

const actions = [
  { name: '选项一' },
  { name: '选项二' },
  { name: '选项三（禁用）', disabled: true },
];

function onSheetSelect(_action: ActionSheetAction, index: number) {
  sheetPicked.value = `选中第 ${index + 1} 项`;
  showSheet.value = false;
}

// ---- imperative calls, self-reporting --------------------------------------
//
// Vant's function-call overlays do `document.createElement` to mount, which
// cannot exist on the QuickJS side — this page is the probe: each call
// reports what actually happened instead of failing silently.

interface Probe {
  name: string;
  ok: boolean;
  detail: string;
}

const probes = ref<Probe[]>([]);

function record(name: string, ok: boolean, detail: string) {
  probes.value = [...probes.value.filter((p) => p.name !== name), { name, ok, detail }];
}

function probeToast() {
  try {
    const toast = showToast('来自 showToast') as { open?: unknown } | undefined;
    // vant 在非浏览器环境（没有 window）下直接 return {}，不抛错——调用
    // 「成功」但什么都没发生。用返回值有没有 open() 把这件事拆穿。
    if (typeof toast?.open !== 'function') {
      record('showToast', false, 'vant 检测到非浏览器环境，命令式 Toast 是空操作（无 DOM 挂载点）');
      return;
    }
    record('showToast', true, '调用成功（看屏幕上是否真有 Toast）');
  } catch (e) {
    record('showToast', false, String(e));
  }
}

function probeDialog() {
  try {
    showConfirmDialog({ title: '确认', message: '命令式 Dialog' })
      .then((action) => {
        // 非浏览器环境下 vant 返回 Promise.resolve(undefined)：没弹窗、
        // 也没人点按钮，action 是 undefined。
        if (action === undefined) {
          record('showConfirmDialog', false, 'vant 检测到非浏览器环境，命令式 Dialog 是空操作');
        } else {
          record('showConfirmDialog', true, '已确认');
        }
      })
      .catch((action) => {
        record('showConfirmDialog', true, action === 'confirm' ? '已确认' : '已取消');
      });
  } catch (e) {
    record('showConfirmDialog', false, String(e));
  }
}
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · 弹层反馈</text>
    <text class="page-note">
      命令式 Toast/Dialog 依赖 DOM，
      预期报错并显示在页面上。
    </text>

    <view class="block">
      <text class="block-title">组件式弹层（v-model:show）</text>
      <view class="row">
        <van-button type="primary" @click="showPopup = true">Popup</van-button>
        <van-button type="primary" @click="showSheet = true">ActionSheet</van-button>
        <van-button type="primary" @click="showDialog = true">Dialog</van-button>
      </view>
      <text v-if="sheetPicked" class="echo">action-sheet：{{ sheetPicked }}</text>
      <text v-if="dialogResult" class="echo">dialog：{{ dialogResult }}</text>
    </view>

    <van-popup v-model:show="showPopup" position="bottom" round :style="{ padding: '24px' }">
      <text class="popup-text">底部弹层内容</text>
      <van-button block type="primary" @click="showPopup = false">关闭</van-button>
    </van-popup>

    <van-action-sheet
      v-model:show="showSheet"
      :actions="actions"
      cancel-text="取消"
      @select="onSheetSelect"
    />

    <van-dialog
      v-model:show="showDialog"
      title="组件式 Dialog"
      message="v-model:show 控制开关"
      show-cancel-button
      @confirm="dialogResult = '确认'"
      @cancel="dialogResult = '取消'"
    />

    <view class="block">
      <text class="block-title">命令式调用（结果自证）</text>
      <view class="row">
        <van-button type="warning" @click="probeToast">showToast</van-button>
        <van-button type="warning" @click="probeDialog">showConfirmDialog</van-button>
      </view>
      <view v-for="p in probes" :key="p.name" class="probe">
        <text class="probe-line" :class="p.ok ? 'probe-ok' : 'probe-fail'">
          {{ p.ok ? '✅' : '❌' }} {{ p.name }} — {{ p.detail }}
        </text>
      </view>
      <text v-if="probes.length === 0" class="echo">点上面的按钮跑探针。</text>
    </view>

    <!-- 垫底内容：页面超过一屏才能验收「弹层打开时滚动页面，遮罩与弹层不动」
         （specs/069 验收第 3 条；此前页面不足一屏，该条只在结构上成立）。 -->
    <view class="block">
      <text class="block-title">滚动填充</text>
      <text class="echo">1. 先点上面的 Popup 打开弹层。</text>
      <text class="echo">2. 再滚动本页：遮罩和弹层应钉在屏幕上不动。</text>
      <text class="echo">3. 点遮罩或「关闭」，页面应恢复原位。</text>
    </view>
    <view class="block">
      <text class="echo">填充行 A —— 底部还有内容，页面可以滚动。</text>
      <text class="echo">填充行 B —— 遮罩不动、内容动，就是 overlay 置顶生效。</text>
      <text class="echo">填充行 C —— 滚到这条时弹层应该依然贴着屏幕底。</text>
      <text class="echo">填充行 D —— 页面必须超过一屏，滚动验收才成立。</text>
      <text class="echo">填充行 E —— 开着弹层滚到这里，弹层仍应钉在屏幕底。</text>
      <text class="echo">填充行 F —— 遮罩压暗的应是整个屏幕，不是这一屏的内容。</text>
    </view>
    <view class="block">
      <text class="echo">填充行 G —— 关掉弹层后页面应停在原位。</text>
      <text class="echo">填充行 H —— 这是垫底内容的最后一行。</text>
      <!-- 900px spacer: a page this compact fits the tall simulator in one
           screen, and the scroll acceptance needs real scrollable content. -->
      <view style="height: 900px;" />
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
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.echo {
  font-size: 12px;
  color: #1989fa;
  margin-top: 4px;
}
.popup-text {
  font-size: 15px;
  color: #323233;
  margin-bottom: 12px;
}
.probe {
  margin-top: 4px;
}
.probe-line {
  font-size: 12px;
}
.probe-ok {
  color: #07c160;
}
.probe-fail {
  color: #ee0a24;
}
</style>
