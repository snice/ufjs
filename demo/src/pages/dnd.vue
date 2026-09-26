<route>
{"title": "拖拽排序", "group": "交互演示", "desc": "网格与竖列表的拖动重排"}
</route>

<script setup lang="ts">
// 拖拽排序：一套 useSortable，网格和竖列表各用一次。
//
// 拖动过程中数组不动、节点不重建，只有被拖的块跟手 translate，被挤开的块
// translate 一个格位；手指抬起来才真正 splice 一次。这样每帧只有 O(可见项)
// 条 setProps，而且没有任何布局重排。
import { computed, nextTick, ref, type Ref } from 'vue';
import type { FjsTouchEvent } from 'fjs';

interface Item {
  id: number;
  label: string;
  color: string;
}

interface Geometry {
  cols: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
}

const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v;

function afterPaint(cb: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

function nextFrame(cb: () => void) {
  requestAnimationFrame(cb);
}

function useSortable(items: Ref<Item[]>, geo: Geometry) {
  const from = ref(-1);
  const to = ref(-1);
  const dx = ref(0);
  const dy = ref(0);
  const commitDisabled = ref(false);
  const drop = ref<{ id: number; x: number; y: number } | null>(null);
  let dropToken = 0;
  let pointer = -1;
  let startX = 0;
  let startY = 0;

  const stepX = geo.cellWidth + geo.gap;
  const stepY = geo.cellHeight + geo.gap;
  const slotPos = (slot: number) => ({
    x: (slot % geo.cols) * stepX,
    y: Math.floor(slot / geo.cols) * stepY,
  });

  /** 拖动期间某一项落在哪个格位：被拖的那项去 to，中间的整体挪一格。 */
  function slotOf(index: number): number {
    if (from.value < 0) return index;
    if (index === from.value) return to.value;
    if (from.value < to.value && index > from.value && index <= to.value) {
      return index - 1;
    }
    if (to.value < from.value && index >= to.value && index < from.value) {
      return index + 1;
    }
    return index;
  }

  function itemStyle(item: Item, index: number): Record<string, unknown> {
    if (drop.value?.id === item.id) {
      return {
        transform: `translate(${drop.value.x}px, ${drop.value.y}px) scale(1.06)`,
        ...(commitDisabled.value ? { transition: 'none' } : {}),
        boxShadow: '0 12px 24px rgba(0,0,0,0.24)',
        opacity: 0.96,
      };
    }
    if (commitDisabled.value) return { transition: 'none' };
    if (from.value < 0) return {};
    if (index === from.value) {
      return {
        transform: `translate(${dx.value}px, ${dy.value}px) scale(1.06)`,
        transition: 'none',
        boxShadow: '0 12px 24px rgba(0,0,0,0.24)',
        opacity: 0.96,
      };
    }
    const here = slotPos(index);
    const there = slotPos(slotOf(index));
    if (here.x === there.x && here.y === there.y) return {};
    return { transform: `translate(${there.x - here.x}px, ${there.y - here.y}px)` };
  }

  function start(index: number, event: FjsTouchEvent) {
    const touch = event.changedTouches[0];
    if (!touch) return;
    dropToken++;
    commitDisabled.value = false;
    drop.value = null;
    // 上一次拖拽没等到 touchend（节点被销毁、手指在窗口外松开……）就不会自己
    // 收尾，下一次按下先把它丢掉，页面不会一直卡在拖拽态
    if (pointer !== -1) reset();
    pointer = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    dx.value = 0;
    dy.value = 0;
    from.value = index;
    to.value = index;
  }

  function move(event: FjsTouchEvent) {
    if (from.value < 0) return;
    const touch = [...event.changedTouches].find((t) => t.identifier === pointer);
    if (!touch) return;
    dx.value = touch.clientX - startX;
    dy.value = touch.clientY - startY;
    // 被拖块中心落在哪个格子，就把它排到那个位置
    const origin = slotPos(from.value);
    const cx = origin.x + dx.value + geo.cellWidth / 2;
    const cy = origin.y + dy.value + geo.cellHeight / 2;
    const col = clamp(Math.floor(cx / stepX), 0, geo.cols - 1);
    const row = Math.max(0, Math.floor(cy / stepY));
    to.value = clamp(row * geo.cols + col, 0, items.value.length - 1);
  }

  function end() {
    if (from.value < 0) return;
    const fromSlot = from.value;
    const toSlot = to.value;
    const dragged = items.value[fromSlot];
    const fromPos = slotPos(fromSlot);
    const toPos = slotPos(toSlot);
    const token = ++dropToken;
    commitDisabled.value = true;
    if (dragged) {
      drop.value = {
        id: dragged.id,
        x: fromPos.x + dx.value - toPos.x,
        y: fromPos.y + dy.value - toPos.y,
      };
    }
    if (toSlot !== fromSlot) {
      const list = items.value.slice();
      list.splice(toSlot, 0, list.splice(fromSlot, 1)[0]);
      items.value = list;
    }
    reset();
    void nextTick(() => {
      afterPaint(() => {
        if (token !== dropToken) return;
        commitDisabled.value = false;
        void nextTick(() => {
          nextFrame(() => {
            if (token === dropToken) drop.value = null;
          });
        });
      });
    });
  }

  /** 丢掉拖拽态，不落位。 */
  function reset() {
    from.value = -1;
    to.value = -1;
    dx.value = 0;
    dy.value = 0;
    pointer = -1;
  }

  return { from, to, itemStyle, start, move, end };
}

const COLORS = ['#2563eb', '#16a34a', '#f97316', '#db2777', '#7c3aed', '#0891b2'];
const make = (n: number, prefix: string): Item[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    label: `${prefix}${i + 1}`,
    color: COLORS[i % COLORS.length],
  }));

