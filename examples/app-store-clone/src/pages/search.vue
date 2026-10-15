<route>
{"title": "搜索", "tab": 4}
</route>

<script setup lang="ts">
// Search tab: local filtering by name / subtitle / developer. Empty query shows
// the "recommended" shelf and the browse grid; a query shows plain result rows.
import { computed, ref } from 'vue';
import { APPS, appsOf } from '@/data/apps';
import { BROWSE } from '@/data/stories';
import LargeTitle from '@/components/LargeTitle.vue';
import SearchBox from '@/components/SearchBox.vue';
import SectionTitle from '@/components/SectionTitle.vue';
import AppRowPager from '@/components/AppRowPager.vue';
import AppRow from '@/components/AppRow.vue';
import BrowseCard from '@/components/BrowseCard.vue';

const query = ref('');
const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  return APPS.filter((a) =>
    `${a.name} ${a.subtitle} ${a.developer}`.toLowerCase().includes(q),
  );
});
const recommended = appsOf(['spark', 'chatly', 'canvas']);
// two tiles per row
const rows = BROWSE.reduce<(typeof BROWSE)[]>((acc, t, i) => {
  if (i % 2 === 0) acc.push([t]);
  else acc[acc.length - 1]!.push(t);
  return acc;
}, []);
</script>

<template>
  <view>
    <LargeTitle title="搜索" />
    <SearchBox v-model="query" />
    <view v-if="query.trim()" class="results">
      <AppRow v-for="(a, i) in results" :key="a.id" :app="a" :divider="i < results.length - 1" />
      <text v-if="!results.length" class="empty">没有找到「{{ query.trim() }}」</text>
    </view>
    <view v-else>
      <SectionTitle title="为你推荐" />
      <AppRowPager :apps="recommended" />
      <SectionTitle title="浏览" />
      <view class="grid">
        <view v-for="(r, i) in rows" :key="i" class="grid-row">
          <BrowseCard v-for="t in r" :key="t.title" :title="t.title" :gradient="t.gradient" :emoji="t.emoji" />
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.results {
  padding: 12px 20px 0;
}
.empty {
  padding: 40px 0;
  text-align: center;
  font-size: 15px;
  color: #8e8e93;
}
.grid {
  padding: 8px 20px 0;
  gap: 12px;
}
.grid-row {
  flex-direction: row;
  gap: 12px;
}
</style>
