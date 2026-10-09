<route>
{"title": "飞机大战（微信移植）", "scroll": false, "tabBar": false, "group": "交互游戏", "desc": "微信小游戏原样移植：wx 适配层 + 零改动游戏代码；音频暂静音"}
</route>

<script setup lang="ts">
// 微信官方示例小游戏「打飞机」，从 /Users/zhe/WeChatProjects/minigame-1 原样
// 拷进 src/plane-war/minigame/（specs/214，零字节修改），靠 wx-adapter 提供
// WeChat 全局后直接跑。本页只做生命周期：
//
// - 挂载：install（wx 全局）→ @resize attach 画布 → bootGame() 开一局新的；
// - 离开（返回 / 卸载）：disposeGame() 取消游戏的挂起帧——游戏随页面销毁，
//   正如退出一个小游戏；重进就是全新一局。
// 已知降级：ufjs 还没有音频能力（音效静音）、震动 no-op。
import { onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import type { FjsCanvasApi, FjsTouchEvent } from 'fjs';
import {
  attachPlaneWarCanvas,
  bootGame,
  disposeGame,
  emitTouch,
  installPlaneWarWx,
} from '@/plane-war/wx-adapter';

const cv = ref<FjsCanvasApi>();

function onResize(): void {
  attachPlaneWarCanvas(cv.value);
  if (cv.value?.width) {
    bootGame().catch((e) => console.error('[plane-war] boot failed:', e));
  }
}

onMounted(() => {
  installPlaneWarWx();
});
// 离开（返回被 pop、或被新页面盖住）＝游戏随页面销毁；重进（新实例的
// mount，或同实例的 activate）＝重新开一局。
onActivated(() => {
  attachPlaneWarCanvas(cv.value);
  if (cv.value?.width) {
    bootGame().catch((e) => console.error('[plane-war] boot failed:', e));
  }
});
onDeactivated(disposeGame);
onUnmounted(disposeGame);
</script>

<template>
  <view class="page">
    <canvas
      ref="cv"
      class="cv"
      @resize="onResize"
      @touchstart="(e: FjsTouchEvent) => emitTouch('start', e)"
      @touchmove="(e: FjsTouchEvent) => emitTouch('move', e)"
      @touchend="(e: FjsTouchEvent) => emitTouch('end', e)"
      @touchcancel="(e: FjsTouchEvent) => emitTouch('cancel', e)"
    />
  </view>
</template>

<style scoped>
.page {
  width: 100%;
  height: 100%;
  background-color: #0b1e33;
}
.cv {
  width: 100%;
  height: 100%;
  touch-action: none;
}
</style>
