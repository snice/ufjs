<route>
{"title": "图标"}
</route>

<script setup lang="ts">
// Everything drawn here comes from the "iconmind" module through one tag:
// <icon-mind /> is a module widget, registered by the toolchain — Flutter
// paints it on a device, inline SVG in a browser.
//
// Nothing here configures it. The module's build step reads this file, sees
// which icons the template names, and generates exactly those for both
// targets — plus their names as types, which is why a typo below is a
// compile error. Writing a new <icon-mind name="…" /> is the whole workflow.
//
// The two names in iconmind.json are the exception: they arrive as data
// (the input at the bottom), so no scan could find them.
import { ref } from 'vue';
import type { IconName, IconWeight } from '@ufjs/iconmind';

const weights: IconWeight[] = ['thin', 'regular', 'bold'];
const weight = ref<IconWeight>('regular');
const tapped = ref('');
// A literal name is checked against what this app ships — `name="nope"` is
// a compile error, and the editor completes the eight. A name that arrives
// as data (this input, an API response) is a plain string, so it needs the
// cast, and an unknown one simply draws nothing.
const typed = ref('rag-pipeline');
const asIcon = (name: string) => name as IconName;
</script>

<template>
  <scroll-view class="page">
    <text class="title">IconMind</text>
    <text class="sub">同一个 &lt;icon-mind /&gt;：App 上 Flutter 绘制，Web 上内联 SVG</text>

    <view class="row">
      <button
        v-for="w in weights"
        :key="w"
        class="btn"
        :class="{ 'btn--on': weight === w }"
        @tap="weight = w"
      >
        {{ w }}
      </button>
    </view>

    <view class="row">
      <view class="cell">
        <icon-mind name="agent" :size="30" :weight="weight" color="#5b4bde" @tap="tapped = 'agent'" />
        <text class="label">agent</text>
      </view>
      <view class="cell">
        <icon-mind
          name="vector-database"
          :size="30"
          :weight="weight"
          color="#5b4bde"
          @tap="tapped = 'vector-database'"
        />
        <text class="label">vector-database</text>
      </view>
      <view class="cell">
        <icon-mind name="prompt" :size="30" :weight="weight" color="#5b4bde" @tap="tapped = 'prompt'" />
        <text class="label">prompt</text>
      </view>
      <view class="cell">
        <icon-mind name="dataset" :size="30" :weight="weight" color="#5b4bde" @tap="tapped = 'dataset'" />
        <text class="label">dataset</text>
      </view>
      <view class="cell">
        <icon-mind name="firewall" :size="30" :weight="weight" color="#5b4bde" @tap="tapped = 'firewall'" />
        <text class="label">firewall</text>
      </view>
      <view class="cell">
        <icon-mind name="check" :size="30" :weight="weight" color="#5b4bde" @tap="tapped = 'check'" />
        <text class="label">check</text>
      </view>
    </view>

    <text class="section">duotone</text>
    <view class="row">
      <icon-mind name="agent" variant="duotone" :weight="weight" :size="30" color="#c2410c" />
      <icon-mind name="vector-database" variant="duotone" :weight="weight" :size="30" color="#c2410c" />
      <icon-mind name="prompt" variant="duotone" :weight="weight" :size="30" color="#c2410c" />
      <icon-mind name="dataset" variant="duotone" :weight="weight" :size="30" color="#c2410c" />
      <icon-mind name="firewall" variant="duotone" :weight="weight" :size="30" color="#c2410c" />
      <icon-mind name="check" variant="duotone" :weight="weight" :size="30" color="#c2410c" />
    </view>
    <text class="tapped">{{ tapped ? `tapped: ${tapped}` : '点一个图标试试' }}</text>

    <text class="section">名字来自数据时（iconmind.json 里那两个）</text>
    <view class="row">
      <input class="input" :value="typed" placeholder="icon slug" @input="typed = $event" />
      <icon-mind :name="asIcon(typed)" :size="30" :weight="weight" color="#111827" />
      <icon-mind
        :name="asIcon(typed)"
        variant="duotone"
        :size="30"
        :weight="weight"
        color="#c2410c"
      />
    </view>
    <text class="hint">模板里没写、iconmind.json 里也没有的名字画不出来</text>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出） */
  height: 0px;
  flex-grow: 1;
  padding: 24px 16px;
  background-color: #ffffff;
}
.title {
  font-size: 24px;
  font-weight: 700;
  color: #111827;
  text-align: center;
}
.sub {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}
.section {
  margin-top: 22px;
  font-size: 13px;
  color: #6b7280;
  text-align: center;
}
.row {
  margin-top: 14px;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 12px;
}
.cell {
  align-items: center;
  width: 96px;
}
.label {
  margin-top: 6px;
  font-size: 11px;
  color: #6b7280;
}
.btn {
  padding: 6px 14px;
  border-radius: 6px;
  background-color: #eef2ff;
  color: #4338ca;
  font-size: 13px;
}
.btn--on {
  background-color: #4338ca;
  color: #ffffff;
}
.tapped {
  margin-top: 14px;
  font-size: 13px;
  color: #111827;
  text-align: center;
}
.input {
  width: 160px;
  padding: 6px 10px;
  border-radius: 6px;
  background-color: #f3f4f6;
  font-size: 13px;
  color: #111827;
}
.hint {
  margin-top: 10px;
  font-size: 11px;
  color: #9ca3af;
  text-align: center;
}
</style>
