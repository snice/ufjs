<route>
{"title": "vant: watermark"}
</route>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'fjs/router';

// 全页水印默认开着：进页即可对拍平铺效果；下面的按钮同时是点穿验证——
// 水印层 pointer-events: none，开着也必须能点。
const showFull = ref(true);
// 全页水印的文字 / 图片两种来源切换
const fullImage = ref(false);
// 宿主级别（specs/136）：page 随页面被盖住，app 跨页存活、pop 即销毁。
// overlay 是 fallthrough attr，不是 vant 的 prop —— 用 v-bind 挂，绕开
// GlobalComponents 的属性名检查（Record<string, unknown> 无法枚举键名）。
const fullLevel = ref<'page' | 'app'>('page');
const overlayProps = computed<Record<string, unknown>>(() =>
  fullLevel.value === 'app' ? { overlay: 'app' } : {},
);
const router = useRouter();
const taps = ref(0);
const showPopup = ref(false);
const logo = 'https://fastly.jsdelivr.net/npm/@vant/assets/logo.png';
const vantMark = 'https://fastly.jsdelivr.net/npm/@vant/assets/vant-watermark.png';
</script>

<template>
  <scroll-view class="page" scroll-y>
    <text class="page-title">vant · Watermark 水印</text>
    <text class="page-note">
      本地复刻组件（spec 135）：vant 的 blob-URL 平铺管线 App 端不存在，这里用
      absolute 格子 + transform 旋转重建，props 与 #content 插槽对齐 vant，两端
      同一份实现。局部示例的容器是 relative 定位，全页水印走 fixed → overlay 宿主。
    </text>
    
    <view class="block">
      <text class="block-title">文字水印（局部）</text>
      <view class="wm-box">
        <van-watermark :full-page="false" content="Vant Watermark" :opacity="0.6" />
      </view>
      <text class="echo">文字色是 vant 默认的 #dcdee0（透明度 0.6），本就若有若无。</text>
    </view>

    <view class="block">
      <text class="block-title">图片水印（opacity 0.2）</text>
      <view class="wm-box">
        <van-watermark :full-page="false" :image="logo" :width="60" :height="60" :opacity="0.2" />
      </view>
    </view>

    <view class="block">
      <text class="block-title">自定义间距（gap 30 / 10）</text>
      <view class="wm-box">
        <van-watermark :full-page="false" :image="logo" :width="60" :height="60" :opacity="0.2"
          :gap-x="30" :gap-y="10" />
      </view>
    </view>

    <view class="block">
      <text class="block-title">自定义旋转（rotate 22）</text>
      <view class="wm-box">
        <van-watermark :full-page="false" :image="logo" :width="60" :height="60" :opacity="0.2"
          rotate="22" />
      </view>
    </view>

    <view class="block">
      <text class="block-title">自定义内容（#content 插槽）</text>
      <view class="wm-box">
        <van-watermark :full-page="false" :width="150" :height="48" :rotate="-12" :gap-y="16"
          :opacity="0.85">
          <template #content>
            <view class="mark">
              <text class="mark-t">内部资料</text>
              <text class="mark-s">fjs · confidential</text>
            </view>
          </template>
        </van-watermark>
      </view>
    </view>

    <view class="block">
      <text class="block-title">全页水印与层级（{{ showFull ? '开' : '关' }}）</text>
      <view class="row">
        <van-button size="small" type="primary" @click="showFull = !showFull">
          {{ showFull ? '关闭全页水印' : '打开全页水印' }}
        </van-button>
        <van-button size="small" :type="fullImage ? 'default' : 'primary'" @click="fullImage = false">
          文字
        </van-button>
        <van-button size="small" :type="fullImage ? 'primary' : 'default'" @click="fullImage = true">
          图片
        </van-button>
        <van-button size="small" :type="fullLevel === 'app' ? 'primary' : 'default'" @click="fullLevel = fullLevel === 'app' ? 'page' : 'app'">
          宿主：{{ fullLevel === 'app' ? 'app 级' : '页面级' }}
        </van-button>
        <van-button size="small" @click="router.push('/about')">去 /about 验证跨页</van-button>
        <van-button size="small" @click="showPopup = true">弹层压在水印上</van-button>
      </view>
      <text class="echo">
        水印开着时下面的按钮仍可点（点穿）：当前 {{ taps }} 次。弹层 z-index
        （2000+）应在水印（100）之上。
      </text>
      <view class="row">
        <van-button size="small" type="warning" @click="taps++">点我计数 +1</van-button>
      </view>
    </view>

    <!-- 全页水印：fixed → renderer hoist 进本页的页面级 overlay 宿主
         （specs/133：宿主贴本页 entry、随页面销毁离开，不是 app 级），点穿靠
         vant 水印 CSS 的 pointer-events: none。图片原始 606×194，tile 按
         原始比例给 125×40，否则 <image> 会被拉扁。 -->
    <van-watermark v-if="showFull" v-bind="overlayProps"
      :content="fullImage ? undefined : 'fjs · Vue3 + Flutter'"
      :image="fullImage ? vantMark : undefined" :width="125" :height="40" :opacity="0.5" />

    <van-popup v-model:show="showPopup" round :style="{ padding: '32px 24px' }">
      <text class="popup-text">弹层在水印之上：水印 z-index 100，弹层默认 2000+。</text>
    </van-popup>
  </scroll-view>
</template>

<style scoped>
.page {
  /* height:0 归零基数：内容高不能当基数（同 vant-more） */
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

.wm-box {
  position: relative;
  height: 150px;
  background-color: #ffffff;
}

.mark {
  padding-left: 6px;
}

.mark-t {
  font-size: 14px;
  font-weight: 600;
  color: #646566;
}

.mark-s {
  font-size: 10px;
  color: #969799;
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
  margin-bottom: 8px;
}

.popup-text {
  font-size: 14px;
  color: #323233;
}
</style>
