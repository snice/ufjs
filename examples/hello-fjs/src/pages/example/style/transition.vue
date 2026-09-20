<route>
{"title": "过渡演示", "group": "样式演示", "desc": "transition：背景/文字色 / 虚线边框 / 间距 / transform / opacity，两端同源"}
</route>

<script setup lang="ts">
// transition 演示页（spec 045/078）。
//
// 可动画属性：background-color / color / border-color / transform / opacity
// / width / height / padding / margin（App 端逐帧插值，web 端浏览器原生）。
// delay 与嵌套片段自带 color 的过渡是登记过的两端差异；@keyframes 另立。
// 对拍：点「点我变色」看背景色渐变；点「文字变色」看字色渐变；
// 点「虚线变色」看 dashed 分隔线渐变；点「间距渐变」看内外边距展开；
// 按住「按住缩小」看 :active 缩放；hover（桌面）看淡入。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

const on = ref(false);
</script>

<template>
  <view>
    <Panel title="背景渐变" desc="transition: background-color 0.3s —— 点按切换类名，颜色按帧插值，不是瞬时跳变">
      <view class="fade-btn" :class="{ on: on }" @tap="on = !on">{{ on ? '深蓝（点了）' : '绿色（再点）' }}</view>
      <view class="card" :class="{ active: on }">卡片跟随同一状态渐变</view>
    </Panel>

    <Panel title="按压缩放" desc="transition: transform 0.2s + :active —— 按住缩小、松手弹回（transform 过渡为既有能力）">
      <view class="press-btn">按住缩小</view>
    </Panel>

    <Panel title="opacity 淡入" desc="transition: opacity 0.4s + :hover —— 桌面悬停渐显；移动端可用点按上方状态对照">
      <view class="ghost">悬停淡入</view>
    </Panel>

    <Panel title="尺寸过渡" desc="transition: width 0.4s —— 点按变宽/还原。尺寸是布局属性：逐帧重排，与 web 的成本一致，别在大子树上用">
      <view class="size-btn" :class="{ wide: on }" @tap="on = !on">点我变宽</view>
    </Panel>

    <Panel title="文字变色" desc="transition: color 0.3s —— 段落自身的颜色渐变（spec 078）；嵌套 text 片段自带的 color 仍瞬时，是登记过的差异">
      <view class="text-btn" :class="{ lit: on }" @tap="on = !on">文字由灰变绿</view>
    </Panel>

    <Panel title="虚线变色" desc="transition: border-color 0.3s —— dashed 分隔线渐变；颜色插值，宽度与样式取终态">
      <view class="dash" :class="{ lit: on }">border-bottom: 2px dashed</view>
    </Panel>

    <Panel title="间距渐变" desc="transition: padding / margin —— 盒子的呼吸感；同为布局属性，逐帧重排">
      <view class="gap-btn" :class="{ roomy: on }" @tap="on = !on">padding / margin 展开</view>
    </Panel>
  </view>
</template>

<style scoped>
.fade-btn {
  background-color: #07c160;
  border-radius: 8;
  padding: 12 16;
  color: #ffffff;
  font-size: 15;
  transition: background-color 0.3s ease;
}
.fade-btn.on {
  background-color: #1c3d78;
}
/* 状态打在同一节点上：tap 切换文字由模板驱动，这里用第二张卡片演示类切换 */
.card {
  margin: 12 0 0;
  padding: 12 16;
  border-radius: 8;
  background-color: #ececec;
  color: #333333;
  font-size: 14;
  transition: background-color 0.3s ease;
}
.card.active {
  background-color: #1c3d78;
  color: #ffffff;
}

.press-btn {
  width: 160px;
  padding: 12 0;
  text-align: center;
  background-color: #dd524d;
  border-radius: 8;
  color: #ffffff;
  font-size: 15;
  transition: transform 0.2s ease;
}
.press-btn:active {
  transform: scale(0.92);
}

.ghost {
  width: 160px;
  padding: 12 0;
  text-align: center;
  background-color: #35383f;
  border-radius: 8;
  color: #ffffff;
  font-size: 15;
  opacity: 0.45;
  transition: opacity 0.4s ease;
}
.ghost:hover {
  opacity: 1;
}

.size-btn {
  width: 140px;
  padding: 12 16;
  background-color: #2f86ff;
  border-radius: 8;
  color: #ffffff;
  font-size: 15;
  transition: width 0.4s ease;
}
.size-btn.wide {
  width: 240px;
}

.text-btn {
  padding: 12 16;
  font-size: 15;
  color: #666666;
  background-color: #f5f5f5;
  border-radius: 8;
  transition: color 0.3s ease;
}
.text-btn.lit {
  color: #07c160;
}

.dash {
  padding: 12 0;
  font-size: 14;
  color: #666666;
  border-bottom: 2px dashed #dd524d;
  transition: border-color 0.3s ease;
}
.dash.lit {
  border-bottom-color: #07c160;
}

.gap-btn {
  padding: 12 16;
  margin: 0;
  background-color: #2f86ff;
  border-radius: 8;
  color: #ffffff;
  font-size: 15;
  transition: padding 0.4s ease, margin 0.4s ease;
}
.gap-btn.roomy {
  padding: 20 32;
  margin: 16 0;
}
</style>
