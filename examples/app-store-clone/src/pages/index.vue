<route>
{"title": "Today", "tab": 0}
</route>

<script setup lang="ts">
// Today tab: story card, sponsored card, "trending" list card. Tapping a story
// or the list card expands it into a full-screen story (CardExpand).
import { ref } from 'vue';
import { rectOf, type Rect } from '@/hero';
import { STORIES, type Story } from '@/data/stories';
import LargeTitle from '@/components/LargeTitle.vue';
import StoryCard from '@/components/StoryCard.vue';
import AdCard from '@/components/AdCard.vue';
import ListCard from '@/components/ListCard.vue';
import CardExpand from '@/components/CardExpand.vue';

const cat = STORIES[0]!;
const popular = STORIES[1]!;

// Card elements by story id: re-measured on close, so the card stays mounted.
// It is not hidden while the overlay is up: the hero box is opaque and starts
// exactly on the card, so it covers it.
const cardEls = new Map<string, unknown>();
const setCard = (id: string) => (el: unknown) => {
  if (el) cardEls.set(id, el);
};

const open = ref<{ story: Story; from: Rect } | null>(null);

function expand(story: Story) {
  if (open.value) return;
  open.value = { story, from: rectOf(cardEls.get(story.id)) };
}
</script>

<template>
  <view class="page">
    <LargeTitle title="Today" />
    <view class="cards">
      <view :ref="setCard(cat.id)">
        <StoryCard :story="cat" @open="expand(cat)" />
      </view>
      <AdCard app-id="spark" />
      <view :ref="setCard(popular.id)">
        <ListCard :story="popular" @open="expand(popular)" />
      </view>
    </view>

    <!-- one per story, always mounted (see CardExpand) -->
    <CardExpand
      v-for="s in STORIES"
      :key="s.id"
      :story="s"
      :request="open?.story.id === s.id ? open : null"
      :measure-card="() => rectOf(cardEls.get(s.id))"
      @closed="open = null"
    />
  </view>
</template>

<style scoped>
.cards {
  padding: 8px 20px 0;
  gap: 18px;
}
</style>
