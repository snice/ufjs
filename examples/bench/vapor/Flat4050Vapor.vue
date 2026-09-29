<script setup vapor lang="ts">
// Same tree as hello-fjs's example/interaction/flat-4050 (the uni-app x
// 4050-element benchmark): 50 rows × 40 cells, each cell a view + text.
defineProps<{ show: boolean }>();
</script>

<template>
  <view>
    <view v-if="show">
      <view v-for="r in 50" :key="r" class="row">
        <view v-for="(_, i) in 40" :key="i" class="cell">
          <text class="tiny">{{ i }}</text>
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
