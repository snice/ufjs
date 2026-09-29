<script setup vapor lang="ts">
// flat-4050 的 50×40 网格（Vapor 版）。每格文本读 vals 里自己那一格，
// 页面改 vals 的若干格就是「局部更新」。与 GridVdom.vue 只差 `vapor`。
defineProps<{ vals: number[] }>();
</script>

<template>
  <view>
    <view v-for="r in 50" :key="r" class="row">
      <view v-for="(_, i) in 40" :key="i" class="cell">
        <text class="tiny">{{ vals[(r - 1) * 40 + i] }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
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
</style>
