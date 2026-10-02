// @vitest-environment happy-dom
// specs/182: VDOM components (vant et al) inside vapor templates on web,
// through runtime-dom's real renderer — a VDOM child written in a vapor slot
// of a VDOM parent injects from that parent, and from the vapor side above.
import { describe, expect, it } from 'vitest';
import { Fragment, defineComponent, h, inject, provide } from 'vue';
import { compileSfc } from './helpers/sfc';

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('vapor ⇄ VDOM interop on web (specs/182)', () => {
  it('a VDOM child in a vapor slot of a VDOM parent injects the parent; style objects reach the element', async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown> & {
      createVaporApp: (c: unknown) => { mount: (el: unknown) => void };
    };
    const Parent = defineComponent({
      setup(_p, { slots }) {
        provide('group', 'G');
        return () => h('div', { class: 'parent', style: { color: 'red' } }, slots.default?.());
      },
    });
    const Child = defineComponent({
      setup() {
        const group = inject<string>('group', 'none');
        const theme = inject<string>('theme', 'none');
        return () => h('span', { class: 'child' }, `${group}/${theme}`);
      },
    });
    const Page = compileSfc(`<script setup>
import { provide } from 'vue'
import Parent from './Parent'
import Child from './Child'
provide('theme', 'dark')
</script>
<template><view><Parent><text>x</text><Child /></Parent><Child /></view></template>`, {
      vapor: true,
      web: true,
      runtime: vue,
      imports: { './Parent': Parent, './Child': Child },
    }).component;
    const root = document.createElement('div');
    document.body.appendChild(root);
    vue.createVaporApp(Page).mount(root);
    await wait();
    const kids = [...root.querySelectorAll('.child')].map((e) => e.textContent);
    // inside the parent's slot: the parent's provide, the page's through it;
    // outside: the page's only
    expect(kids).toEqual(['G/dark', 'none/dark']);
    expect((root.querySelector('.parent') as HTMLElement).style.color).toBe('red');
  });

  it("a VDOM component whose root is another component's fragment, at a slot's root, keeps all its hosts in place", async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown> & {
      createVaporApp: (c: unknown) => { mount: (el: unknown) => void };
    };
    // vant's ActionSheet → Popup → [overlay, popup]: nothing until shown
    const Popup = defineComponent({
      props: { show: Boolean },
      setup(props) {
        return () => h(Fragment, null, [props.show ? h('div', { class: 'overlay' }) : null, props.show ? h('div', { class: 'popup' }, 'sheet') : null]);
      },
    });
    const Sheet = defineComponent({ props: { show: Boolean }, setup: (props) => () => h(Popup, { show: props.show }) });
    const Box = compileSfc(`<script setup></script><template><view class="box"><slot /></view></template>`, { vapor: true, web: true, runtime: vue }).component;
    const Page = compileSfc(`<script setup>
import { ref } from 'vue'
import Box from './Box'
import Sheet from './Sheet'
const open = ref(false)
globalThis.__open = open
</script>
<template><Box><Sheet :show="open" /></Box></template>`, {
      vapor: true,
      web: true,
      runtime: vue,
      imports: { './Box': Box, './Sheet': Sheet },
    }).component;
    const root = document.createElement('div');
    document.body.appendChild(root);
    vue.createVaporApp(Page).mount(root);
    await wait();
    (globalThis as unknown as { __open: { value: boolean } }).__open.value = true;
    await wait();
    expect(root.querySelector('.box .popup')?.textContent).toBe('sheet');
    expect(root.querySelector('.box .overlay')).not.toBeNull();
  });

  it("a VDOM component's root takes the page's scoped-style id, also inside slot content", async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown> & {
      createVaporApp: (c: unknown) => { mount: (el: unknown) => void };
    };
    const Btn = defineComponent({ setup: (_p, { slots }) => () => h('button', { class: 'vbtn' }, slots.default?.()) });
    const Wrap = defineComponent({ setup: (_p, { slots }) => () => h('div', { class: 'wrap' }, slots.default?.()) });
    const page = compileSfc(`<script setup>
import Btn from './Btn'
import Wrap from './Wrap'
</script>
<template><view><Btn class="a">x</Btn><Wrap><Btn class="b">y</Btn></Wrap></view></template>
<style scoped>.a{} .b{}</style>`, { vapor: true, web: true, runtime: vue, imports: { './Btn': Btn, './Wrap': Wrap } });
    const root = document.createElement('div');
    document.body.appendChild(root);
    vue.createVaporApp(page.component).mount(root);
    await wait();
    expect(root.querySelector('.a')?.hasAttribute(page.scopeId)).toBe(true);
    expect(root.querySelector('.wrap')?.hasAttribute(page.scopeId)).toBe(true);
    // written in the page's template, inside Wrap's slot: still the page's
    expect(root.querySelector('.b')?.hasAttribute(page.scopeId)).toBe(true);
  });
});

