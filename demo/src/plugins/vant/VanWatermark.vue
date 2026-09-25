<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  resolveDynamicComponent,
  useSlots,
  watch,
} from 'vue';

// Local replica of vant's Watermark (specs/135). vant's own component tiles a
// Blob-URL'd SVG snapshot via background-image — a pipeline the app side
// cannot run: no innerHTML read off a rendered tree, no Blob /
// URL.createObjectURL on QuickJS, and the CSS engine has no bitmap
// background-image (gradient only, docs/css-compat.md). This replica keeps
// the props / #content slot contract and rebuilds the same tiling from
// primitives both ends already have: rotate around the box center, fixed
// overlay host, pointer-events: none, overflow clipping. Registered as
// `van-watermark` in ../vant.ts — vant's own Watermark stays unregistered,
// so no page-level platform branch and no vite patch are needed.
//
// Geometry mirrors vant: the content box sits at the tile's top-left
// (vant's foreignObject x=0 y=0), rotates around its own center (both ends
// default the transform origin to the box center), and clips at the tile
// edge (vant clips at the SVG viewport). The root class names reuse vant's
// watermark CSS: absolute/fixed cover, pointer-events: none and
// --van-watermark-z-index all come from that stylesheet.
const props = withDefaults(
  defineProps<{
    gapX?: number | string;
    gapY?: number | string;
    image?: string;
    width?: number | string;
    height?: number | string;
    rotate?: number | string;
    zIndex?: number | string;
    content?: string;
    opacity?: number | string;
    fullPage?: boolean;
    textColor?: string;
  }>(),
  {
    gapX: 0,
    gapY: 0,
    width: 100,
    height: 100,
    rotate: -22,
    fullPage: true,
    textColor: '#dcdee0',
  },
);

const slots = useSlots();

// vant's API names the prop `image`, which shadows the <image> tag on the
// web build: the compiler prefers the setup binding, so the tag compiled to
// the prop's VALUE (an URL) and mountElement crashed on it. The Flutter
// build is unaffected (`image` is a native tag there). Render through
// <component :is> instead — resolveDynamicComponent returns the registered
// web adapter and falls back to the bare tag name on Flutter without
// warning; same split as the runtime's picker (specs/008).
const imageTag = resolveDynamicComponent('image');

const num = (v: number | string | undefined, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
};

const tileW = computed(() => num(props.width, 100) + num(props.gapX));
const tileH = computed(() => num(props.height, 100) + num(props.gapY));

// A watermark that silently stops short of its container would hide the
// failure (constitution V); cap the grid and warn once instead.
const MAX_CELLS = 64;
let warnedCapped = false;

const rootStyle = computed(() => {
  const style: Record<string, string> = {
    // vant never overdraws (background-repeat fills exactly); the ceil()
    // grid does, so the root clips the half-cells past the right/bottom edge
    overflow: 'hidden',
  };
  if (props.zIndex !== undefined && `${props.zIndex}` !== '') {
    style.zIndex = `${props.zIndex}`;
  }
  return style;
});

interface Cell {
  key: number;
  style: Record<string, string>;
}

const cells = computed<Cell[]>(() => {
  const list: Cell[] = [];
  for (let r = 0; r < rows.value; r++) {
    for (let c = 0; c < cols.value; c++) {
      list.push({
        key: r * MAX_CELLS + c,
        style: {
          left: `${c * tileW.value}px`,
          top: `${r * tileH.value}px`,
          width: `${tileW.value}px`,
          height: `${tileH.value}px`,
        },
      });
    }
  }
  return list;
});

const innerStyle = computed(() => {
  const style: Record<string, string> = {
    width: `${num(props.width, 100)}px`,
    height: `${num(props.height, 100)}px`,
    transform: `rotate(${num(props.rotate, -22)}deg)`,
  };
  if (props.opacity !== undefined && `${props.opacity}` !== '') {
    style.opacity = `${num(props.opacity, 1)}`;
  }
  return style;
});

const imageStyle = computed(() => ({
  width: `${num(props.width, 100)}px`,
  height: `${num(props.height, 100)}px`,
}));

