<route>
{"title": "vant: pickers", "group": "Vant", "desc": "Calendar / DatePicker / TimePicker / TreeSelect / Cascader / Uploader"}
</route>

<script setup lang="ts">
// specs/203：长列表滚动定位（Calendar）、级联列（DatePicker/TimePicker）、
// 层级选择（TreeSelect/Cascader）与文件选择（Uploader，App 端无文件选择器、
// 只渲染触发区）。
import { ref } from 'vue';

const showCalendar = ref(false);
const calendarDate = ref<string>('');
function onCalendarConfirm(d: Date): void {
  showCalendar.value = false;
  calendarDate.value = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const now = new Date();
const dateValue = ref([`${now.getFullYear()}`, `${now.getMonth() + 1}`, `${now.getDate()}`]);
const timeValue = ref(['12', '00']);

const treeId = ref(1);
const treeIndex = ref(0);
interface TreeItem {
  text: string;
  id: number;
  children?: { text: string; id: number }[];
}
const treeItems: TreeItem[] = [
  { text: '浙江', id: 1, children: [{ text: '杭州', id: 11 }, { text: '温州', id: 12 }] },
  { text: '江苏', id: 2, children: [{ text: '南京', id: 21 }, { text: '苏州', id: 22 }] },
];
function onTreeItem(item: TreeItem): void {
  if (item.id != null) treeId.value = item.id;
}

const cascaderValue = ref('');
const cascaderPath = ref('');
const cascaderOptions = [
  { text: '数码', value: 'digital', children: [{ text: '手机', value: 'phone' }, { text: '平板', value: 'pad' }] },
  { text: '家电', value: 'home', children: [{ text: '电视', value: 'tv' }, { text: '空调', value: 'ac' }] },
];
function onCascaderFinish({ selectedOptions }: { selectedOptions: { text: string }[] }): void {
  cascaderPath.value = selectedOptions.map((o) => o.text).join(' / ');
}

const fileList = ref([{ url: 'https://img.yzcdn.cn/vant/leaf.jpg' }]);
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · 选择器</text>
    <text class="page-note">Uploader 在 App 端没有文件选择器，只渲染触发区（已知差异）。</text>

    <view class="block">
      <text class="block-title">Calendar（{{ calendarDate || '未选' }}）</text>
      <van-cell is-link title="选择日期" :value="calendarDate || '请选择'" @click="showCalendar = true" />
      <van-calendar v-model:show="showCalendar" @confirm="onCalendarConfirm" />
    </view>

    <view class="block">
      <text class="block-title">DatePicker / TimePicker</text>
      <van-date-picker v-model="dateValue" title="选择日期" :min-date="new Date(2020, 0, 1)" :max-date="new Date(2030, 11, 31)" />
      <van-time-picker v-model="timeValue" title="选择时间" />
      <text class="echo">{{ dateValue.join('-') }} {{ timeValue.join(':') }}</text>
    </view>

    <view class="block">
      <text class="block-title">TreeSelect（id {{ treeId }}）</text>
      <van-tree-select v-model:main-active-index="treeIndex" :items="treeItems" height="200px" @click-item="onTreeItem" />
    </view>

    <view class="block">
      <text class="block-title">Cascader（{{ cascaderPath || '未选' }}）</text>
      <van-cascader v-model="cascaderValue" title="请选择地区" :options="cascaderOptions" @finish="onCascaderFinish" />
    </view>

    <view class="block">
      <text class="block-title">Uploader（{{ fileList.length }} 个文件）</text>
      <van-uploader v-model="fileList" :max-count="3" />
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
.echo {
  font-size: 12px;
  color: #323233;
  margin-top: 8px;
}
</style>