const gridItems = ref<Item[]>(make(9, ''));
const listItems = ref<Item[]>(make(6, '行 '));

const grid = useSortable(gridItems, {
  cols: 3,
  cellWidth: 96,
  cellHeight: 96,
  gap: 12,
});
const list = useSortable(listItems, {
  cols: 1,
  cellWidth: 312,
  cellHeight: 56,
  gap: 8,
});

const gridOrder = computed(() => gridItems.value.map((i) => i.label).join(' '));
</script>

<template>
  <scroll-view class="page">
    <text class="title">拖拽排序</text>
    <text class="hint">按住任意一块拖动；松手才真正换位。</text>

    <text class="section">网格（3 列）</text>
    <view class="grid">
      <view
        v-for="(item, index) in gridItems"
        :key="item.id"
        class="cell"
        :style="{ backgroundColor: item.color, ...grid.itemStyle(item, index) }"
        @touchstart="grid.start(index, $event)"
        @touchmove="grid.move($event)"
        @touchend="grid.end()"
        @touchcancel="grid.end()"
      >
        <text class="cell-label">{{ item.label }}</text>
      </view>
    </view>
    <text class="order">顺序：{{ gridOrder }}</text>

    <text class="section">竖向列表</text>
    <view class="list">
      <view
        v-for="(item, index) in listItems"
        :key="item.id"
        class="row"
        :style="list.itemStyle(item, index)"
        @touchstart="list.start(index, $event)"
        @touchmove="list.move($event)"
        @touchend="list.end()"
        @touchcancel="list.end()"
      >
        <view class="handle" :style="{ backgroundColor: item.color }" />
        <text class="row-label">{{ item.label }}</text>
        <text class="row-index">#{{ index + 1 }}</text>
      </view>
    </view>
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
.section {
  margin-top: 20px;
  align-items: flex-start;
  font-size: 15px;
  font-weight: 600;
  color: #374151;
}
.grid {
  margin-top: 10px;
  width: 312px;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px;
}
.cell {
  width: 96px;
  height: 96px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
  /* 手势归自己，外层 scroll-view 不抢 */
  touch-action: none;
  transition: transform 180ms ease, opacity 120ms ease;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}
.cell-label {
  color: #ffffff;
  font-size: 20px;
  font-weight: 700;
}
.order {
  margin-top: 10px;
  font-size: 12px;
  color: #6b7280;
}
.list {
  margin-top: 10px;
  width: 312px;
  gap: 8px;
}
.row {
  height: 56px;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  background-color: #f9fafb;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  touch-action: none;
  transition: transform 180ms ease, opacity 120ms ease;
}
.handle {
  width: 6px;
  height: 28px;
  border-radius: 3px;
}
.row-label {
  flex-grow: 1;
  font-size: 15px;
  color: #111827;
}
.row-index {
  font-size: 13px;
  color: #9ca3af;
}
</style>
