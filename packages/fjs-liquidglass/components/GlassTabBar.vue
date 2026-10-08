<script setup lang="ts">
// The "liquid-glass" tab bar style: a floating glass capsule with a lighter
// glass slider under the selected item.
//
// The slider has two faces: a flat grey pill at rest and, while it moves, a
// second piece of glass (lens) with refraction. An earlier 72%-white pill read
// as a plain white block, not glass, and a permanent teal glass pill did not
// match the system control. The lens is a sibling layer under the items, not
// a child of the capsule's glass, so it does not hit liquid_glass_widgets'
// "glass inside glass degrades" rule; it just samples the capsule below it.
//
// Layering inside the capsule (bottom to top): <glass-surface> fill, the
// slider (its own thin glass), then the items.
//
// Colors are passed in / derived from `dark` instead of read from page CSS
// variables: the global bar lives outside every page tree (specs/210), so
// the page root's --fjs-* never reach it.
//
// `radius` is written twice on purpose (the glass shape and the CSS
// border-radius that clips shadow/decoration): they must be the same number
// or the glass and its shadow drift apart.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { sliderLeftPercent } from '../slider';

const props = withDefaults(
  defineProps<{
    tabs: { path: string; title: string; tab: number }[];
    active: number | null;
    dark?: boolean;
    /** Selected-item color. */
    accent?: string;
    /** Glass refraction 0–1; 0 is plain frosted glass. */
    refraction?: number;
  }>(),
  { dark: false, accent: '#007AFF', refraction: 0.6 },
);
const emit = defineEmits<{ (e: 'select', path: string): void }>();

const HEIGHT = 56;
const RADIUS = HEIGHT / 2;
const PAD = 4;

// Slider choreography (modelled on the system tab bar, observed on the iOS
// Photos app): at rest it is a flat grey pill; while it travels to a new tab
// it turns into a lens — bigger, refracting, lifted over the capsule edge —
// and settles back with a small overshoot. `moving` drives all of it, and a
// timer ends it because the engine has no transitionend for left/width on
// every target (css-compat: inset transitions do not report their end).
const MOVE_MS = 380;
const moving = ref(false);
let settle: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.active,
  (now, before) => {
    if (before === undefined || before === null || now === null) return;
    moving.value = true;
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => {
      moving.value = false;
    }, MOVE_MS);
  },
);
onBeforeUnmount(() => {
  if (settle) clearTimeout(settle);
});

const count = computed(() => props.tabs.length);
const sliderStyle = computed(() => ({
  left: `${sliderLeftPercent(props.active, count.value)}%`,
  width: `${count.value > 0 ? 100 / count.value : 0}%`,
  opacity: props.active === null ? 0 : 1,
  // scaled around the center: stretches and lifts while moving
  transform: moving.value ? 'scale(1.14, 1.18)' : 'scale(1, 1)',
}));
// rest pill and lens swap: only one of them is visible at a time
const restColor = computed(() =>
  props.dark ? 'rgba(255,255,255,0.16)' : 'rgba(120,120,128,0.16)',
);
const lensTint = computed(() =>
  props.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.34)',
);
const idle = computed(() => (props.dark ? '#F2F2F7' : '#1A1A1A'));
</script>

<template>
  <view class="capsule" :style="{ height: HEIGHT + 'px', borderRadius: RADIUS + 'px' }">
    <glass-surface class="fill" :radius="RADIUS" :blur="20" :refraction="refraction" :dark="dark" />
    <view class="track" :style="{ left: PAD + 'px', right: PAD + 'px', top: PAD + 'px', bottom: PAD + 'px' }">
      <view class="slider" :style="sliderStyle">
        <view
          class="rest"
          :style="{ backgroundColor: restColor, borderRadius: RADIUS - PAD + 'px', opacity: moving ? 0 : 1 }"
        />
        <!-- mounted only while moving (v-if, not opacity): liquid_glass_widgets
             cannot be faded from an ancestor Opacity — a backdrop layer ignores it -->
        <glass-surface
          v-if="moving"
          class="fill"
          :radius="RADIUS - PAD"
          :blur="6"
          :tint="lensTint"
          :refraction="0.9"
          pressed
          :dark="dark"
        />
      </view>
    </view>
    <view class="items" :style="{ padding: PAD + 'px' }">
      <view
        v-for="(tab, i) in tabs"
        :key="tab.path"
        class="item"
        :style="{ color: active === i ? accent : idle }"
        @tap="() => emit('select', tab.path)"
      >
        <slot name="item" :item="tab" :active="active === i" :index="i">
          <text class="label">{{ tab.title }}</text>
        </slot>
      </view>
    </view>
  </view>
</template>

<style scoped>
.capsule {
  position: relative;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
}
.fill {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
}
.track {
  position: absolute;
}
.slider {
  position: absolute;
  top: 0;
  bottom: 0;
  /* overshoot curves: the travel and the scale both settle past their target
     and come back, the "jelly" of the system control */
  transition: left 0.38s cubic-bezier(0.34, 1.3, 0.64, 1),
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s;
}
.rest {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  transition: opacity 0.15s;
}
.items {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  flex-direction: row;
}
.item {
  flex-grow: 1;
  align-items: center;
  justify-content: center;
  gap: 1px;
}
.label {
  font-size: 10px;
}
</style>
