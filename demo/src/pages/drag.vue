<route>
{"title": "块拖拽"}
</route>

<script setup lang="ts">
// 块拖拽：touchstart/touchmove/touchend + transform。
//
// 一个块的位置只写在 transform 上（translate 只重绘、不重排），所以拖动过程
// 里既不改布局也不改树结构，每帧跨桥的只有一条 setProps。多指同时按下时，
// 每根手指各拖各的块——这正是 changedTouches 的用处。
import { reactive, ref } from 'vue';
import { nowMs, type FjsTouchEvent } from 'fjs';

const CANVAS = { width: 312, height: 320 };
const SIZE = 88;

interface Block {
  id: number;
  label: string;
  color: string;
  x: number;
  y: number;
}

const blocks = reactive<Block[]>([
  { id: 1, label: 'A', color: '#2563eb', x: 8, y: 8 },
  { id: 2, label: 'B', color: '#16a34a', x: 112, y: 116 },
  { id: 3, label: 'C', color: '#f97316', x: 208, y: 32 },
]);

/** 每根手指按住的块和按下时的偏差，key 是 touch.identifier。 */
const drags = new Map<number, { block: Block; dx: number; dy: number }>();
const held = ref<number[]>([]);

const moves = ref(0);
const interval = ref(0);
let lastMove = 0;

const clamp = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);

function blockStyle(block: Block) {
  const lifted = held.value.includes(block.id);
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    backgroundColor: block.color,
    // 拖起来的块抬一点：scale 和 translate 一样只是重绘
    transform: `translate(${block.x}px, ${block.y}px)${lifted ? ' scale(1.08)' : ''}`,
    boxShadow: lifted
      ? '0 10px 20px rgba(0,0,0,0.25)'
      : '0 2px 6px rgba(0,0,0,0.12)',
  };
}

function onTouchstart(block: Block, event: FjsTouchEvent) {
  // 上一次没等到 touchend 的手指（节点被销毁、手指在窗口外松开……）在这里丢
  // 掉：event.touches 就是此刻真正还按着的所有手指
  const live = new Set(event.touches.map((t) => t.identifier));
  for (const id of [...drags.keys()]) {
    if (!live.has(id)) drags.delete(id);
  }
  for (const touch of event.changedTouches) {
    drags.set(touch.identifier, {
      block,
      dx: touch.clientX - block.x,
      dy: touch.clientY - block.y,
    });
  }
  held.value = [...new Set([...drags.values()].map((d) => d.block.id))];
  lastMove = nowMs();
}

function onTouchmove(event: FjsTouchEvent) {
  for (const touch of event.changedTouches) {
    const drag = drags.get(touch.identifier);
    if (!drag) continue;
    drag.block.x = clamp(touch.clientX - drag.dx, CANVAS.width - SIZE);
    drag.block.y = clamp(touch.clientY - drag.dy, CANVAS.height - SIZE);
  }
  const now = nowMs();
  moves.value += 1;
  // 两次 touchmove 的间隔：跟手就该贴着一帧（60Hz 约 16ms，120Hz 约 8ms）
  interval.value = Math.round(now - lastMove);
  lastMove = now;
}

function onTouchend(event: FjsTouchEvent) {
  const done = new Set<number>();
  for (const touch of event.changedTouches) {
    const drag = drags.get(touch.identifier);
    if (!drag) continue;
    done.add(drag.block.id);
    drags.delete(touch.identifier);
  }
  const stillHeld = new Set([...drags.values()].map((d) => d.block.id));
  held.value = held.value.filter((id) => !done.has(id) || stillHeld.has(id));
}

function reset() {
  blocks[0].x = 8;
  blocks[0].y = 8;
  blocks[1].x = 112;
  blocks[1].y = 116;
  blocks[2].x = 208;
  blocks[2].y = 32;
  moves.value = 0;
  interval.value = 0;
}
</script>

<template>
  <scroll-view class="page">
    <text class="title">块拖拽</text>
    <text class="hint">按住方块拖动，多指可以同时拖多个。</text>

    <view class="canvas">
      <view
        v-for="block in blocks"
        :key="block.id"
        :id="`block-${block.id}`"
        class="block"
        :style="blockStyle(block)"
        @touchstart="onTouchstart(block, $event)"
        @touchmove="onTouchmove"
        @touchend="onTouchend"
        @touchcancel="onTouchend"
      >
        <text class="block-label">{{ block.label }}</text>
      </view>
    </view>

    <view class="stats">
      <text class="stat">touchmove: {{ moves }}</text>
      <text class="stat">间隔: {{ interval }}ms</text>
    </view>
    <button class="btn" @tap="reset()">复位</button>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出） */
  height: 0px;
  flex-grow: 1;
  padding: 20px;
  align-items: center;
  background-color: #ffffff;
}
.title {
  font-size: 22px;
  font-weight: 700;
  color: #111827;
}
.hint {
  margin-top: 6px;
  font-size: 13px;
  color: #6b7280;
}
.canvas {
  position: relative;
  margin-top: 16px;
  width: 312px;
  height: 320px;
  background-color: #f3f4f6;
  border-radius: 12px;
  overflow: hidden;
}
.block {
  border-radius: 12px;
  align-items: center;
  justify-content: center;
  /* 这一条是关键：这个节点自己吃掉手势，外层滚动不再跟它抢
     （web 上就是原生的 touch-action，Flutter 上进手势竞技场抢指针） */
  touch-action: none;
}
.block-label {
  color: #ffffff;
  font-size: 24px;
  font-weight: 700;
}
.stats {
  margin-top: 16px;
  flex-direction: row;
  gap: 16px;
}
.stat {
  font-size: 13px;
  color: #374151;
}
.btn {
  margin-top: 12px;
  padding: 8px 16px;
  background-color: #2563eb;
  color: #ffffff;
  border-radius: 6px;
}
</style>
