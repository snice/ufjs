<route>
{"title": "dart-progress", "group": "基础能力", "desc": "autoimport 调用真实 Widget 包 sn_progress_dialog（本地 facade 包；仅 Flutter，web 只显示说明）"}
</route>

<script setup lang="ts">
import { ref } from 'vue';
import { dartModule, hasDartObjectSupport } from '@ufjs/runtime';
import type { Progress } from '../../fjs-objects';

// Drives sn_progress_dialog, a WIDGET package, through the local `progress`
// facade (demo/dart/progress; fjs autoimport generates the adapter and the
// types — specs/202). The native dialog really opens over the app. The
// dialog's BuildContext comes from the host (demo/src/main.dart wires
// progressContext to FjsApp.currentContext).
//
// A native Material dialog has no browser counterpart, so on the web the page
// shows a note instead of calling dartModule (the same difference as the
// mmkv page; docs/web.md).
const supported = hasDartObjectSupport();

const log = ref<string[]>([]);
const open = ref(false);
let current: Progress | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let value = 0;

function note(msg: string): void {
  log.value = [...log.value, msg].slice(-12);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Registers the status callback BEFORE show(): `opened` fires synchronously
// inside it.
function make(msg: string, max = 100): Progress {
  const p = dartModule('progress').Progress(msg, max);
  p.onStatus((s) => {
    note(`status ${s}`);
    if (s === 'closed') open.value = false;
  });
  return p;
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

// The dialog is modal (its barrier blocks the page), so nothing here waits
// for a tap on this page while it is open: every scenario ends by itself or
// by a JS-timed close(), which is exactly the call being tested.
function indeterminate(): void {
  stop();
  const p = make('请稍候…');
  current = p;
  open.value = true;
  void p.show(false).then(() => note('show resolved'));
  setTimeout(() => {
    p.close();
    note(`close() → isOpen=${p.isOpen}`);
  }, 2000);
}

// JS-driven determinate progress: the timer lives in JS, each tick is one
// update() call into Dart; at max the dialog completes and closes itself.
function auto(): void {
  stop();
  const p = make('下载中…');
  current = p;
  value = 0;
  open.value = true;
  void p.show(true).then(() => {
    stop();
    note('show resolved');
  });
  timer = setInterval(() => {
    value += 20;
    p.update(value, `${value}%`);
    note(`update ${value}`);
    if (value >= 100) stop();
  }, 300);
}

// Closing BEFORE max: an explicit close() path, then a late update() on the
// closed dialog must neither throw nor reopen it.
async function early(): Promise<void> {
  stop();
  const p = make('提前关闭');
  current = p;
  open.value = true;
  const done = p.show(true);
  await sleep(300);
  p.update(40, '40%');
  note('update 40');
  await sleep(700);
  p.close();
  await done;
  note(`closed early, isOpen=${p.isOpen}`);
  p.update(80);
  note('update after close → no throw');
}

// The whole call chain in order, so the log can be read against the spec:
// status opened → update 30/60/100 → status completed → status closed →
// show resolved.
async function script(): Promise<void> {
  stop();
  log.value = [];
  const p = make('脚本');
  current = p;
  open.value = true;
  const done = p.show(true);
  for (const v of [30, 60, 100]) {
    await sleep(400);
    p.update(v, `${v}%`);
    note(`update ${v}`);
  }
  await done;
  note('show resolved');
}
</script>

<template>
  <view class="page">
    <text v-if="!supported" class="title">仅 Flutter：进度弹窗是原生 Widget（sn_progress_dialog），浏览器没有对应实现，此页在 web 上只显示说明。</text>
    <view v-else>
      <text class="title">sn_progress_dialog · {{ open ? '弹窗打开中' : '未打开' }}</text>
      <view class="row">
        <button class="btn" @tap="indeterminate">不定进度</button>
        <button class="btn" @tap="auto">确定进度（自动）</button>
      </view>
      <view class="row">
        <button class="btn" @tap="early">提前关闭</button>
        <button class="btn primary" @tap="script">一键脚本</button>
      </view>
      <view class="log">
        <text v-for="(line, i) in log" :key="i" class="line">{{ line }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  height: 0px;
  flex-grow: 1;
  padding: 16px;
}
.title {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 12px;
}
.row {
  flex-direction: row;
  gap: 8px;
  margin-bottom: 8px;
}
.btn {
  flex-grow: 1;
  padding: 8px 10px;
  background: #eef2ff;
  border-radius: 8px;
  font-size: 13px;
  color: #3730a3;
  text-align: center;
}
.primary {
  background: #4f46e5;
  color: #ffffff;
}
.log {
  margin-top: 12px;
  padding: 10px;
  background: #f3f4f6;
  border-radius: 8px;
  min-height: 120px;
}
.line {
  font-size: 12px;
  color: #374151;
  margin-bottom: 4px;
}
</style>
