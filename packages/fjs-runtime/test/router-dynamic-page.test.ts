// @vitest-environment happy-dom
// specs/220 — a dynamic-segment page (`src/pages/user/[id].vue`) registers
// under its PATTERN ('/user/:id', what the generated page entry passes to
// definePage), but the Flutter router looked pages up by the CONCRETE path
// ('/user/7'), so on the App the page was never found: blank screen and
// "no page registered for /user/7" while web — which matches by pattern —
// worked. The headless router (no native host) shares the lookup.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import '../src/vue/renderer';
import { createRouter, definePage, definePageLoader } from '../src/router/flutter';
import '../src/router/flutter-vdom';

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe('Flutter router: dynamic-segment pages', () => {
  it('mounts the page registered under the pattern for a concrete path', async () => {
    setOpSink(() => {});
    const seen: string[] = [];
    const User = defineComponent({
      setup() {
        seen.push('setup');
        return () => h('view');
      },
    });
    definePage('/p220-home', defineComponent({ setup: () => () => h('view') }));
    definePage('/p220-user/:id', User);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createRouter({
      initial: '/p220-home',
      routes: [{ path: '/p220-home' }, { path: '/p220-user/:id', name: 'p220-user' }],
    });
    router.start();
    await settle();
    await router.replace('/p220-user/7');
    await settle();

    expect(seen).toEqual(['setup']);
    expect(
      error.mock.calls.some((c) => String(c[0]).includes('no page registered')),
    ).toBe(false);
  });

  it('a single bundle\'s loader registered under the pattern runs for it too', async () => {
    setOpSink(() => {});
    let runs = 0;
    const comp = defineComponent({ setup: () => () => h('view') });
    definePage('/p220-home2', defineComponent({ setup: () => () => h('view') }));
    definePageLoader('/p220-item/:id', () => {
      runs++;
      return comp;
    });
    const router = createRouter({
      initial: '/p220-home2',
      preload: false,
      routes: [{ path: '/p220-home2' }, { path: '/p220-item/:id' }],
    });
    router.start();
    await settle();
    await router.preload('/p220-item/9');
    expect(runs).toBe(1);
    // another id is the same page code: not loaded twice
    await router.preload('/p220-item/10');
    expect(runs).toBe(1);
  });
});
