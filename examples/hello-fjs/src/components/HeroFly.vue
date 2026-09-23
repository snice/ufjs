<script setup lang="ts">
// 飞行盒：把一张 image 从 from 矩形补间到 to 矩形，两端一份实现（spec 101）。
//
// 为什么是 left/top/width/height 而不是 transform: translate + scale：
// 两个场景的终点宽高比都可能变（方形缩略图 → 详情页的横条大图），
// translate+scale 会把图拉变形；而绝对/固定定位盒的 inset 与 width/height
// 的 transition 是 css-compat.md 里登记过的两端能力（spec 045/073/078）。
//
// transition 写在初始 style 里、不是起飞那一刻：web 与 Dart 引擎都从
// 「变化后的样式」读过渡配置，这样写两端都来得及；初始帧的几何就是 from，
// 没有变化，盒子也不会提前动。
//
// 起飞时序：rAF 里先读一次 getBoundingClientRect，再**隔一个 setTimeout**
// 才切终点——两端各有一帧「前值」：
// - web：插入与改值挤在同一帧时浏览器没有前值可比，transition 静默退化成
//   瞬移，强制布局读 + 帧间隔把前值钉死；
// - App：几何补间由 TweenAnimationBuilder 驱动，它只在「已经用 from 出生过
//   一帧」之后拿到新的 end 才动画——rAF 回调跑在 Flutter build 阶段之前，
//   测距那次 flushNow 只把样式送到了宿主，首建若直接拿到 to 就是首建即
//   终值（Android 实测点开放大瞬移的根因）。隔一个定时器 = 至少一个完整
//   的 build+paint 帧已带着 from 落地。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { FLY_MS, rectOf, type Rect } from '@/hero';

type ImageMode =
  | 'scaleToFill'
  | 'aspectFit'
  | 'aspectFill'
  | 'widthFix'
  | 'heightFix'
  | 'top'
  | 'bottom'
  | 'center'
  | 'left'
  | 'right'
  | 'top left'
  | 'top right'
  | 'bottom left'
  | 'bottom right';

const props = withDefaults(
  defineProps<{
    src: string;
    from: Rect;
    to: Rect;
    /** 图片的填充方式，两端都映射到同一组 mode 值。 */
    mode?: ImageMode;
    /** 飞完全程（含一帧余量）后发 done，调用方据此交还真身。 */
    duration?: number;
  }>(),
  { mode: 'aspectFill', duration: FLY_MS },
);

// tap 显式声明再转发：不声明它会走 attrs 落到根节点上，但 vue-tsc 的
// strictTemplates 不认未声明的监听；声明了就必须手动把根节点的点按
// emit 出去，同页面那侧「点大图 = 收起」两端才都还在
const emit = defineEmits<{ done: []; tap: [] }>();

function onTap() {
  emit('tap');
}

const box = ref<Rect>({ ...props.from });
const el = ref<unknown>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let dead = false;

function styleOf(r: Rect) {
  const ms = props.duration;
  const ease = 'cubic-bezier(0.32,0.72,0,1)';
  return {
    position: 'fixed',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    transition: `left ${ms}ms ${ease}, top ${ms}ms ${ease}, width ${ms}ms ${ease}, height ${ms}ms ${ease}`,
  };
}

onMounted(() => {
  requestAnimationFrame(() => {
    if (dead) return;
    rectOf(el.value); // 强制一次布局读（见头注释）
    // 起点在宿主侧完整落地一帧后才起飞（见头注释的两端原因）
    timer = setTimeout(() => {
      if (dead) return;
      box.value = { ...props.to };
      timer = setTimeout(() => {
        if (!dead) emit('done');
      }, props.duration + 32);
    }, 50);
  });
});

onBeforeUnmount(() => {
  dead = true;
  if (timer !== undefined) clearTimeout(timer);
});
</script>

<template>
  <view ref="el" class="hero-fly" :style="styleOf(box)" @tap="onTap">
    <image class="hero-fly-img" :src="src" :mode="mode" />
  </view>
</template>

<style scoped>
/* 盒子贴边裁图；overflow 不写圆角，两端几何完全同形 */
.hero-fly {
  overflow: hidden;
}
.hero-fly-img {
  width: 100%;
  height: 100%;
}
</style>
