<route>
{"title": "vant: form"}
</route>

<script setup lang="ts">
import { ref } from 'vue';

const name = ref('');
const password = ref('');
const checked = ref(true);
const checkboxGroup = ref(['a']);
const radio = ref('1');
const stepper = ref(1);
const rate = ref(3);
const slider = ref(30);
const halfRate = ref(2.5);
const range = ref<[number, number]>([20, 60]);
const verticalSlider = ref(40);
const bigStepper = ref(10);
const age = ref('');
const remark = ref('');
const agree = ref(false);
const notify = ref(false);
const plan = ref('month');
const tags = ref(['ui']);
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · 表单输入</text>
    <text class="page-note">每个控件的值都回显在行内，用于确认 v-model 两端都通。</text>

    <view class="block">
      <text class="block-title">Field</text>
      <van-cell-group inset>
        <van-field v-model="name" label="姓名" placeholder="请输入" clearable />
        <van-field v-model="password" type="password" label="密码" placeholder="请输入密码" />
      </van-cell-group>
      <text class="echo">name = {{ name || '∅' }} · password 长度 = {{ password.length }}</text>
    </view>

    <view class="block">
      <text class="block-title">Switch</text>
      <view class="row">
        <van-switch v-model="checked" size="22px" />
        <text class="echo">checked = {{ checked }}</text>
      </view>
    </view>

    <view class="block">
      <text class="block-title">Checkbox</text>
      <van-checkbox-group v-model="checkboxGroup" direction="horizontal">
        <van-checkbox name="a">甲</van-checkbox>
        <van-checkbox name="b">乙</van-checkbox>
        <van-checkbox name="c" disabled>丙（禁用）</van-checkbox>
      </van-checkbox-group>
      <text class="echo">选中 = {{ checkboxGroup.join(', ') || '∅' }}</text>
    </view>

    <view class="block">
      <text class="block-title">Radio</text>
      <van-radio-group v-model="radio" direction="horizontal">
        <van-radio name="1">选项一</van-radio>
        <van-radio name="2">选项二</van-radio>
      </van-radio-group>
      <text class="echo">radio = {{ radio }}</text>
    </view>

    <view class="block">
      <text class="block-title">Stepper / Rate / Slider</text>
      <view class="row">
        <van-stepper v-model="stepper" />
        <text class="echo">stepper = {{ stepper }}</text>
      </view>
      <view class="row">
        <van-rate v-model="rate" />
        <text class="echo">rate = {{ rate }}</text>
      </view>
      <van-slider v-model="slider" />
      <text class="echo">slider = {{ slider }}</text>
    </view>

    <view class="block">
      <text class="block-title">更多 Stepper / Rate</text>
      <view class="row">
        <van-stepper v-model="bigStepper" step="5" min="0" max="50" integer />
        <text class="echo">step 5 = {{ bigStepper }}</text>
      </view>
      <view class="row">
        <van-rate v-model="halfRate" allow-half :size="24" color="#ffd21e" void-icon="star" void-color="#eee" />
        <text class="echo">半星 = {{ halfRate }}</text>
      </view>
      <text class="hint">横向滑过星星可连续选分；竖向拖动应滚动页面。</text>
    </view>

    <view class="block">
      <text class="block-title">Slider 变体</text>
      <view class="slider-box">
        <van-slider v-model="range" range />
      </view>
      <text class="echo">range = {{ range.join(' ~ ') }}</text>
      <view class="row vertical-row">
        <view class="vertical-box">
          <van-slider v-model="verticalSlider" vertical />
        </view>
        <text class="echo">vertical = {{ verticalSlider }}</text>
      </view>
      <text class="hint">拖动滑块时页面不应跟着滚动。</text>
    </view>

    <view class="block">
      <text class="block-title">Field 变体</text>
      <van-cell-group inset>
        <van-field v-model="age" type="digit" label="年龄" placeholder="只能输入数字" />
        <van-field
          v-model="remark"
          type="textarea"
          label="备注"
          rows="2"
          autosize
          maxlength="50"
          show-word-limit
          placeholder="多行输入"
        />
        <van-field label="只读" model-value="不可编辑的内容" readonly />
        <van-field label="禁用" model-value="禁用状态" disabled />
      </van-cell-group>
      <text class="echo">age = {{ age || '∅' }} · remark 长度 = {{ remark.length }}</text>
    </view>

    <view class="block">
      <text class="block-title">Cell 内的控件</text>
      <van-cell-group inset>
        <van-cell title="接收通知" center>
          <template #right-icon>
            <van-switch v-model="notify" size="20px" />
          </template>
        </van-cell>
        <van-cell title="同意协议" clickable @click="agree = !agree">
          <template #right-icon>
            <van-checkbox v-model="agree" />
          </template>
        </van-cell>
      </van-cell-group>
      <text class="echo">notify = {{ notify }} · agree = {{ agree }}</text>
    </view>

    <view class="block">
      <text class="block-title">Radio / Checkbox 变体</text>
      <van-radio-group v-model="plan">
        <van-radio name="month" shape="square">按月</van-radio>
        <van-radio name="year" shape="square">按年</van-radio>
      </van-radio-group>
      <text class="echo">plan = {{ plan }}</text>
      <van-checkbox-group v-model="tags" direction="horizontal" :max="2">
        <van-checkbox name="ui" shape="square">UI</van-checkbox>
        <van-checkbox name="js" shape="square">JS</van-checkbox>
        <van-checkbox name="dart" shape="square">Dart</van-checkbox>
      </van-checkbox-group>
      <text class="echo">tags（最多 2 个）= {{ tags.join(', ') || '∅' }}</text>
    </view>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（App 端不收缩，整页溢出） */
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
.hint {
  font-size: 12px;
  color: #969799;
  margin-top: 4px;
}
.slider-box {
  padding: 12px 0;
}
.vertical-row {
  margin-top: 12px;
}
.vertical-box {
  height: 120px;
  padding: 0 12px;
}
.echo {
  font-size: 12px;
  color: #1989fa;
  margin-top: 4px;
}
</style>
