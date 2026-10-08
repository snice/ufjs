<route>
{"title": "关于", "tab": 3}
</route>

<script setup lang="ts">
// 关于 tab：这个示例本身的说明。
import Panel from '@/components/Panel.vue';
import { totalPages } from '@/catalog';
import { useTabBarStyle, type TabBarStyleName } from '@/tabBarStyle';

const total = totalPages();
const { style, set } = useTabBarStyle();
const styleOptions: { name: TabBarStyleName; label: string }[] = [
  { name: 'liquid-glass', label: 'Liquid Glass' },
  { name: 'classic', label: 'Classic' },
];
</script>

<template>
  <view class="page">
    <Panel title="hello-fjs">
      <text class="para">
        用 Vue 3 SFC 写的组件示例大全，共 {{ total }} 个组件页，覆盖 ufjs 目前支持的全部内置标签。
        同一份源码跑两个平台：Flutter 上每个路由是一个原生 Navigator 页面（手势返回、转场都是平台自带的），
        浏览器上是 vue-router + DOM 标签适配。
      </text>
    </Panel>

    <Panel title="Tabbar 风格" desc="底部悬浮 tabbar 的外观，即时生效（specs/212）">
      <view class="seg">
        <view
          v-for="opt in styleOptions"
          :key="opt.name"
          class="seg-item"
          :class="{ on: style === opt.name }"
          @tap="() => set(opt.name)"
        >
          <text class="seg-label" :class="{ on: style === opt.name }">{{ opt.label }}</text>
        </view>
      </view>
    </Panel>

    <Panel title="怎么跑">
      <text class="code">pnpm build / pnpm dev（Flutter，配合 fjs go）</text>
      <text class="code">pnpm build:web / pnpm dev:web（浏览器）</text>
      <text class="code">pnpm build:pages（分包：shared 预置 + 每页一个 chunk）</text>
      <text class="note">新项目可以用 fjs create 创建，再用 fjs run android / ios 跑到设备。</text>
    </Panel>

    <Panel title="已知限制">
      <text class="li">· 没有 v-model，输入框用 :value + @input 回写</text>
      <text class="li">· 「下拉刷新」页只在 App 端出现（platforms: ["app"]）</text>
      <text class="li">· 没有动画 / transition</text>
      <text class="li">· 不支持百分比尺寸，用像素或 flex 权重</text>
      <text class="li">· 弹窗打开期间内容是快照（按钮事件仍然回派 JS）</text>
    </Panel>
  </view>
</template>

<style scoped>
.seg {
  flex-direction: row;
  background-color: var(--fjs-page);
  border-radius: 8px;
  padding: 2px;
}
.seg-item {
  flex-grow: 1;
  align-items: center;
  padding: 7px 0;
  border-radius: 6px;
}
.seg-item.on {
  background-color: var(--fjs-card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.seg-label {
  font-size: 13px;
  color: var(--fjs-muted);
}
.seg-label.on {
  color: var(--fjs-primary);
}
.page {
  padding-bottom: 24px;
}
.para {
  line-height: 1.7;
  color: #666666;
}
.code {
  font-size: 12px;
  color: #007aff;
  background-color: #f4f5f7;
  border-radius: 6px;
  padding: 8px 10px;
}
.note {
  font-size: 12px;
  color: #999999;
  line-height: 1.6;
}
.li {
  font-size: 13px;
  color: #666666;
  line-height: 1.6;
}
</style>
