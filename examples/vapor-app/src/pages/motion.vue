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
  <view class="page">
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
  </view>
</template>

<style scoped>
.page { padding: 16px; }
.h { font-size: 13px; color: #969799; margin-top: 16px; }
.btn { color: #1989fa; padding: 8px 0; }
.box { height: 56px; border-radius: 8px; align-items: center; justify-content: center; }
.if-box { background-color: #d9ecff; }
.show-box { background-color: #e1f3d8; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform 0.3s, opacity 0.3s; }
.slide-enter-from, .slide-leave-to { transform: translateX(40px); opacity: 0; }
</style>
