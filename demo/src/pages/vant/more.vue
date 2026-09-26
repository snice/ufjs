<route>
{"title": "vant: more", "group": "Vant", "desc": "Card / Circle / Collapse / Steps / Progress / Skeleton …"}
</route>

<script setup lang="ts">
import { ref } from 'vue';

const activeNames = ref(['1']);
const accordionName = ref('');
const stepsActive = ref(1);
// vant Circle animates currentRate toward rate (raf) and reports it through
// v-model:current-rate; without the binding the arc stays at 0 on both ends
const circleA = ref(0);
const circleB = ref(0);
// one value drives both Progress bars and both Circles: the buttons probe
// the width/left transitions (Progress) and the rate animation (Circle)
const percent = ref(30);
const step = (delta: number) => {
  percent.value = Math.min(100, Math.max(0, percent.value + delta));
};
const countDownTime = 2 * 60 * 60 * 1000 + 24 * 60 * 1000 + 30 * 1000;
const countDownFinished = ref(false);
const longText =
  'fjs 用 Flutter 渲染 Vue 组件库：CSS 引擎按 web 的同一份样式表解析，' +
  '本页探测多行截断、展开收起、进度条、步骤条、倒计时与骨架屏在两端的表现。';
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · 展示与布局</text>
    <text class="page-note">
      探测动画（NoticeBar 的 JS 过渡跑马灯、Skeleton 的 CSS keyframes）、折叠过渡
      与 SVG（Circle 进度弧、Empty 插画渐变）的两端一致性；CountDown 是纯 JS
      驱动，两端都应走秒。
    </text>

    <view class="block">
      <text class="block-title">NoticeBar</text>
      <van-notice-bar :scrollable="false" text="静态长文本：在代码中设置 scrollable 为 false 时，文案超宽会直接截断。" />
      <van-notice-bar scrollable text="滚动播放：scrollable 为 true 时，文案超宽会循环滚动（transform 过渡 + transitionend 驱动）。" />
    </view>

    <view class="block">
      <text class="block-title">Collapse（展开 {{ activeNames.join('/') || '∅' }}）</text>
      <van-collapse v-model="activeNames">
        <van-collapse-item title="默认展开" name="1">fjs 的折叠体高度过渡由 JS 驱动 height。</van-collapse-item>
        <van-collapse-item title="默认收起" name="2">点标题展开，再点收起。</van-collapse-item>
      </van-collapse>
      <text class="block-title" style="margin-top: 8px;">手风琴（{{ accordionName || '∅' }}）</text>
      <van-collapse v-model="accordionName" accordion>
        <van-collapse-item title="只开一个" name="a">展开另一项时当前项收起。</van-collapse-item>
        <van-collapse-item title="同上" name="b">第二个手风琴项。</van-collapse-item>
      </van-collapse>
    </view>

    <view class="block">
      <text class="block-title">Card</text>
      <van-card num="2" price="2.00" origin-price="10.00" title="商品标题" desc="描述信息的最常见写法是两行">
        <template #tags>
          <van-tag plain type="danger">免税</van-tag>
          <van-tag type="danger">新品</van-tag>
        </template>
      </van-card>
    </view>

    <!-- 首屏以下：页面转场结束后才挂（specs/118）。占位高度约等于这几块的总高，
         内容补上时滚动条不跳。 -->
    <defer placeholder-height="1200">
      <view class="block">
        <text class="block-title">Progress</text>
        <van-progress class="progress" :percentage="percent" />
        <van-progress class="progress" :percentage="percent" stroke-width="8" :pivot-text="`${percent}/100`" />
        <van-progress class="progress" inactive :percentage="75" />
        <view class="row">
          <van-button size="small" @click="step(-10)">减少</van-button>
          <van-button size="small" type="primary" @click="step(10)">增加</van-button>
          <text class="echo">{{ percent }}%</text>
        </view>
      </view>

      <view class="block">
        <text class="block-title">Circle（SVG 描边 dasharray）</text>
        <view class="row">
          <van-circle v-model:current-rate="circleA" :rate="percent" :speed="100" layer-color="#ebedf0"
            :text="`${Math.round(circleA)}%`" />
          <van-circle v-model:current-rate="circleB" :rate="100 - percent" :speed="100" :text="`${Math.round(circleB)}%`"
            color="#ee0a24" layer-color="#ebedf0" />
        </view>
        <view class="row">
          <van-button size="small" @click="step(-10)">减少</van-button>
          <van-button size="small" type="primary" @click="step(10)">增加</van-button>
          <text class="echo">{{ percent }}%</text>
        </view>
      </view>

      <view class="block">
        <text class="block-title">Steps</text>
        <van-steps :active="stepsActive" active-color="#1989fa">
          <van-step>下单</van-step>
          <van-step>支付</van-step>
          <van-step>发货</van-step>
          <van-step>完成</van-step>
        </van-steps>
      </view>

      <view class="block">
        <text class="block-title">CountDown{{ countDownFinished ? '（已结束）' : '' }}</text>
        <van-count-down :time="countDownTime" format="HH:mm:ss" @finish="countDownFinished = true" />
        <text class="echo">重进页面时间重置，证明是 JS 计时而非样式。</text>
      </view>

      <view class="block">
        <text class="block-title">Skeleton</text>
        <van-skeleton title avatar :row="3" />
      </view>

      <view class="block">
        <text class="block-title">Empty</text>
        <van-empty description="无内容（默认图是 SVG，两端渲染一致）" />
        <van-empty image="search" description="搜索无结果" />
      </view>

      <!-- 放最后：它挂载时会碰 DOM 测量（innerText/scrollHeight），App 端若抛错
           不至于影响上面的探测块。 -->
      <view class="block">
        <text class="block-title">TextEllipsis</text>
        <van-text-ellipsis :content="longText" :rows="2" expand-text="展开" collapse-text="收起" />
      </view>
    </defer>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出 2137px） */
  height: 0px;
  flex-grow: 1;
  padding: 16px;
  background-color: #f7f8fa;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: #323233;
  margin-bottom: 4px;
}

.page-note {
  font-size: 12px;
  color: #969799;
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
  color: #646566;
  margin-bottom: 8px;
}

.row {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.progress {
  /* pivot 标签 16px 高、竖直居中压在条上：条之间留出它的位置 */
  margin: 12px 0;
}

.echo {
  font-size: 12px;
  color: #1989fa;
  margin-top: 4px;
}
</style>
