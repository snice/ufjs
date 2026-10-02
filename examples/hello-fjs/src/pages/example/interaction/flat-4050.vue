<route>
{"title": "4050 元素同屏", "scroll": false, "group": "交互演示", "desc": "对标 uni-app x vapor benchmark：同屏挂 4050 个元素，VDOM / Vapor 对照"}
</route>

<script setup lang="ts">
// 对标 uni-app x 的 vapor benchmark（doc.dcloud.net.cn/uni-app-x/benchmark/
// vapor-benchmark-android.html）：上面常驻 5×10 格（110 个元素），点按钮在
// 下面挂 50×40 格（每格 view + text，加上行 view，约 4050 个元素）。
//
// uni-app x 报的是「点击 → 渲染结束」。这里拆成三段，含义与 theme 页相同：
//
//   JS      tap 到 nextTick：Vue patch + 样式引擎 + op 编码 + 同步过桥 applyFrame
//   上屏    tap 到挂载后第二个 rAF：中间那一帧就是 widget build + layout + paint，
//           第二个 rAF 回调触发时它已经上屏——这一格对应 uni-app x 的总耗时
//   最慢帧  挂载后 30 帧里最长的一帧
//
// 原例里的 `flatten`（uni-app x 的拍平）这里没有对应物，模板照搬但去掉了它。
//
// specs/148：网格是子组件，VDOM 版（GridVdom）与 Vue Vapor 版（GridVapor）
// 只差 `<script setup vapor>`，切换后同一套按钮对照测。「改 1 格 / 改 200 格」
// 是局部更新：VDOM 要重跑整张网格的 render 再 diff，Vapor 只跑那几格的 effect。
import { nextTick, reactive, ref } from 'vue';
import { nowMs, setOpSink } from 'fjs';
import { styleEngine } from 'fjs/vue';
import GridVdom from '../../../components/flat4050/GridVdom.vue';
import GridVapor from '../../../components/flat4050/GridVapor.vue';

const CELLS = 2000;
const mode = ref<'vdom' | 'vapor'>('vdom');
const show = ref(false);
const vals = reactive(Array.from({ length: CELLS }, (_, k) => k % 40));
let bumps = 0;
const jsMs = ref<number | null>(null);
const firstFrameMs = ref<number | null>(null);
const worstFrameMs = ref<number | null>(null);
const busy = ref(false);
/** JS 那一格的拆账：过桥（uiOps 是同步的，Dart 的 applyFrame 算在 JS 窗口里）
 * 与样式引擎的重算 / 标脏，剩下的是 Vue + 元素层。 */
const split = ref('');

