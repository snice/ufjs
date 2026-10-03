<route>
{"title": "dart-playground", "group": "基础能力", "desc": "对象 ABI 六能力：构造/方法/属性、Future→Promise、回调双向、句柄传参、release（Dart 手写模块，web 走 TS 替身，两端日志逐行一致）"}
</route>

<script setup lang="ts">
import { ref } from 'vue';
import { dartModule } from '@ufjs/runtime';
import type { Counter } from '../../fjs-objects';

// The object ABI's six capabilities against a module that has
// no third-party dependency (specs/159 §11): plain Dart classes in
// dart/playground (fjs autoimport generates the adapter and the types,
// specs/201), web twin in src/playground-stub.ts. Every log line is deterministic
// (integers only, no timestamps, errors reduced to a keyword) so the "run
// all" text can be diffed between the Flutter and web builds — that diff is
// the two-end check (T042).
//
// `release` is the MODULE's own method: the framework's dispose op only
// fires from the GC finalizer and has no JS-facing API, so this page shows
// the module's bookkeeping (liveCount), not the framework path.
const pg = dartModule('playground');

const log = ref<string[]>([]);
const summary = ref<string[]>([]);
let cur: Counter | null = null;

function note(msg: string): void {
  log.value = [msg, ...log.value].slice(0, 8);
}

function counter(): Counter {
  if (!cur) cur = pg.Counter(10);
  return cur;
}

function errKind(e: unknown): string {
  const s = String(e);
  return s.includes('released') ? 'released' : s.includes('boom') ? 'boom' : 'other';
}

function make(): void {
  cur = pg.Counter(10);
  note(`Counter(10) value=${cur.value} live=${pg.liveCount()}`);
}

function add(): void {
  note(`add(5) → ${counter().add(5)}`);
}

function stepUp(): void {
  const c = counter();
  c.step = c.step + 1;
  note(`step=${c.step}`);
}

async function wait(): Promise<void> {
  note(`waitFor(30) → ${await pg.waitFor(30)}`);
}

async function fail(): Promise<void> {
  try {
    await pg.failAfter(30);
    note('failAfter → resolved (unexpected)');
  } catch (e) {
    note(`failAfter → rejected (${errKind(e)})`);
  }
}

function fire(): void {
  const c = counter();
  c.onTick((v) => note(`tick ${v}`));
  note(`fire → ${c.fire()}`);
}

// Timer-driven callbacks stay out of "run all": their interleaving with the
// event loop is the one thing the two ends do not promise to match.
function timer(): void {
  const c = counter();
  c.onTick((v) => note(`tick ${v}`));
  c.startTimer(3);
}

function adder(): void {
  note(`makeAdder(3)(4) → ${pg.makeAdder(3)(4)}`);
}

function cloneMerge(): void {
  const c = counter();
  const d = c.clone();
  note(`clone value=${d.value} merge → ${c.merge(d)} live=${pg.liveCount()}`);
}

function releaseStale(): void {
  const c = counter();
  c.release();
  cur = null;
  note(`released live=${pg.liveCount()}`);
  try {
    c.add(1);
    note('stale add → ok (unexpected)');
  } catch (e) {
    note(`stale add → error (${errKind(e)})`);
  }
}

async function runAll(): Promise<void> {
  const out: string[] = [];
  const say = (s: string): void => {
    out.push(s);
  };
  const base = pg.liveCount();
  const c = pg.Counter(10);
  say(`Counter(10) value=${c.value}`);
  say(`add(5) → ${c.add(5)}`);
  c.step = 2;
  say(`step=${c.step}`);
  say(`add(5) → ${c.add(5)}`);
  say(`waitFor(30) → ${await pg.waitFor(30)}`);
  try {
    await pg.failAfter(30);
    say('failAfter → resolved (unexpected)');
  } catch (e) {
    say(`failAfter → rejected (${errKind(e)})`);
  }
  const seen: number[] = [];
  c.onTick((v) => seen.push(v));
  say(`fire → ${c.fire()} ticks=${seen.join(',')}`);
  say(`makeAdder(3)(4) → ${pg.makeAdder(3)(4)}`);
  const d = c.clone();
  say(`clone value=${d.value} step=${d.step} live=+${pg.liveCount() - base}`);
  say(`merge → ${c.merge(d)}`);
  d.release();
  say(`released d live=+${pg.liveCount() - base}`);
  try {
    d.add(1);
    say('stale add → ok (unexpected)');
  } catch (e) {
    say(`stale add → error (${errKind(e)})`);
  }
  c.release();
  say(`released c live=+${pg.liveCount() - base}`);
  summary.value = out;
  for (const line of out) console.log(`[playground] ${line}`);
}
</script>

<template>
  <view class="page">
    <text class="title">playground · live {{ pg.liveCount() }}</text>
    <view class="row">
      <button class="btn" @tap="make">构造</button>
      <button class="btn" @tap="add">方法 add</button>
      <button class="btn" @tap="stepUp">属性 step</button>
    </view>
    <view class="row">
      <button class="btn" @tap="wait">Promise</button>
      <button class="btn" @tap="fail">reject</button>
      <button class="btn" @tap="adder">Dart→JS 函数</button>
    </view>
    <view class="row">
      <button class="btn" @tap="fire">回调 fire</button>
      <button class="btn" @tap="timer">回调 Timer</button>
      <button class="btn" @tap="cloneMerge">句柄传参</button>
    </view>
    <view class="row">
      <button class="btn" @tap="releaseStale">release</button>
      <button class="btn primary" @tap="runAll">一键跑全部</button>
    </view>
    <view class="log">
      <text v-for="(line, i) in log" :key="i" class="line">{{ line }}</text>
    </view>
    <view v-if="summary.length" class="log summary">
      <text v-for="(line, i) in summary" :key="i" class="line">{{ line }}</text>
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
  min-height: 80px;
}
.summary {
  background: #ecfdf5;
}
.line {
  font-size: 12px;
  color: #374151;
  margin-bottom: 4px;
}
</style>
