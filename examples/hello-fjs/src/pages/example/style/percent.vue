<route>
{"title": "百分比间距与圆角", "group": "样式演示", "desc": "gap / border-radius / font-size 的 %，两端同源"}
</route>

<script setup lang="ts">
// % 收尾演示页（spec 079）。
//
// gap 的 % 参照容器自身对应轴（主轴 gap 参照主轴长度）；border-radius 的 %
// 在相对尺寸盒上按解析后的盒尺寸解析（内容自适应盒保持方角，登记过的差
// 异）；font-size 的裸 % 由引擎按父级计算字号改写成 px（根按 16px）。
// 对拍：点「切换间距」看 5% 间距开合；点「切成圆形」看头像变圆；
// 点「缩放字号」看两级字号的 % 联动。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

const spaced = ref(false);
const round = ref(false);
const big = ref(false);
</script>

<template>
  <view>
    <Panel title="百分比间距" desc="gap: 5% —— 参照容器自身宽度；点按在 5% 与 8px 之间切换">
      <view class="row" :class="{ wideGap: spaced }" @tap="spaced = !spaced">
        <view class="chip chip-a">A</view>
        <view class="chip chip-b">B</view>
        <view class="chip chip-c">C</view>
      </view>
    </Panel>

    <Panel title="百分比圆角" desc="width: 40% + border-radius: 50% —— 圆角跟着解析后的盒尺寸走；内容自适应盒保持方角（登记）">
      <view class="avatar-wrap">
        <view class="avatar" :class="{ circle: round }" @tap="round = !round">像</view>
      </view>
    </Panel>

    <Panel title="百分比字号" desc="font-size: 150% / 50% —— 按父级计算字号解析，根元素按 16px；两级嵌套联动">
      <view class="type" :class="{ big: big }" @tap="big = !big">
        <text class="type-title">标题 150%</text>
        <text class="type-sub">副文 50%，随父级字号缩放</text>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.row {
  flex-direction: row;
  gap: 8px;
  transition: gap 0.3s ease;
}
.row.wideGap {
  gap: 5%;
}

.chip {
  width: 56px;
  height: 40px;
  border-radius: 6px;
  color: #ffffff;
  font-size: 15px;
  text-align: center;
  line-height: 40px;
}
.chip-a {
  background-color: #07c160;
}
.chip-b {
  background-color: #2f86ff;
}
.chip-c {
  background-color: #dd524d;
}

.avatar-wrap {
  padding: 4px 0;
}
.avatar {
  width: 40%;
  height: 88px;
  border-radius: 8px;
  background-color: #ececec;
  color: #666666;
  font-size: 28px;
  text-align: center;
  line-height: 88px;
  transition: border-radius 0.3s ease;
}
.avatar.circle {
  border-radius: 50%;
}

.type {
  padding: 8px 12px;
  background-color: #f5f5f5;
  border-radius: 8px;
  font-size: 16px;
  transition: font-size 0.3s ease;
}
.type.big {
  font-size: 20px;
}
.type-title {
  font-size: 150%;
  color: #333333;
}
.type-sub {
  font-size: 50%;
  color: #999999;
}
</style>