const textStyle = computed(() => ({ color: props.textColor }));


// Grid size: measured off the root's own rect. window.innerWidth is a dead
// end on the app side (dom-env pins it to 0 on purpose) and only sees the
// viewport anyway, while the absolute (non-full) mode fills its parent.
// fjs tags compile to the Fjsview wrapper component, so a template ref hands
// back that instance — the element itself sits behind `$el` (same unwrap as
// the page-level refs in vant-float.vue).
type Measurable = { getBoundingClientRect(): { width: number; height: number } };
const root = ref<Measurable>();
const cols = ref(0);
const rows = ref(0);

const rootEl = (): Measurable | undefined => {
  const host = root.value as (Measurable & { $el?: Measurable }) | undefined;
  return host ? (host.$el ?? host) : undefined;
};

// Same discipline as the Tabs underline patch, one notch stronger: a
// first-nonzero rect is not enough. The page entrance slides the whole
// page, and a mid-slide rect is nonzero but tiny — freezing the grid there
// left the rotate-22 box with a single tile (specs/135). Sample every
// frame and settle only when the rect repeats, with a hard frame budget.
const MEASURE_TRIES = 30;
let tries = 0;
let rafId = 0;
let lastW = -1;
let lastH = -1;

const applyCount = (width: number, height: number) => {
  const colsWanted = Math.ceil(width / tileW.value);
  const rowsWanted = Math.ceil(height / tileH.value);
  if ((colsWanted > MAX_CELLS || rowsWanted > MAX_CELLS) && !warnedCapped) {
    warnedCapped = true;
    console.warn(
      `[van-watermark] container needs ${colsWanted}x${rowsWanted} cells; ` +
        `capped at ${MAX_CELLS} per axis, watermark is clipped`,
    );
  }
  cols.value = Math.min(MAX_CELLS, colsWanted);
  rows.value = Math.min(MAX_CELLS, rowsWanted);
};

const remeasure = () => {
  tries = 0;
  lastW = -1;
  lastH = -1;
  cancelAnimationFrame(rafId);
  const tick = () => {
    const rect = rootEl()?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      // applying every frame is safe (cells never affect the root's own
      // size) and self-corrects while the entrance transition settles
      applyCount(rect.width, rect.height);
      if (rect.width === lastW && rect.height === lastH) return;
      lastW = rect.width;
      lastH = rect.height;
    }
    if (++tries <= MEASURE_TRIES) rafId = requestAnimationFrame(tick);
  };
  tick();
};

// The window surface only exists behind dom-env on the app side (and is
// untyped here — the demo tsconfig ships no DOM lib), hence the cast.
const win = globalThis as {
  window?: {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  };
};
const onResize = () => remeasure();

onMounted(() => {
  remeasure();
  win.window?.addEventListener('resize', onResize);
});
onUnmounted(() => {
  cancelAnimationFrame(rafId);
  win.window?.removeEventListener('resize', onResize);
});

// Tile size flips change how many cells the same rect needs; fullPage flips
// move the root between viewport (fixed) and parent (absolute) sizing.
watch(
  () => [props.width, props.height, props.gapX, props.gapY, props.fullPage],
  () => nextTick(remeasure),
);
</script>

<template>
  <view ref="root" class="van-watermark" :class="{ 'van-watermark--full': fullPage }" :style="rootStyle">
    <view v-for="cell in cells" :key="cell.key" class="van-watermark__cell" :style="cell.style">
      <view class="van-watermark__inner" :style="innerStyle">
        <component v-if="image && !slots.content" :is="imageTag" class="van-watermark__image" :src="image"
          :style="imageStyle" />
        <slot v-else name="content">
          <text class="van-watermark__text" :style="textStyle">{{ content }}</text>
        </slot>
      </view>
    </view>
  </view>
</template>

<style scoped>
.van-watermark__cell {
  position: absolute;
  overflow: hidden;
}

.van-watermark__text {
  /* vant's span inherits the document font; the two ends' text defaults
     differ, so pin the metrics to keep the tile identical (spec 135) */
  font-size: 14px;
  line-height: 20px;
}
</style>
