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
  // 数据就绪后才收刷新态（vant 的标准时序）：「加载中...」的 800ms 里旧
  // 列表原样可见；数据填好、refreshing 置 false 后进「刷新成功」，此刻
  // 列表已填好——成功文案不会再跟 List 自己的「加载中...」行同屏（List
  // 的加载行在 check 到 onLoad 完成之间一直在，两端同一份 vant 代码，
  // specs/206 §7.10）。App 端 List 的 check 只由 loading/finished 变化
  // 与滚动事件触发：清空后两者都可能没有变化——手动叫它重查一次兜底。
  setTimeout(() => {
    next = 0;
    const fresh: number[] = [];
    for (let i = 0; i < 10; i++) fresh.push(next++);
    items.value = fresh;
    finished.value = false;
    loading.value = false;
    refreshing.value = false;
    refreshed.value = true;
    nextTick(() => listRef.value?.check());
    setTimeout(() => (refreshed.value = false), 1500);
  }, 800);
}
const refreshed = ref(false);

const dropdown = ref('a');
// DropdownMenu 渲染标题时要读 item 的 options prop（renderTitle），于是 menu
// 的渲染 effect 会追踪它：options 若在模板里内联，slot 每次执行都是新数组，
// patch 赋新值 → menu 重渲染 → 再生成新数组，自激励成递归更新（web 端
// FjsPageEntry 的 mounted/activated 钩子里 nextTick(restore) 让这一串留在
// 同一个 flush 的递归计数窗内，100 次上限就炸，报错挂在钩子上——specs/205
// §7）。提升成稳定引用后 patch 判定未变，循环断掉。
const dropdownOptions = [
  { text: '选项 A', value: 'a' },
  { text: '选项 B', value: 'b' },
];
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
        <van-dropdown-item v-model="dropdown" :options="dropdownOptions" />
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
           ——端差异与取舍见组件头注释（specs/205 §7）；v-model:refreshing
           必须绑，否则 web 端刷新态收不了口。 -->
      <pull-refresh v-model:refreshing="refreshing" @refresh="onRefresh">
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
