<route>
{"title": "Arcade", "tab": 3, "scroll": false}
</route>

<script setup lang="ts">
// Arcade tab. `scroll: false` because the hero artwork bleeds under the status
// bar, so the page owns its scroll-view and the top safe-area is not reserved
// by the shell. The title floats over the artwork.
import { appsOf } from '@/data/apps';
import ChipRow from '@/components/ChipRow.vue';
import SectionTitle from '@/components/SectionTitle.vue';
import AppRowPager from '@/components/AppRowPager.vue';
import { ARCADE_CHIPS } from '@/data/stories';

const apps = appsOf(['puzzle', 'garden', 'kitty', 'dash', 'owl', 'beat']);
</script>

<template>
  <scroll-view class="page">
    <view class="hero">
      <safe-area edges="top">
        <text class="title">Arcade</text>
      </safe-area>
      <view class="hero-copy">
        <text class="logo">Arcade</text>
        <text class="slogan">无 App 内购买项目，无广告干扰，只有无尽欢乐。</text>
        <view class="cta"><text class="cta-text">接受优惠</text></view>
        <text class="fine">前 1 个月免费，之后 ¥ 6.99/月。</text>
      </view>
    </view>
    <view class="below">
      <ChipRow :chips="ARCADE_CHIPS" />
      <SectionTitle title="Try Before Subscribing" />
      <AppRowPager :apps="apps" />
    </view>
    <view class="clearance" />
  </scroll-view>
</template>

<style scoped>
.page {
  height: 0px;
  flex-grow: 1;
}
.hero {
  height: 560px;
  background: linear-gradient(180deg, #f2f2f7, #8e8e93);
  justify-content: space-between;
}
.title {
  padding: 8px 20px;
  font-size: 34px;
  font-weight: 800;
  color: #000000;
}
.hero-copy {
  align-items: center;
  padding: 0 28px 28px;
  gap: 14px;
}
.logo {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}
.slogan {
  font-size: 24px;
  font-weight: 800;
  line-height: 32px;
  color: #ffffff;
  text-align: center;
}
.cta {
  height: 48px;
  width: 260px;
  border-radius: 24px;
  background-color: #0a84ff;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
}
.cta:active {
  transform: scale(0.96);
}
.cta-text {
  font-size: 17px;
  font-weight: 700;
  color: #ffffff;
}
.fine {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}
.below {
  background-color: #ffffff;
  padding-top: 12px;
}
.clearance {
  height: 100px;
}
</style>
