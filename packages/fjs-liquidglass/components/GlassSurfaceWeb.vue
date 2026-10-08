<script setup lang="ts">
// Browser stand-in for the Flutter widget <glass-surface />. The build
// registers it under that tag name, so one template line renders the Dart
// glass shader on a device and this CSS glass in a browser.
//
// Like the Dart side it is a LEAF layer: the page positions it absolutely to
// fill its container and draws content as siblings on top.
//
// Frosting (blur + saturate + tint + hairline highlight) is plain
// `backdrop-filter`, which every engine renders. Refraction needs the
// backdrop to be *bent*, and only Chromium accepts an SVG filter inside
// `backdrop-filter: url(#…)`; Safari and Firefox ignore the whole declaration,
// so those engines get the frosted version only and say so once
// (constitution V) instead of silently looking flat.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    radius?: number;
    blur?: number;
    tint?: string;
    refraction?: number;
    dark?: boolean;
    pressed?: boolean;
  }>(),
  { radius: 0, blur: 20, refraction: 0, dark: false, pressed: false },
);

const uid = `lg-${Math.random().toString(36).slice(2, 9)}`;
const root = ref<HTMLElement | null>(null);
const mapUrl = ref('');
const size = ref({ w: 0, h: 0 });

// Chromium only (Edge/Opera carry the Chrome token too); feature-detecting
// `backdrop-filter: url()` lies in WebKit, which parses the value and then
// renders nothing.
const canRefract = typeof navigator !== 'undefined' && /Chrome\//.test(navigator.userAgent);

let warned = false;
function warnNoRefraction() {
  if (warned) return;
  warned = true;
  console.warn(
    '[liquidglass] this browser cannot refract the backdrop (backdrop-filter: url()); showing frosted glass instead',
  );
}

const wantsRefraction = computed(() => props.refraction > 0);
const refracting = computed(() => wantsRefraction.value && canRefract && !!mapUrl.value);

/** A displacement map for a w×h rounded rect: neutral (128,128) in the
 * middle, pushing sample positions inward along the edge normal inside the
 * bezel, so the edge reads as a lens that bends what is behind it. Cached by
 * shape — a tab bar has one size for its whole life. */
const cache = new Map<string, string>();
function buildMap(w: number, h: number, r: number): string {
  const key = `${w}x${h}r${r}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const rr = Math.min(r, w / 2, h / 2);
  const bezel = Math.max(1, rr * 0.9);
  const hx = w / 2;
  const hy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx;
      const py = y + 0.5 - hy;
      // signed distance to the rounded rect (negative inside) and its normal
      const qx = Math.abs(px) - (hx - rr);
      const qy = Math.abs(py) - (hy - rr);
      let nx = 0;
      let ny = 0;
      let dist: number;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        nx = qx / len;
        ny = qy / len;
        dist = len - rr;
      } else if (qx > qy) {
        nx = 1;
        dist = qx - rr;
      } else {
        ny = 1;
        dist = qy - rr;
      }
      nx *= Math.sign(px) || 1;
      ny *= Math.sign(py) || 1;
      const depth = -dist; // 0 at the edge, grows inward
      let m = 0;
      if (depth >= 0 && depth < bezel) {
        const t = 1 - depth / bezel;
        m = t * t; // quadratic: strongest right at the rim
      }
      const i = (y * w + x) * 4;
      // sample from further in => content is pulled toward the rim
      img.data[i] = Math.round(128 - nx * m * 127);
      img.data[i + 1] = Math.round(128 - ny * m * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}

let ro: ResizeObserver | undefined;
function measure() {
  const el = root.value;
  if (!el) return;
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  if (w !== size.value.w || h !== size.value.h) size.value = { w, h };
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    ro = new ResizeObserver(measure);
    ro.observe(root.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

watch(
  [size, () => props.radius, wantsRefraction],
  () => {
    if (!wantsRefraction.value) return;
    if (!canRefract) return warnNoRefraction();
    const { w, h } = size.value;
    if (w > 0 && h > 0) mapUrl.value = buildMap(w, h, props.radius);
  },
  { immediate: true, deep: true },
);

const tintColor = computed(
  // the same body tints as the Flutter side's iOS 27 presets (0x87F8F8F8 / 0x1FFFFFFF)
  () => props.tint ?? (props.dark ? 'rgba(255,255,255,0.12)' : 'rgba(248,248,248,0.53)'),
);

const style = computed(() => {
  const blur = `blur(${props.blur}px) saturate(${props.pressed ? 230 : props.dark ? 140 : 210}%)`;
  const backdrop = refracting.value ? `url(#${uid}) ${blur}` : blur;
  const rim = props.dark ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.8)';
  return {
    borderRadius: `${props.radius}px`,
    backgroundColor: tintColor.value,
    backdropFilter: backdrop,
    WebkitBackdropFilter: blur,
    // hairline highlight on the rim, a soft lower edge for thickness
    boxShadow: `inset 0 1px 0 ${rim}, inset 0 0 0 0.5px ${rim}, inset 0 -1px 1px rgba(0,0,0,0.06)`,
  };
});
</script>

<template>
  <div ref="root" class="glass-surface" :style="style">
    <svg v-if="refracting" class="defs" width="0" height="0" aria-hidden="true">
      <filter :id="uid" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feImage :href="mapUrl" x="0" y="0" :width="size.w" :height="size.h" result="map" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="map"
          :scale="refraction * 40"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  </div>
</template>

<style scoped>
.glass-surface {
  /* no position here: the page places the layer (absolute fill), and a
     scoped `position` would beat the page's class on specificity ties */
  box-sizing: border-box;
  pointer-events: none;
}
.defs {
  position: absolute;
  pointer-events: none;
}
</style>
