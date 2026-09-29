<route>
{"title": "dart-objects", "group": "基础能力", "desc": "对象 ABI 驱动 autoimport 生成的 mmkv 适配器（同一份页面代码，Flutter 走真包、Web 走替身）"}
</route>

<script setup lang="ts">
import { ref } from 'vue';
import { dartModule } from '@ufjs/runtime';

// The object ABI's capabilities, driven through the adapter `fjs
// autoimport` GENERATED for the real mmkv pub package (specs/160): the
// members below are the package's own public API, not hand-written
// bindings. The generated Dart adapter wraps the real plugin on Flutter;
// there is deliberately NO web stand-in — real mmkv has no browser
// implementation, so on the web dartModule('mmkv') warns once and throws
// (constitution V, the spec-160 difference table). The plugin's own
// `await MMKV.initialize()` runs in the host (demo/src/main.dart,
// fjsAttachHost) BEFORE any page evaluates — pages construct and use.
const kv = dartModule('mmkv').MMKV('demo');


const value = ref<string | null>(null);
const log = ref<string[]>([]);

function note(msg: string): void {
  log.value = [`${msg}`, ...log.value].slice(0, 6);
}

function save(v: string): void {
  note(`encodeString → ${kv.encodeString('user', v)}`);
  value.value = kv.decodeString('user');
}

function read(): void {
  note(`decodeString → ${kv.decodeString('user')}`);
  value.value = kv.decodeString('user');
}

function remove(): void {
  kv.removeValue('user');
  note(`removeValue → count=${kv.count}`);
}

function stats(): void {
  note(`count=${kv.count} totalSize=${kv.totalSize} keys=${kv.allKeys.length} id=${kv.mmapID}`);
}

function check(): void {
  note(`containsKey('user') → ${kv.containsKey('user')}`);
}

function bools(): void {
  kv.encodeBool('flag', true);
  note(`encodeBool/decodeBool → ${kv.decodeBool('flag')}`);
}

function clearAll(): void {
  kv.clearAll();
  note(`clearAll → count=${kv.count}`);
}

function unknown(): void {
  try {
    (kv as unknown as { noSuchMember(): void }).noSuchMember();
  } catch (e) {
    note(`unknown member → ${String(e).slice(0, 48)}`);
  }
}
</script>

<template>
  <view class="page">
    <text class="title">mmkv [{{ kv.mmapID }}]: user = {{ value ?? '∅' }} (count {{ kv.count }})</text>
    <view class="row">
      <button class="btn" @tap="save('zt')">写 user=zt</button>
      <button class="btn" @tap="read">读</button>
      <button class="btn" @tap="remove">删除</button>
    </view>
    <view class="row">
      <button class="btn" @tap="stats">统计</button>
      <button class="btn" @tap="check">containsKey</button>
      <button class="btn" @tap="bools">bool 读写</button>
    </view>
    <view class="row">
      <button class="btn" @tap="clearAll">clearAll</button>
      <button class="btn" @tap="unknown">未知成员</button>
    </view>
    <view class="log">
      <text v-for="(line, i) in log" :key="i" class="line">{{ line }}</text>
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
