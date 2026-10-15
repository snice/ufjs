<route>
{"title": "App", "tab": 2}
</route>

<script setup lang="ts">
import FeaturedPage from '@/components/FeaturedPage.vue';
import { APP_CHIPS, APP_FEATURED } from '@/data/stories';

const sections = [
  { title: '让你爱不释手的 App', appIds: ['spark', 'chatly', 'canvas', 'nova', 'pixel', 'trek'] },
  { title: 'App 排行', appIds: ['owl', 'beat', 'nova'] },
];
</script>

<template>
  <FeaturedPage title="App" :chips="APP_CHIPS" :featured="APP_FEATURED" :sections="sections" />
</template>
