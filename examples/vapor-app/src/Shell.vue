<script setup lang="ts">
// The app shell (specs/167 §8): [nav bar | page]. Every page is wrapped in
// it on both ends — the nav bar's back arrow is the in-app way back (the
// browser's back and the iOS edge swipe work as well). It must be a vapor
// component: an enableVapor app has no VDOM renderer to draw a VDOM shell.
import { useRouter, type RouteLocation } from 'fjs/router'

const props = defineProps<{ route: RouteLocation }>()
const router = useRouter()
</script>

<template>
  <view class="shell">
    <safe-area edges="top" class="nav">
      <!-- three columns: back slot | title | a spacer as wide as the back
           slot, so the title stays centred with or without the arrow -->
      <view class="bar">
        <view class="side">
          <text v-if="props.route.path !== '/'" class="back" @tap="router.back()">‹</text>
        </view>
        <text class="title">{{ props.route.meta.title ?? '' }}</text>
        <view class="side" />
      </view>
    </safe-area>
    <slot />
  </view>
</template>

<style scoped>
.shell { flex-grow: 1; background-color: #ffffff; }
.nav { background-color: #ffffff; border-bottom: 1px solid #ededed; }
.bar { height: 44px; flex-direction: row; align-items: center; }
.side { width: 44px; height: 44px; align-items: center; justify-content: center; }
.back { font-size: 28px; color: #2080f0; }
.title { flex-grow: 1; font-size: 17px; font-weight: bold; color: #191919; text-align: center; }
</style>
