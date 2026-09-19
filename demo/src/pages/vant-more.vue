<route>
{"title": "vant: more"}
</route>

<script setup lang="ts">
import { ref } from 'vue';

const activeNames = ref(['1']);
const accordionName = ref('');
const stepsActive = ref(1);
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
      探测动画（NoticeBar/Skeleton 的 CSS keyframes）、折叠过渡、SVG 环形进度
      在 App 端的降级表现；CountDown 是纯 JS 驱动，两端都应走秒。
    </text>

    <view class="block">
      <text class="block-title">NoticeBar</text>
      <van-notice-bar :scrollable="false" text="静态长文本：在代码中设置 scrollable 为 false 时，文案超宽会直接截断。" />
      <van-notice-bar scrollable text="滚动播放：scrollable 为 true 时，文案超宽会循环滚动（依赖 CSS 动画，App 端预期静止）。" />
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
      <van-card
        num="2"
        price="2.00"
        origin-price="10.00"
        title="商品标题"
        desc="描述信息的最常见写法是两行"
      >
        <template #tags>
          <van-tag plain type="danger">免税</van-tag>
          <van-tag type="danger">新品</van-tag>
        </template>
      </van-card>
    </view>

    <view class="block">
      <text class="block-title">Progress</text>
      <van-progress :percentage="25" />
      <van-progress :percentage="50" stroke-width="8" pivot-text="一半" />
      <van-progress inactive :percentage="75" />
    </view>

    <view class="block">
      <text class="block-title">Circle（SVG，App 端预期空缺）</text>
      <view class="row">
        <van-circle :rate="30" :speed="100" :text="`${30}%`" />
        <van-circle :rate="65" :speed="100" :text="`${65}%`" color="#ee0a24" layer-color="#ebedf0" />
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
      <van-empty description="无内容（默认图是 SVG，App 端预期空白）" />
      <van-empty image="search" description="搜索无结果" />
    </view>

    <!-- 放最后：它挂载时会碰 DOM 测量（innerText/scrollHeight），App 端若抛错
         不至于影响上面的探测块。 -->
    <view class="block">
      <text class="block-title">TextEllipsis</text>
      <van-text-ellipsis :content="longText" :rows="2" expand-text="展开" collapse-text="收起" />
    </view>
  </scroll-view>
</template>

<style scoped>
.page {
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
.echo {
  font-size: 12px;
  color: #1989fa;
  margin-top: 4px;
}
</style>
