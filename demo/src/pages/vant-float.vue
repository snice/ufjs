<route>
{"title": "vant: float"}
</route>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

const container = ref();
const stickyFixed = ref(false);

// Sticky 的偏移以窗口顶边为 0：App 的窗口含状态栏和导航栏，web 只有导航栏。
// 取滚动容器自己的顶边做基准，两端都吸在导航栏下面。App 上页面转场期间
// 还没布局（量出 0），逐帧等到有值为止。
const page = ref();
const pageTop = ref(0);
onMounted(() => {
  let frames = 0;
  const measure = () => {
    const el = page.value?.$el ?? page.value;
    const top = el?.getBoundingClientRect?.().top ?? 0;
    if (top > 0) pageTop.value = top;
    else if (++frames < 60) requestAnimationFrame(measure);
  };
  measure();
});

const actions = [{ text: '选项一' }, { text: '选项二' }, { text: '选项三' }];
const iconActions = [
  { text: '选项一', icon: 'add-o' },
  { text: '选项二', icon: 'music-o' },
  { text: '选项三', icon: 'more-o' },
];
const disabledActions = [{ text: '选项一', disabled: true }, { text: '选项二', disabled: true }, { text: '选项三' }];
const placements = ['top', 'bottom', 'left', 'right', 'bottom-start', 'bottom-end'] as const;

const showLight = ref(false);
const showDark = ref(false);
const showHorizontal = ref(false);
const showIcon = ref(false);
const showDisabled = ref(false);
const showCustom = ref(false);
const showPlacement = ref(false);
const placement = ref<(typeof placements)[number]>('top');
const selected = ref('');

const onSelect = (action: { text: string }) => {
  selected.value = action.text;
};
const nextPlacement = () => {
  placement.value = placements[(placements.indexOf(placement.value) + 1) % placements.length];
};
</script>

<template>
  <scroll-view ref="page" class="page" scroll-y>
    <text class="page-title">vant · Sticky / Popover</text>
    <text class="page-note">
      Sticky 靠滚动容器的 scroll 事件 + getBoundingClientRect 判断是否吸顶，再用
      position: fixed 固定；Popover 由 popperjs 按参照元素的位置算浮层坐标。
      往下滚动看吸顶。
    </text>

    <view class="block">
      <text class="block-title">Sticky{{ stickyFixed ? '（已吸顶）' : '' }}</text>
      <van-sticky :offset-top="pageTop" @change="stickyFixed = $event">
        <van-button type="primary" class="sticky-a">基础用法</van-button>
      </van-sticky>
      <van-sticky :offset-top="pageTop + 50">
        <van-button type="primary" class="sticky-b">吸顶距离</van-button>
      </van-sticky>
      <text class="block-title" style="margin-top: 12px;">指定容器</text>
      <!-- div 而非 view：web 上 view 是组件，ref 拿到的是组件实例，vant 量不到它的 rect -->
      <div ref="container" class="sticky-container">
        <van-sticky :offset-top="pageTop" :container="container">
          <van-button type="warning" class="sticky-c">指定容器</van-button>
        </van-sticky>
      </div>
    </view>

    <view class="block">
      <text class="block-title">Popover{{ selected ? `（选中：${selected}）` : '' }}</text>
      <view class="row">
        <van-popover v-model:show="showLight" :actions="actions" @select="onSelect">
          <template #reference>
            <van-button type="primary">浅色风格</van-button>
          </template>
        </van-popover>
        <van-popover v-model:show="showDark" theme="dark" :actions="actions" @select="onSelect">
          <template #reference>
            <van-button type="primary">深色风格</van-button>
          </template>
        </van-popover>
        <van-popover v-model:show="showHorizontal" :actions="actions" actions-direction="horizontal"
          placement="top" @select="onSelect">
          <template #reference>
            <van-button type="primary">水平排列</van-button>
          </template>
        </van-popover>
      </view>
      <view class="row">
        <van-popover v-model:show="showIcon" :actions="iconActions" placement="bottom-start" @select="onSelect">
          <template #reference>
            <van-button type="primary">展示图标</van-button>
          </template>
        </van-popover>
        <van-popover v-model:show="showDisabled" :actions="disabledActions" @select="onSelect">
          <template #reference>
            <van-button type="primary">禁用选项</van-button>
          </template>
        </van-popover>
        <van-popover v-model:show="showCustom" placement="top-end">
          <van-grid clickable :border="false" column-num="3" class="custom-grid">
            <van-grid-item v-for="i in 6" :key="i" icon="photo-o" text="选项" @click="showCustom = false" />
          </van-grid>
          <template #reference>
            <van-button type="primary">自定义内容</van-button>
          </template>
        </van-popover>
      </view>
      <view class="row">
        <van-popover v-model:show="showPlacement" :actions="actions" :placement="placement" @select="onSelect">
          <template #reference>
            <van-button type="primary">{{ placement }}</van-button>
          </template>
        </van-popover>
        <van-button size="small" @click="nextPlacement">换位置</van-button>
        <van-popover :actions="actions" @select="onSelect">
          <template #reference>
            <van-button>非受控</van-button>
          </template>
        </van-popover>
      </view>
    </view>

    <view v-for="i in 12" :key="i" class="filler">
      <text class="filler-text">滚动占位 {{ i }}</text>
    </view>
  </scroll-view>
</template>

<style>
/* 吸顶的那层 div 没写 left：web 停在它原来的横向位置（CSS 的 static
   position），App 的 fixed 元素贴左边 0（docs/css-compat.md）。显式给出
   卡片内边距对齐的位置，两端一致。不能写成 scoped 的后代选择器：App 上
   fixed 元素被挪进弹层宿主，已不在 .block 之下。 */
.van-sticky--fixed {
  left: 28px;
}
</style>

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
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

/* 吸顶后三个按钮都 fixed 在顶部，错开横向位置才不互相盖住（vant 文档同款） */
.sticky-a {
  margin-left: 0;
}

.sticky-b {
  margin-left: 100px;
}

.sticky-c {
  margin-left: 200px;
}

.sticky-container {
  height: 150px;
  background-color: #f2f3f5;
}

.custom-grid {
  width: 240px;
}

.filler {
  height: 120px;
  background-color: #ffffff;
  border-radius: 8px;
  margin-bottom: 12px;
  align-items: center;
  justify-content: center;
}

.filler-text {
  color: #c8c9cc;
}
</style>
