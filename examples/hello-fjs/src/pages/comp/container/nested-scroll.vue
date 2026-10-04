<route>
{"title": "嵌套滚动", "tag": "nested-scroll-header", "group": "视图容器"}
</route>

<script setup lang="ts">
// nested-scroll-header / nested-scroll-body（specs/208）：头部先收起、内容
// 再滚动。三端一份源码：web 是单一滚动容器（body 直接子级的滚动容器被吸收
// 进外层），Flutter 是 CustomScrollView + 收起 sliver（offset-top 钉住尾
// 部），小程序 skyline 是原生组件（webview 渲染器编译期降级为 view 树，单
// 一滚动）。两个标签都必须是 type="nested" 的 scroll-view 的直接子节点，
// 且只渲染第一个子节点。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'NestedScrollPage' });

const rows = ref(30);

// 外层 scroll-view 的 @scroll 照常（六字段载荷，两端逐字节相同）
const detail = ref('');
function onScroll(e: string) {
  detail.value = e;
}
</script>

<template>
  <view>
    <Panel
      title="嵌套滚动"
      desc="上滑：头部先收起，列表接着滚；下拉反向。offset-top=88 收起后头部留 88px 尾巴"
    >
      <scroll-view
        type="nested"
        scroll-y
        class="nest"
        @scroll="onScroll"
      >
        <nested-scroll-header>
          <view class="hero">
            <text class="hero-t">头部 · 300px</text>
          </view>
        </nested-scroll-header>
        <nested-scroll-body :offset-top="88">
          <!-- 内层不写高度：skyline 的 nested 布局会撑开它；web / App 端
               这个滚动容器被吸收进外层，高度样式本就不参与 -->
          <scroll-view type="list" scroll-y class="list">
            <view v-for="n in rows" :key="n" class="row">
              <text>条目 {{ n }}</text>
            </view>
          </scroll-view>
        </nested-scroll-body>
      </scroll-view>
      <view class="event">
        <text class="event-t">{{
          detail || '滚动时 @scroll 载荷出现在这里（外层 scroll-view）'
        }}</text>
      </view>
    </Panel>

    <Panel title="不收起（offset-top 缺省）" desc="头部完全随滚动离场">
      <scroll-view type="nested" scroll-y class="nest short">
        <nested-scroll-header>
          <view class="hero small">
            <text class="hero-t">头部 · 160px</text>
          </view>
        </nested-scroll-header>
        <nested-scroll-body>
          <!-- skyline 的 body 由里层滚动容器承载内容；普通 view 超出 body
               高度会被裁掉。web / App 端同样被吸收进外层滚动 -->
          <scroll-view type="list" scroll-y class="plain-list">
            <view v-for="n in 12" :key="n" class="row">
              <text>普通块 {{ n }}</text>
            </view>
          </scroll-view>
        </nested-scroll-body>
      </scroll-view>
    </Panel>
  </view>
</template>

<style scoped>
.nest {
  height: 420px;
  border-radius: 8px;
  background-color: #f4f5f7;
}
.nest.short {
  height: 300px;
}
.hero {
  height: 300px;
  background-color: #007aff;
  align-items: center;
  justify-content: center;
}
.hero.small {
  height: 160px;
  background-color: #576b95;
}
.hero-t {
  color: #ffffff;
  font-size: 20px;
}
.list {
  /* 不写高度：skyline 的 nested 布局把内层撑满 body；web / App 端这个
     滚动容器被吸收进外层，写高度也不参与布局 */
  padding: 8px;
  gap: 8px;
}
.plain-list {
  padding: 8px;
  gap: 8px;
}
.row {
  background-color: #ffffff;
  border-radius: 6px;
  padding: 12px;
}
.event {
  margin-top: 8px;
}
.event-t {
  font-size: 12px;
  color: #999999;
  line-height: 1.6;
}
</style>
