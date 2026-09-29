<script setup lang="ts">
// flat-4050 with live text: every cell reads its own slot of a reactive
// array, so an update can touch 1, 200 or all 2000 cells (specs/148).
defineProps<{ show: boolean; vals: number[] }>();
</script>

<template>
  <view>
    <view v-if="show">
      <view v-for="r in 50" :key="r" class="row">
        <view v-for="(_, i) in 40" :key="i" class="cell">
          <text class="tiny">{{ vals[(r - 1) * 40 + i] }}</text>
        </view>
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
