<route>
{"title": "nutui: form", "group": "NutUI", "desc": "Input / Textarea / Switch / Checkbox / Radio / Rate / InputNumber / SearchBar"}
</route>

<script setup lang="ts">
// NutUI 表单类组件，各取文档基础用法。specs/203：对照 vant/form.vue 的覆盖，
// 表单控件的 v-model、焦点、键盘是 App 端最常出适配问题的地方。
// <script setup> 的模板编译器会把裸标签 <text> 先解析成同名 setup 绑定：
// binding 叫 text 时（曾踩），整页 fjs 文本被编成 resolveDynamicComponent(ref)
// 渲染成注释 —— binding 别用 text/view/button 这类标签名。
import { ref } from 'vue';

const inputText = ref('');
const textarea = ref('');
const on = ref(true);
const checked = ref(['A']);
const radio = ref('1');
const rate = ref(3);
const num = ref(1);
const searched = ref('');
const query = ref('');
function onSearch(v: string): void {
  searched.value = v;
}
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">nutui · 表单</text>
    <text class="page-note">v-model 状态都显示在块内，交互无效时肉眼可见。</text>

    <view class="block">
      <text class="block-title">Input（{{ inputText || '空' }}）</text>
      <nut-input v-model="inputText" placeholder="请输入文字" max-length="20" />
      <nut-input v-model="inputText" placeholder="带清空按钮" clearable />
    </view>

    <view class="block">
      <text class="block-title">Textarea（{{ textarea.length }} 字）</text>
      <nut-textarea v-model="textarea" placeholder="请输入文字" max-length="50" rows="2" />
    </view>

    <view class="block">
      <text class="block-title">Switch（{{ on ? '开' : '关' }}）</text>
      <nut-switch v-model="on" />
      <nut-switch v-model="on" disabled />
    </view>

    <view class="block">
      <text class="block-title">Checkbox（{{ checked.join('、') || '无' }}）</text>
      <nut-checkbox-group v-model="checked">
        <view class="row">
          <nut-checkbox label="A" icon-size="18px">选项 A</nut-checkbox>
          <nut-checkbox label="B" icon-size="18px">选项 B</nut-checkbox>
          <nut-checkbox label="C" icon-size="18px">选项 C</nut-checkbox>
        </view>
      </nut-checkbox-group>
    </view>

    <view class="block">
      <text class="block-title">Radio（{{ radio }}）</text>
      <nut-radio-group v-model="radio">
        <view class="row">
          <nut-radio label="1" icon-size="18px">单选一</nut-radio>
          <nut-radio label="2" icon-size="18px">单选二</nut-radio>
          <nut-radio label="3" disabled icon-size="18px">禁用</nut-radio>
        </view>
      </nut-radio-group>
    </view>

    <view class="block">
      <text class="block-title">Rate（{{ rate }} 星）</text>
      <nut-rate v-model="rate" />
    </view>

    <view class="block">
      <text class="block-title">InputNumber（{{ num }}）</text>
      <nut-input-number v-model="num" :min="0" :max="10" button-size="18px" />
    </view>

    <view class="block">
      <text class="block-title">SearchBar（{{ searched || '未搜索' }}）</text>
      <nut-searchbar v-model="query" @search="onSearch" />
    </view>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出） */
  height: 0px;
  flex-grow: 1;
  padding: 16px;
  background-color: #f7f8fa;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 4px;
}
.page-note {
  font-size: 12px;
  color: #909ca4;
  margin-bottom: 12px;
}
.block {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.block-title {
  font-size: 14px;
  font-weight: 600;
  color: #666666;
  margin-bottom: 8px;
}
.row {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
