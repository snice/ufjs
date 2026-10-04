<route>
{"title": "vant: scroll", "group": "Vant", "desc": "List / PullRefresh / DropdownMenu / ImagePreview（命令式）"}
</route>

<script setup lang="ts">
// specs/203：滚动加载与下拉手势是滚动容器（scroll-view）与触摸事件的组合
// 探针；ImagePreview 是命令式全屏浮层（specs/137 通道）。
import { nextTick, ref } from 'vue';
import { showImagePreview } from 'vant';
import PullRefresh from '../../components/pull-refresh.vue';

const refreshing = ref(false);
const loading = ref(false);
const finished = ref(false);
const listRef = ref();
const items = ref<number[]>([]);
let next = 0;

function onLoad(): void {
  // List 首次渲染就会触发一次 @load，无需手动初始化
  setTimeout(() => {
    for (let i = 0; i < 10; i++) items.value.push(next++);
    loading.value = false;
    if (items.value.length >= 30) finished.value = true;
  }, 500);
}

function onRefresh(): void {
  setTimeout(() => {
    next = 0;
    items.value = [];
    finished.value = false;
    refreshing.value = false;
    refreshed.value = true;
    // List 的 check 只由 loading/finished 变化与滚动事件触发：清空后两者
    // 都可能没有变化、App 端也没有滚动事件兜底——手动叫它重查一次。
    nextTick(() => listRef.value?.check());
    setTimeout(() => (refreshed.value = false), 1500);
  }, 800);
}
const refreshed = ref(false);

const dropdown = ref('a');
const images = [
  'https://img.yzcdn.cn/vant/apple-1.jpg',
  'https://img.yzcdn.cn/vant/apple-2.jpg',
  'https://img.yzcdn.cn/vant/apple-3.jpg',
];
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · 滚动与浮层</text>

    <view class="block">
      <text class="block-title">DropdownMenu（{{ dropdown }}）</text>
      <van-dropdown-menu>
        <van-dropdown-item v-model="dropdown" :options="[{ text: '选项 A', value: 'a' }, { text: '选项 B', value: 'b' }]" />
      </van-dropdown-menu>
    </view>

    <view class="block">
      <text class="block-title">ImagePreview（命令式）</text>
      <van-button type="primary" @click="showImagePreview(images)">预览图片</van-button>
    </view>

    <view class="block">
      <text class="block-title">PullRefresh + List（{{ items.length }} 条）{{ refreshed ? '已刷新' : '' }}</text>
      <!-- 两端同源的 PullRefresh 包装：App 端 fjs refresh 标签（Flutter
           RefreshIndicator）+ 嵌套 scroll-view，web 端 van-pull-refresh
           ——端差异与取舍见组件头注释（specs/205 §7）。 -->
      <pull-refresh @refresh="onRefresh">
        <van-list ref="listRef" v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="onLoad">
          <van-cell v-for="i in items" :key="i" :title="`条目 ${i}`" />
        </van-list>
      </pull-refresh>
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
</style>
