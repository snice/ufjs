<route>
{"title": "页面容器", "tag": "page-container", "group": "视图容器"}
</route>

<script setup lang="ts">
// page-container：遮罩 + 四向弹出面板的"假页"容器。返回操作（右滑/物理返回）
// 关闭的是容器而不是页面——iOS 模拟器边缘右滑、小程序原生返回都走这条路，
// 关闭后靠 @after-leave 把 show 归位 false（web 端不拦浏览器返回，是已知差异）。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <page-container> 才不会被当成自引用。
defineOptions({ name: 'PageContainerPage' });

type Position = 'top' | 'bottom' | 'right' | 'center';

const show = ref(false);
const pos = ref<Position>('bottom');
const log = ref<string[]>([]);

const note = (event: string) => {
  log.value = [event, ...log.value].slice(0, 6);
};

const open = (p: Position) => {
  pos.value = p;
  show.value = true;
};

const afterLeave = () => {
  note('afterleave');
  show.value = false;
};

const closeOnOverlay = () => {
  note('clickoverlay');
  show.value = false;
};
</script>

<template>
  <view>
    <Panel title="底部弹出" desc="round 圆角 + close-on-slide-down 下滑关闭。容器打开期间点遮罩只派 clickoverlay，关闭由页面在 handler 里做。">
      <button class="btn primary" @tap="open('bottom')">打开底部容器</button>
      <text class="hint">
        状态：{{ show ? `${pos} 已打开` : '关闭' }}；返回手势/下滑关闭后 show 由
        @after-leave 归位。
      </text>
    </Panel>

    <Panel title="四个方向"
      desc="position：top / bottom / right / center，动画方向与遮罩时长三端一致。小程序 skyline 下 wx 原生 center 不渲染面板（组件缺陷），居中弹层暂用 modal。">
      <view class="row">
        <button class="btn" @tap="open('top')">top</button>
        <button class="btn" @tap="open('right')">right</button>
        <button class="btn" @tap="open('center')">center</button>
      </view>
    </Panel>

    <Panel title="事件日志" desc="wx 语义的生命周期：beforeenter → enter → afterenter，离场链在所有关闭路径上恰好各派一次。">
      <view v-if="log.length === 0">
        <text class="hint">还没有事件。打开一次容器试试。</text>
      </view>
      <view v-for="(item, i) in log" :key="`${item}-${i}`" class="log-row">
        <text class="log-item">{{ item }}</text>
      </view>
    </Panel>

    <page-container :show="show" :position="pos" round :close-on-slide-down="true" @before-enter="note('beforeenter')"
      @enter="note('enter')" @after-enter="note('afterenter')" @before-leave="note('beforeleave')"
      @leave="note('leave')" @after-leave="afterLeave" @clickoverlay="closeOnOverlay">
      <!-- skyline 的 wx 原生容器 center 位置宽度随内容，view 不给宽度会塌
           成 0（面板空白）——宽度只在 center 需要，bottom/top/right 不设。 -->
      <view class="container-body">
        <text class="container-title">{{ pos }} 容器</text>
        <text class="container-desc">
          返回操作（右滑手势 / 物理返回）关闭的是这个容器，页面本身不动。
          底部容器可以直接下滑关闭。
        </text>
        <button class="btn" @tap="show = false">关闭容器</button>
      </view>
    </page-container>
  </view>
</template>

<style scoped>
.btn {
  border-radius: 8px;
}

.primary {
  background-color: #007aff;
  color: #ffffff;
}

.hint {
  font-size: 12px;
  color: #999999;
}

.row {
  flex-direction: row;
  gap: 12px;
}

.log-row {
  border-bottom: 1px solid #f0f0f0;
  padding: 6px 0;
}

.log-item {
  font-size: 13px;
  color: #666666;
}

.container-body {
  padding: 24px;
  gap: 12px;
}

.container-title {
  font-size: 17px;
  font-weight: 600;
}

.container-desc {
  font-size: 13px;
  color: #999999;
}
</style>
