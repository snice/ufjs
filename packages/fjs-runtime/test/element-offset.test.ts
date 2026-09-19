// DOM offset geometry on fjs elements (ui/element.ts): offsetWidth/Height
// from the laid-out box, offsetLeft/Top against the offsetParent — the
// nearest positioned ancestor the Vue renderer resolves. vant's Tabs puts
// its underline at `title.offsetLeft + title.offsetWidth / 2`; without these
// it wrote `translateX(NaNpx)` and the line vanished.
import { describe, expect, it, vi } from 'vitest';
import { h, defineComponent, ref, type VNode } from '@vue/runtime-core';

// the host answers rects from the last frame; here, a fixed table
const rects = new Map<number, [number, number, number, number]>();
vi.mock('../src/ui/geometry', () => ({
  boundingRectOf: (id: number) => {
    const [left, top, width, height] = rects.get(id) ?? [0, 0, 0, 0];
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
  },
  lastPointer: () => null,
}));

const { setOpSink } = await import('../src/host');
const { createApp, flutterRoot } = await import('../src/vue');

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe('offset geometry', () => {
  it('measures against the nearest positioned ancestor', async () => {
    setOpSink(() => {});
    const nav = ref<any>(null);
    const title = ref<any>(null);
    const App: any = defineComponent(() => () =>
      h('view', { style: { paddingLeft: '10px' } }, [
        h('view', { ref: nav, style: { position: 'relative' } }, [
          h('view', null, [h('view', { ref: title }, 'tab')]),
        ]),
      ]) as VNode,
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    rects.set(nav.value.id, [26, 100, 300, 44]);
    rects.set(title.value.id, [126, 104, 80, 36]);

    expect(title.value.offsetParent).toBe(nav.value);
    expect(title.value.offsetWidth).toBe(80);
    expect(title.value.offsetHeight).toBe(36);
    expect(title.value.offsetLeft).toBe(100);
    expect(title.value.offsetTop).toBe(4);
  });

  it('answers zeros before layout, never NaN', async () => {
    setOpSink(() => {});
    const el = ref<any>(null);
    const App: any = defineComponent(() => () => h('view', { ref: el }) as VNode);
    createApp(App).mount(flutterRoot());
    await flush();
    expect(el.value.offsetLeft + el.value.offsetWidth / 2).toBe(0);
  });

  // with no positioned ancestor the DOM falls back to <body>; here the page
  // root. A null made vant's isHidden() treat every tabs bar as hidden, so
  // setLine returned early and the underline never moved (specs/073).
  it('falls back to the page root, never null for a mounted element', async () => {
    setOpSink(() => {});
    const tabs = ref<any>(null);
    const App: any = defineComponent(() => () =>
      h('view', null, [h('view', { ref: tabs, style: { position: 'relative' } }, 'tabs')]) as VNode,
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    expect(tabs.value.offsetParent?.id).toBe(root.id);
  });
});
