<route>
{"title": "4050 元素同屏", "scroll": false, "group": "交互演示", "desc": "对标 uni-app x vapor benchmark：点一下同屏挂 4050 个元素"}
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
import { nextTick, ref } from 'vue';
import { nowMs, setOpSink } from 'fjs';
import { styleEngine } from 'fjs/vue';

const show = ref(false);
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

async function toggle() {
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
  show.value = !show.value;
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
    `[flat-4050] show=${show.value} js=${jsMs.value}ms ` +
      `firstFrame=${firstFrameMs.value}ms worst=${worstFrameMs.value}ms | ${split.value}`,
  );
  busy.value = false;
}

const fmt = (v: number | null) => (v == null ? '—' : `${v} ms`);
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
    <view class="btn" @tap="toggle">
      <text class="btn-text">{{ show ? '隐藏' : '同屏显示4050个元素' }}</text>
    </view>
    <view class="stats">
      <text class="stat">JS {{ fmt(jsMs) }}</text>
      <text class="stat">上屏 {{ fmt(firstFrameMs) }}</text>
      <text class="stat">最慢帧 {{ fmt(worstFrameMs) }}</text>
    </view>
    <text class="split">{{ split }}</text>
    <view v-if="show">
      <view v-for="r in 50" :key="r" class="row">
        <view v-for="(_, i) in 40" :key="i" class="cell">
          <text class="tiny">{{ i }}</text>
        </view>
      </view>
    </view>
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
.tiny {
  font-size: 5px;
  line-height: 5px;
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
