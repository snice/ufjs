// @vitest-environment happy-dom
// specs/180: a component written inside slot content takes its scoped-style
// id from the template that WROTE it (Vue's slotScopeIds), not from the
// component rendering the slot — `<scroll-view><swiper class="sw">` in a
// page with `.sw { … }` scoped, `<form><input class="field">`.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { compileSfc } from './helpers/sfc';

vi.mock('vue', async () => await import('../src/vapor/vue-pure'));
let vue: typeof import('../src/vapor/web-pure');
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  vue = await import('../src/vapor/web-pure');
  for (const t of ['scroll-view', 'switch', 'swiper', 'form', 'input', 'checkbox-group', 'checkbox']) {
    await import(`../src/vapor/tags/web/${t}.ts`);
  }
});

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('slot content is scoped by its author (specs/180)', () => {
  it("component roots inside another component's slot carry the page's data-v id, also after a v-if flips", async () => {
    const comp = compileSfc(`
<script setup>
import { ref } from 'vue'
const more = ref(false)
globalThis.__more = more
</script>
<template>
  <scroll-view class="page">
    <swiper class="sw"><swiper-item><text>1</text></swiper-item></swiper>
    <form><input class="field" /><switch class="sw2" /></form>
    <checkbox-group><checkbox class="cb" name="a" /></checkbox-group>
    <switch v-if="more" class="late" />
  </scroll-view>
</template>
<style scoped>.page{} .sw{} .field{} .sw2{} .cb{} .late{}</style>`, { vapor: true, web: true, runtime: vue as never });
    const root = document.createElement('div');
    document.body.appendChild(root);
    vue.createVaporApp(comp.component as never).mount(root as never);
    await wait();
    for (const sel of ['.page', '.sw', '.field', '.sw2', '.cb']) {
      expect(root.querySelector(sel)?.hasAttribute(comp.scopeId), sel).toBe(true);
    }
    (g.__more as { value: boolean }).value = true;
    await wait();
    expect(root.querySelector('.late')?.hasAttribute(comp.scopeId)).toBe(true);
  });
});