function raf(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** One measured action: `act` changes state, then the same three readings
 * as before (JS to nextTick, on screen, worst of the next 30 frames). */
async function measure(label: string, act: () => void) {
  if (busy.value) return;
  busy.value = true;
  jsMs.value = firstFrameMs.value = worstFrameMs.value = null;
  let bridge = 0;
  let bytes = 0;
  const forward = setOpSink((frame) => {
    bytes += frame.length;
    const tb = nowMs();
    forward(frame);
    bridge += nowMs() - tb;
  });
  styleEngine.resetStats();
  const t0 = nowMs();
  act();
  await nextTick();
  jsMs.value = +(nowMs() - t0).toFixed(1);
  setOpSink(forward);
  const st = styleEngine.stats;
  split.value =
    `过桥 ${bridge.toFixed(1)}ms/${(bytes / 1024).toFixed(0)}KB  ` +
    `样式 flush ${st.flushMs.toFixed(1)} mark ${st.markMs.toFixed(1)}  ` +
    `其余 ${(jsMs.value - bridge - st.flushMs - st.markMs).toFixed(1)}ms`;
  // The frame after the commit builds, lays out and paints the new subtree;
  // the rAF after that one is the first point where it is on screen.
  await raf();
  await raf();
  firstFrameMs.value = +(nowMs() - t0).toFixed(1);
  let worst = 0;
  let last = nowMs();
  for (let i = 0; i < 30; i++) {
    await raf();
    const now = nowMs();
    worst = Math.max(worst, now - last);
    last = now;
  }
  worstFrameMs.value = +worst.toFixed(1);
  console.log(
    `[flat-4050] ${mode.value} ${label} js=${jsMs.value}ms ` +
      `firstFrame=${firstFrameMs.value}ms worst=${worstFrameMs.value}ms | ${split.value}`,
  );
  busy.value = false;
}

const toggle = () => measure(show.value ? 'hide' : 'show', () => (show.value = !show.value));

/** Bumps `n` cells spread over the grid (every CELLS/n-th one). */
function bump(n: number) {
  if (!show.value) return;
  measure(`update${n}`, () => {
    bumps++;
    for (let k = 0; k < CELLS; k += CELLS / n) vals[k] = bumps;
  });
}

function setMode(next: 'vdom' | 'vapor') {
  if (busy.value || mode.value === next) return;
  show.value = false;
  mode.value = next;
}

const fmt = (v: number | null) => (v == null ? '—' : `${v} ms`);

// 脚本手柄（specs/191）：真机上用 `fjs eval` 驱动，与 hello-js 的 __flat4050
// 同一组读数——`__flat4050vue.setMode('vapor'); __flat4050vue.toggle()`。
(globalThis as Record<string, unknown>).__flat4050vue = { toggle, bump, setMode };
</script>

<template>
  <scroll-view class="page">
    <text class="tip">1帧内显示110个元素。勿使用 debug 方式运行来测试性能</text>
    <view>
      <view v-for="r in 5" :key="r" class="row">
        <view v-for="(_, i) in 10" :key="i" class="cell">
          <text>{{ i }}</text>
        </view>
      </view>
    </view>
    <view class="modes">
      <view :class="['mode', { on: mode === 'vdom' }]" @tap="setMode('vdom')"><text class="mode-text">VDOM</text></view>
      <view :class="['mode', { on: mode === 'vapor' }]" @tap="setMode('vapor')"><text class="mode-text">Vapor</text></view>
    </view>
    <view class="btn" @tap="toggle">
      <text class="btn-text">{{ show ? '隐藏' : '同屏显示4050个元素' }}</text>
    </view>
    <view class="bumps">
      <view :class="['bump', { off: !show }]" @tap="bump(1)"><text class="bump-text">改 1 格</text></view>
      <view :class="['bump', { off: !show }]" @tap="bump(200)"><text class="bump-text">改 200 格</text></view>
      <view :class="['bump', { off: !show }]" @tap="bump(2000)"><text class="bump-text">改 2000 格</text></view>
    </view>
    <view class="stats">
      <text class="stat">JS {{ fmt(jsMs) }}</text>
      <text class="stat">上屏 {{ fmt(firstFrameMs) }}</text>
      <text class="stat">最慢帧 {{ fmt(worstFrameMs) }}</text>
    </view>
    <text class="split">{{ split }}</text>
    <template v-if="show">
      <GridVapor v-if="mode === 'vapor'" :vals="vals" />
      <GridVdom v-else :vals="vals" />
    </template>
  </scroll-view>
</template>

<style scoped>
.page {
  flex-grow: 1;
}
.tip {
  margin: 8px 16px 0 16px;
  font-size: 13px;
}
.row {
  flex-direction: row;
}
.cell {
  background-color: #85d8b4;
  margin: 0.5px;
}
.modes {
  flex-direction: row;
  margin: 16px 16px 0 16px;
}
.mode {
  flex-grow: 1;
  height: 36px;
  justify-content: center;
  align-items: center;
  border-width: 1px;
  border-color: #1677ff;
}
.mode.on {
  background-color: #1677ff;
}
.mode-text {
  font-size: 14px;
  color: #1677ff;
}
.mode.on .mode-text {
  color: #ffffff;
}
.bumps {
  flex-direction: row;
  margin: 0 16px 12px 16px;
}
.bump {
  flex-grow: 1;
  height: 36px;
  margin: 0 4px;
  border-radius: 6px;
  background-color: #e8f0ff;
  justify-content: center;
  align-items: center;
}
.bump.off {
  opacity: 0.4;
}
.bump-text {
  font-size: 13px;
  color: #1677ff;
}
.btn {
  height: 48px;
  margin: 16px;
  background-color: #1677ff;
  border-radius: 8px;
  justify-content: center;
  align-items: center;
}
.btn-text {
  color: #ffffff;
}
.stats {
  flex-direction: row;
  justify-content: space-around;
  margin: 0 16px 8px 16px;
}
.stat {
  font-size: 12px;
}
.split {
  margin: 0 16px 8px 16px;
  font-size: 11px;
  color: #888888;
}
</style>
