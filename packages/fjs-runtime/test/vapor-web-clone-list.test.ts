// The web twin of CLONE_MANY (specs/162): vapor's cloneList seam against
// the DOM backend — a static batch mounts the same tree its per-cell path
// builds (texts from the expressions, not the template's static text), and
// a prop-reading batch mounts, updates and survives hide/show. The vapor
// helpers come from the web entry (its export * from ./runtime); reactive
// comes straight from @vue/reactivity, the same package the runtime uses.
// @vitest-environment happy-dom
import { reactive } from '@vue/reactivity';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileSfc } from './helpers/sfc';

type Web = typeof import('../src/vapor/web');
let vue: Web;

beforeAll(async () => {
  vue = await import('../src/vapor/web');
});

const textsOf = (root: Element): string[] =>
  Array.from(root.querySelectorAll('text')).map((t) => t.textContent ?? '');

const GRID = `
<script setup>
const x = 1
</script>
<template>
  <view>
    <view v-for="r in 2" :key="r" class="row">
      <view v-for="(_, i) in 2" :key="i" class="cell">
        <text class="tiny">{{ i }}</text>
      </view>
    </view>
  </view>
</template>`;

const LIVE_GRID = `
<script setup>
defineProps(['show', 'vals'])
</script>
<template>
  <view>
    <view v-if="show">
      <view v-for="r in 2" :key="r" class="row">
        <view v-for="(_, i) in 2" class="cell">
          <text class="tiny">{{ vals[(r - 1) * 2 + i] }}</text>
        </view>
      </view>
    </view>
  </view>
</template>`;

describe('vapor web cloneList', () => {
  it('mounts a static batch with the expression texts', async () => {
    const sfc = compileSfc(GRID, { vapor: true, runtime: vue as unknown as Record<string, unknown> });
    const root = document.createElement('div');
    vue.createVaporApp(sfc.component as never).mount(root as never);
    expect(textsOf(root)).toEqual(['0', '1', '0', '1']);
    // two rows plus the list's deferred anchor (a comment, so childNodes 3 /
    // children 2)
    expect(root.children[0].childNodes.length).toBe(3);
  });

  it('mounts a live batch, updates it and survives hide/show', async () => {
    const sfc = compileSfc(LIVE_GRID, { vapor: true, runtime: vue as unknown as Record<string, unknown> });
    const root = document.createElement('div');
    const state = reactive({ show: true, vals: [0, 1, 2, 3] }) as { show: boolean; vals: number[] };
    vue
      .createVaporApp(
        vue.defineVaporComponent({
          setup: () => vue.createComponent(sfc.component as never, { show: () => state.show, vals: () => state.vals }),
        }),
      )
      .mount(root as never);
    await Promise.resolve();
    expect(textsOf(root)).toEqual(['0', '1', '2', '3']);
    state.vals[2] = 99;
    await Promise.resolve();
    expect(textsOf(root)).toEqual(['0', '1', '99', '3']);
    state.show = false;
    await Promise.resolve();
    expect(textsOf(root)).toEqual([]);
    state.show = true;
    await Promise.resolve();
    expect(textsOf(root)).toEqual(['0', '1', '99', '3']);
  });
});
