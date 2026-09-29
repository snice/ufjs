<route>
{"title": "长列表", "tag": "list-view", "group": "视图容器", "scroll": false}
</route>

<script setup lang="ts">
// list-view：页面只提供数据和行模板，组件自己做虚拟化——
// Flutter 侧交给 ListView.builder，web 侧只挂载视口附近的行。
// 行上用 `:active` 演示按压态（两端都支持）。
import { ref } from 'vue';
import { toast } from 'fjs';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <list-view> 才不会被当成自引用。
defineOptions({ name: 'ListViewPage' });

const rows = ref(
  Array.from({ length: 200 }, (_, i) => ({
    id: i + 1,
    title: `列表项 ${i + 1}`,
    desc: `这是第 ${i + 1} 条数据的说明`,
  })),
);
</script>

<template>
  <view class="page">
    <Panel class="fill" title="200 条数据" desc="切页先完成，列表组件自动按需加载">
      <list-view class="list" :items="rows">
        <template #default="{ item: row }">
          <view :key="row.id" class="row" @tap="() => toast(row.title)">
            <view class="avatar"><text class="avatar-t">{{ row.id }}</text></view>
            <view class="main">
              <text class="title">{{ row.title }}</text>
              <text class="desc">{{ row.desc }}</text>
            </view>
            <text class="chev">›</text>
          </view>
        </template>
      </list-view>
    </Panel>
  </view>
</template>

<style scoped>
/* 全屏填充：vh/vw 在 Flutter 侧不支持（css-compat），剩余高度只能靠 flex 链
   逐层传递——页面根 → Panel 根（class 穿透到 .section）→ 卡片（:deep 穿透
   Panel 的 scoped 样式）→ 列表。中间任何一层断掉，列表都会塌成内容高。 */
.page {
  width: 100%;
  height: 100%;
}

.fill {
  flex-grow: 1;
  /* Panel 自带 margin-bottom: 0，撑满后卡片会贴住屏幕底边 */
  /* margin-bottom: 12px; */
}

:deep(.card) {
  flex-grow: 1;
}

.list {
  flex-grow: 1;
}

.row {
  height: 64px;
  flex-shrink: 0;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-radius: 8px;
}
/* 按压态：Flutter 侧映射成节点自己的按下状态，web 侧就是浏览器的 :active */
.row:active {
  background-color: #eef4ff;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background-color: #eef4ff;
  align-items: center;
  justify-content: center;
}

.avatar-t {
  font-size: 12px;
  color: #007aff;
}

.main {
  flex-grow: 1;
  gap: 2px;
}

.title {
  font-size: 15px;
}

.desc {
  font-size: 12px;
  color: #999999;
}

.chev {
  color: #cccccc;
}
</style>
