// @vitest-environment happy-dom
// The enableVapor web shell (specs/166): the whole app mounts through the
// vapor runtime's DOM backend — no Vue app, no runtime-dom. vue-router
// drives navigation; its currentRoute ref is the reactive source the
// shell's effect tracks. Pages keep state across navigation (the LRU cache
// hides hosts instead of unmounting them) and scroll positions ride along.
import { afterEach, describe, expect, it } from 'vitest';
import { createFjsApp } from '../src/app/web';
// the DOM backend: the shell's helpers run through it (in an app build the
// compiled pages import fjs/vapor, which registers it — here it is explicit)
import '../src/vapor/web';
import { compileSfc } from './helpers/sfc';

const COUNT_PAGE = `
<script setup>
import { ref } from 'vue'
const n = ref(0)
const inc = () => { n.value++ }
</script>
<template>
  <view class="page">
    <text class="count" @tap="inc">{{ n }}</text>
  </view>
</template>
`;

const OTHER_PAGE = `
<script setup>
import { ref } from 'vue'
const n = ref(7)
</script>
<template>
  <view class="page">
    <text class="other">{{ n }}</text>
  </view>
</template>
`;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('enableVapor: the pure-vapor web shell', () => {
  it('mounts pages through the DOM backend and navigates without a Vue app', async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
    const home = compileSfc(COUNT_PAGE, { vapor: true, runtime: vue });
    const other = compileSfc(OTHER_PAGE, { vapor: true, runtime: vue });

    const app = createFjsApp({
      enableVapor: true,
      routes: [
        { path: '/', component: home.component as never },
        { path: '/other', component: other.component as never },
      ],
      el: '#app',
    });
    document.body.innerHTML = '<div id="app"></div>';
    app.mount();

    const text = (sel: string): string | undefined =>
      document.querySelector(sel)?.textContent ?? undefined;
    expect(text('.count')).toBe('0');

    await app.router.push('/other');
    expect(text('.other')).toBe('7');
    // the visited page is cached hidden, not unmounted
    expect(text('.count')).toBe('0');
    expect((document.querySelector('.count') as HTMLElement).closest('fjs-page')?.style.display).toBe('none');

    // state rides the hidden host: taps while hidden survive the round trip
    (document.querySelector('.count') as HTMLElement).click();
    (document.querySelector('.count') as HTMLElement).click();
    await app.router.back();
    expect(text('.count')).toBe('2');
  });
});
