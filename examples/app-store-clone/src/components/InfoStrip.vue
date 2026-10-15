<script setup lang="ts">
// Detail page's stat strip: rating, award, age, rank — equal columns with
// vertical hairlines, scrolling sideways when they do not fit.
import type { AppItem } from '../data/apps';
import Icon from './Icon.vue';

defineProps<{ app: AppItem }>();
</script>

<template>
  <scroll-view scroll-x class="strip">
    <view class="track">
      <view class="cell">
        <text class="cap">{{ app.ratings }}</text>
        <text class="big">{{ app.rating.toFixed(1) }}</text>
        <view class="stars">
          <Icon v-for="i in 5" :key="i" name="star" :size="11" :color="i <= Math.round(app.rating) ? '#8E8E93' : '#D1D1D6'" />
        </view>
      </view>
      <view class="sep" />
      <view class="cell">
        <text class="cap">获奖</text>
        <text class="mid">编辑精选</text>
        <text class="cap2">{{ app.category }}</text>
      </view>
      <view class="sep" />
      <view class="cell">
        <text class="cap">年龄分级</text>
        <text class="big">{{ app.age }}</text>
        <text class="cap2">岁</text>
      </view>
      <view class="sep" />
      <view class="cell">
        <text class="cap">排名</text>
        <text class="big">{{ app.rank }}</text>
        <text class="cap2">{{ app.category }}</text>
      </view>
    </view>
  </scroll-view>
</template>

<style scoped>
.strip {
  width: 100%;
}
.track {
  flex-direction: row;
  align-items: center;
  padding: 14px 20px;
}
.cell {
  width: 110px;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.sep {
  width: 0.5px;
  height: 44px;
  background-color: #d1d1d6;
  flex-shrink: 0;
}
.cap {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
}
.cap2 {
  font-size: 12px;
  color: #8e8e93;
}
.big {
  font-size: 22px;
  font-weight: 700;
  color: #636366;
}
.mid {
  font-size: 15px;
  font-weight: 700;
  color: #636366;
  height: 27px;
}
.stars {
  flex-direction: row;
  gap: 1px;
}
</style>
