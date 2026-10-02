<route>
{"title": "动画与缓存"}
</route>

<script setup vapor lang="ts">
// specs/174: <Transition> (v-if, v-show, out-in dynamic component) and
// <KeepAlive> in a vapor page
import { ref, shallowRef } from 'vue'
import TabA from '../components/TabA.vue'
import TabB from '../components/TabB.vue'

const showIf = ref(true)
const maskOpen = ref(false)
let nextId = 4
const rows = ref([1, 2, 3])
const addRow = () => {
  rows.value.splice(Math.floor(Math.random() * (rows.value.length + 1)), 0, nextId++)
}
const removeRow = (id: number) => {
  rows.value = rows.value.filter((r) => r !== id)
}
const shuffle = () => {
  rows.value = [...rows.value].sort(() => Math.random() - 0.5)
}
const page = ref(0)
const showShow = ref(true)
const tab = shallowRef(TabA)
const kept = shallowRef(TabA)
const flipTab = () => {
  tab.value = tab.value === TabA ? TabB : TabA
}
const flipKept = () => {
  kept.value = kept.value === TabA ? TabB : TabA
}
</script>

<template>
  <scroll-view scroll-y class="page">
    <text class="h">v-if · fade</text>
    <text class="btn" @tap="showIf = !showIf">切换</text>
    <Transition name="fade">
      <view v-if="showIf" class="box if-box"><text>v-if</text></view>
    </Transition>

    <text class="h">v-show · slide</text>
    <text class="btn" @tap="showShow = !showShow">切换</text>
    <Transition name="slide">
      <view v-show="showShow" class="box show-box"><text>v-show</text></view>
    </Transition>

    <text class="h">out-in 动态组件</text>
    <text class="btn" @tap="flipTab">换一个</text>
    <Transition name="fade" mode="out-in">
      <component :is="tab" />
    </Transition>

    <text class="h">KeepAlive（计数切回不清零）</text>
    <text class="btn" @tap="flipKept">换一个</text>
    <KeepAlive>
      <component :is="kept" />
    </KeepAlive>

    <text class="h">TransitionGroup（点行删除）</text>
    <view class="ops">
      <text class="btn add-row" @tap="addRow">添加</text>
      <text class="btn shuffle" @tap="shuffle">打乱</text>
    </view>
    <TransitionGroup name="list" tag="view" class="rows">
      <view v-for="id in rows" :key="id" class="row" @tap="removeRow(id)"><text>第 {{ id }} 行</text></view>
    </TransitionGroup>

    <text class="h">swiper circular（当前 {{ page }}）</text>
    <swiper class="sw" circular indicator-dots @change="(i: string) => (page = Number(i))">
      <swiper-item v-for="n in 3" :key="n" :class="'slide s' + n"><text>第 {{ n }} 页</text></swiper-item>
    </swiper>

    <text class="h">Teleport 遮罩</text>
    <text class="btn open-mask" @tap="maskOpen = true">打开遮罩</text>
    <Teleport to="body">
      <Transition name="fade">
        <view v-if="maskOpen" class="mask" @tap="maskOpen = false"><text class="mask-text">点任意处关闭</text></view>
      </Transition>
    </Teleport>
  </scroll-view>
</template>

<style scoped>
.page { flex: 1; padding: 16px; }
.h { font-size: 13px; color: #969799; margin-top: 16px; }
.btn { color: #1989fa; padding: 8px 0; }
.box { height: 56px; border-radius: 8px; align-items: center; justify-content: center; }
.if-box { background-color: #d9ecff; }
.show-box { background-color: #e1f3d8; }
.sw { height: 120px; margin-top: 8px; }
.ops { flex-direction: row; }
.ops .btn { margin-right: 24px; }
.row { height: 40px; justify-content: center; padding-left: 12px; margin-bottom: 4px; background-color: #f2f3f5; border-radius: 6px; }
.list-enter-active, .list-leave-active { transition: opacity 0.3s, transform 0.3s; }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateX(40px); }
.list-move { transition: transform 0.3s; }
.slide { align-items: center; justify-content: center; }
.s1 { background-color: #fde2e2; }
.s2 { background-color: #e1f3d8; }
.s3 { background-color: #d9ecff; }
.mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.6); align-items: center; justify-content: center; }
.mask-text { color: #ffffff; font-size: 16px; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform 0.3s, opacity 0.3s; }
.slide-enter-from, .slide-leave-to { transform: translateX(40px); opacity: 0; }
</style>
