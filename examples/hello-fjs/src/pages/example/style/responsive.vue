<route>
{"title": "响应式布局", "group": "样式演示", "desc": "@media 断点 / orientation，两端同源"}
</route>

<script setup lang="ts">
// @media 演示页（spec 043）。
//
// 断点由 App 端 JS 侧 CSS 引擎按窗口逻辑尺寸求值（Dart 推送尺寸变化），
// web 端是浏览器原生 @media。对拍方式：web 拖窄/拖宽窗口或 devtools 转
// 屏；App 上转屏（iOS Cmd+←/→）。断点取 600 逻辑像素，两端同一基准。
// 另有一个 @media print 块：web 浏览器原生不匹配（不打印），App 端不支持
// print 类型、控制台告警一次——演示「不支持 ≠ 静默」（宪法 V）。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

const marks = ref(['窄屏时只有主区', '宽屏出现侧栏', '横屏后主区换色']);
</script>

<template>
  <view>
    <Panel
      title="断点分栏"
      desc="窄于 600px 只有主区；宽于 600px 出现侧栏。web 拖窗口宽度，App 转屏对拍"
    >
      <view class="layout">
        <view class="side">
          <text class="side-text">侧栏</text>
        </view>
        <view class="main">
          <text class="main-text">主区</text>
        </view>
      </view>
    </Panel>

    <Panel title="orientation" desc="竖屏灰底、横屏蓝底，文字跟着换——转屏即时生效，无需重进页面">
      <view class="orient">
        <text class="orient-text">转屏看我变色</text>
      </view>
    </Panel>

    <Panel title="组合条件" desc="and 与逗号（或）：三行说明只在「宽屏且横屏」或「竖屏」下显示">
      <view class="marks">
        <text v-for="(m, i) in marks" :key="i" class="mark">{{ i + 1 }}. {{ m }}</text>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  border-radius: 8;
  overflow: hidden;
}
.side {
  display: none;
  width: 120px;
  background-color: #35383f;
  padding: 24 12;
  justify-content: center;
}
.side-text {
  color: #ffffff;
  font-size: 14;
}
.main {
  background-color: #f7f7f7;
  padding: 24 12;
  justify-content: center;
}
.main-text {
  color: #333333;
  font-size: 14;
}

.orient {
  background-color: #ececec;
  border-radius: 8;
  padding: 20 12;
  justify-content: center;
}
.orient-text {
  color: #666666;
  font-size: 14;
}

.mark {
  font-size: 13;
  color: #666666;
  margin: 3 0;
}

@media (min-width: 600px) {
  .layout {
    flex-direction: row;
  }
  .side {
    display: flex;
    flex-direction: column;
  }
  .main {
    flex-grow: 1;
  }
}

@media (orientation: landscape) {
  .orient {
    background-color: #d6e4ff;
  }
  .orient-text {
    color: #1c3d78;
  }
}

/* 默认隐藏；匹配的组合条件在同优先级下源顺序更靠后，才能盖过它 */
.marks {
  display: none;
}
/* 宽屏且横屏才显示；竖屏（任意宽度）也显示——两条 OR，一条 AND */
@media (min-width: 600px) and (orientation: landscape), (orientation: portrait) {
  .marks {
    display: flex;
    flex-direction: column;
  }
}
</style>

<!-- @media print 演示「不支持 ≠ 静默」：App 端告警一次、块不生效；web
     浏览器原生求值，只在打印时匹配（屏上看不出差别）。放在独立的全局
     块里，scoped 不参与。 -->
<style>
@media print {
  .mark {
    color: #000000;
  }
}
</style>
