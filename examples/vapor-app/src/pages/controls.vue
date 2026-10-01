<route>
{"title": "表单"}
</route>

<script setup vapor lang="ts">
// fjs's own controls in a pure-vapor page (specs/171): every tag below is a
// render-function component, run by the vapor render host on both ends —
// the page itself stays a vapor template.
import { ref } from 'vue'

const name = ref('')
const notify = ref(true)
const fruits = ref('[]')
const pickIndex = ref(0)
const range = ['苹果', '香蕉', '橙子']
const rows = ref(['第 1 行', '第 2 行', '第 3 行'])
const submitted = ref('')
const addRow = () => rows.value.push(`第 ${rows.value.length + 1} 行`)
</script>

<template>
  <view class="page">
    <form @submit="(v: string) => (submitted = v)">
      <input class="field" name="name" placeholder="名字" :value="name" @text-changed="(v: string) => (name = v)" />
      <view class="line"><text>通知</text><switch name="notify" :value="notify" @change="(v: string) => (notify = v === '1')" /></view>
      <checkbox-group name="fruits" @change="(v: string) => (fruits = v)">
        <view class="line"><checkbox name="apple" /><text>苹果</text></view>
        <view class="line"><checkbox name="pear" /><text>梨</text></view>
      </checkbox-group>
      <picker mode="selector" :range="range" :value="pickIndex" @change="(v: string) => (pickIndex = Number(v))">
        <text class="pick">选择：{{ range[pickIndex] }}</text>
      </picker>
      <button class="submit" form-type="submit">提交</button>
    </form>
    <text class="out">name={{ name }} notify={{ notify }} fruits={{ fruits }}</text>
    <text class="out">submitted={{ submitted }}</text>
    <text class="add" @tap="addRow">+ 加一行</text>
    <list-view class="list" :items="rows" :item-height="40">
      <template #default="{ item }"><view class="row"><text>{{ item }}</text></view></template>
    </list-view>
  </view>
</template>

<style scoped>
.page { padding: 16px; }
.field { height: 40px; border: 1px solid #ddd; padding: 0 8px; margin-bottom: 8px; }
.line { flex-direction: row; align-items: center; padding: 6px 0; }
.pick { padding: 8px 0; color: #2080f0; }
.submit { margin-top: 8px; }
.out { font-size: 13px; color: #666; padding-top: 6px; }
.add { color: #2080f0; padding: 8px 0; }
.list { height: 200px; }
.row { height: 40px; justify-content: center; border-bottom: 1px solid #eee; }
</style>
