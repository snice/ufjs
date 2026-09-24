<route>
{"title": "vant: nav"}
</route>

<script setup lang="ts">
import { ref } from 'vue';
const tabActive = ref(0);
const sidebarActive = ref(1);
const tabbarActive = ref(0);
const showPicker = ref(false);
const pickerValue = ref('');
const pickerColumns = [
  { text: '杭州', value: 'hz' },
  { text: '苏州', value: 'sz' },
  { text: '宁波', value: 'nb' },
  { text: '嘉兴', value: 'jx' },
];
const showKeyboard = ref(false);
const keyboardValue = ref('');
const navTaps = ref(0);
const searchValue = ref('');

interface PickerConfirmPayload {
  selectedOptions: Array<{ text?: string | number }>;
}

function onPickerConfirm(p: PickerConfirmPayload) {
  pickerValue.value = String(p.selectedOptions[0]?.text ?? '');
  showPicker.value = false;
}

// 滑块配色走内联样式：scoped 后代选择器够不到子组件内部的节点，两端都不稳。
const swipeColors = ['#1989fa', '#07c160', '#ff976a'];
function swipeItemStyle(i: number) {
  return {
    backgroundColor: swipeColors[i % swipeColors.length],
    height: '100px',
    color: '#ffffff',
    fontSize: '18px',
    textAlign: 'center',
    lineHeight: '100px',
  };
}
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · 导航与浮层</text>
    <text class="page-note">
      NavBar(fixed)/Tabbar(fixed) 探测 position: fixed 的置顶通道；
      Picker 在 Popup 里探测弹层内滚动选择；NumberKeyboard 探测贴底键盘。
      Search 与 Tabs 同页：回归 tabs+field 组合（specs/070 D1 修复前整页空白）。
    </text>

    <van-nav-bar title="固定顶栏" left-text="返回" right-text="按钮" left-arrow @click-left="navTaps++"
      @click-right="navTaps++" />
    <text class="echo">顶栏点击 {{ navTaps }} 次（fixed 挂根 Overlay，不经 safe-area，App 端可能顶进状态栏）</text>

    <view class="block">
      <text class="block-title">Tabs（下划线是绝对定位 + translate）</text>
      <van-tabs v-model:active="tabActive">
        <van-tab title="标签 1">内容一</van-tab>
        <van-tab title="标签 2">内容二</van-tab>
        <van-tab title="标签 3">内容三</van-tab>
      </van-tabs>
    </view>

    <view class="block">
      <text class="block-title">Search（field 与 Tabs 同页）</text>
      <van-search v-model="searchValue" placeholder="请输入搜索关键词" />
      <text class="echo">输入：{{ searchValue || '（空）' }}</text>
    </view>

    <view class="block">
      <text class="block-title">Sidebar + 内容联动（选中 {{ sidebarActive }}）</text>
      <view class="row" style="align-items: stretch;">
        <van-sidebar ref="sb" v-model="sidebarActive">
          <van-sidebar-item title="全部商品" />
          <van-sidebar-item title="春夏新款" badge="5" />
          <van-sidebar-item title="秋冬新款" disabled />
        </van-sidebar>
        <view class="sidebar-body">
          <text class="echo">第 {{ sidebarActive + 1 }} 组内容</text>
        </view>
      </view>
    </view>

    <!-- 首屏以下：页面转场结束后才挂（specs/118）。占位高度约等于这几块的总高，
         内容补上时滚动条不跳。 -->
    <defer placeholder-height="700">
      <view class="block">
        <text class="block-title">Swipe（横向拖动）</text>
        <!-- min-width:0 是关键：fjs 两端的 view 都是 flex 容器，vant 的滑轨
             (N×100%) 会把 min-width:auto 的祖先逐级撑破（整页横向 blowout） -->
        <van-swipe :loop="false" style="min-width: 0; height: 100px; overflow: hidden;">
          <van-swipe-item :style="swipeItemStyle(0)">1</van-swipe-item>
          <van-swipe-item :style="swipeItemStyle(1)">2</van-swipe-item>
          <van-swipe-item :style="swipeItemStyle(2)">3</van-swipe-item>
        </van-swipe>
      </view>

      <view class="block">
        <text class="block-title">Popup + Picker（{{ pickerValue || '未选择' }}）</text>
        <van-button type="primary" @click="showPicker = true">选择城市</van-button>
      </view>

      <view class="block">
        <text class="block-title">NumberKeyboard（{{ keyboardValue || '未输入' }}）</text>
        <van-button type="primary" @click="showKeyboard = true">弹出键盘</van-button>
      </view>

      <view class="block tail">
        <text class="echo">这段垫底内容用来确认 Tabbar 悬浮在页面最下、内容可从其下方滚过。</text>
      </view>

      <van-popup v-model:show="showPicker" position="bottom" round>
        <van-picker :columns="pickerColumns" @confirm="onPickerConfirm" @cancel="showPicker = false" />
      </van-popup>

      <van-number-keyboard v-model="keyboardValue" :show="showKeyboard" extra-key="." :maxlength="8"
        @blur="showKeyboard = false" @close="showKeyboard = false" />
    </defer>
  </scroll-view>
  <safe-area edges="bottom">
    <van-tabbar :fixed="false" :safe-area-inset-bottom="false" :border="false" v-model="tabbarActive">
      <van-tabbar-item icon="home-o">首页</van-tabbar-item>
      <van-tabbar-item icon="search" dot>搜索</van-tabbar-item>
      <van-tabbar-item icon="setting-o" badge="9">设置</van-tabbar-item>
    </van-tabbar>
  </safe-area>
</template>

<style scoped>
.page {
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

.tail {
  margin-top: 160px;
  margin-bottom: 120px;
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

.sidebar-body {
  flex-grow: 1;
  justify-content: center;
  align-items: center;
  background-color: #f7f8fa;
}

.echo {
  font-size: 12px;
  color: #1989fa;
  margin-top: 4px;
}
</style>
