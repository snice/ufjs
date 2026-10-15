<route>
{"title": "游戏", "tab": 1}
</route>

<script setup lang="ts">
import FeaturedPage from '@/components/FeaturedPage.vue';
import { GAME_CHIPS, GAME_FEATURED } from '@/data/stories';

const sections = [
  { title: "What We're Playing", appIds: ['kitty', 'dash', 'puzzle', 'garden', 'owl', 'beat'] },
  { title: '必玩游戏精选', appIds: ['puzzle', 'garden', 'kitty'] },
];
</script>

<template>
  <FeaturedPage title="游戏" :chips="GAME_CHIPS" :featured="GAME_FEATURED" :sections="sections" />
</template>
