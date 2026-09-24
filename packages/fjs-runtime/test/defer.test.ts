// specs/118 — <defer>: a placeholder until the page settles, then the slot
// itself with no wrapper. Driven through a recording renderer and a settle
// signal the test controls, so the timing is exact; the two host bindings
// are checked for being wired to the right router.
import { describe, expect, it, vi } from 'vitest';
import { createRenderer, defineComponent, h, nextTick, ref } from '@vue/runtime-core';
import { createDefer, deferPlaceholderHeight } from '../src/components/defer';

type N = { tag: string; kids: N[]; parent: N | null; text?: string; props: Record<string, unknown> };
const node = (tag: string, text?: string): N => ({ tag, kids: [], parent: null, text, props: {} });
const { createApp } = createRenderer<N, N>({
  createElement: (tag) => node(tag),
  createText: (text) => node('#text', text),
  createComment: () => node('#comment'),
  setText: (n, t) => { n.text = t; },
  setElementText: (n, t) => { n.text = t; },
  insert: (c, p, a) => {
    c.parent = p;
    const i = a ? p.kids.indexOf(a) : -1;
    if (i < 0) p.kids.push(c);
    else p.kids.splice(i, 0, c);
  },
  remove: (c) => {
    if (c.parent) c.parent.kids.splice(c.parent.kids.indexOf(c), 1);
  },
  patchProp: (el, key, _prev, next) => { el.props[key] = next; },
  parentNode: (n) => n.parent,
  nextSibling: (n) => (n.parent ? n.parent.kids[n.parent.kids.indexOf(n) + 1] ?? null : null),
});

/** The rendered tree as a string, anchors and empty texts dropped. */
function show(n: N): string {
  if (n.tag === '#comment' || (n.tag === '#text' && !n.text)) return '';
  if (n.tag === '#text') return n.text!;
  const style = n.props.style as { height?: string } | undefined;
  const attrs = style?.height ? `[h=${style.height}]` : '';
  const inner = n.kids.length ? n.kids.map(show).filter(Boolean).join(',') : n.text ?? '';
  return `${n.tag}${attrs}(${inner})`;
}

function harness(placeholderHeight?: unknown) {
  let settle: (() => void) | null = null;
  const onSettled = vi.fn((cb: () => void) => { settle = cb; });
  const Defer = createDefer(onSettled, 'view');
  const shown = ref(true);
  const App = defineComponent(() => () =>
    h('page', null, [
      h('text', null, 'first'),
      shown.value
        ? h(Defer, { placeholderHeight } as never, { default: () => [h('item', null, 'a'), h('item', null, 'b')] })
        : null,
    ]));
  const root = node('root');
  createApp(App).mount(root);
  return { root, onSettled, settle: () => settle!(), shown };
}

describe('<defer> (specs/118)', () => {
  it('shows only a placeholder until the page settles', () => {
    const { root, onSettled } = harness();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(show(root)).toBe('root(page(text(first),view()))');
  });

  it('then renders the slot in place, with no wrapper element', async () => {
    const { root, settle } = harness();
    settle();
    await nextTick();
    expect(show(root)).toBe('root(page(text(first),item(a),item(b)))');
  });

  it('gives the placeholder the requested height', () => {
    expect(show(harness(120).root)).toBe('root(page(text(first),view[h=120px]()))');
    expect(show(harness('80px').root)).toBe('root(page(text(first),view[h=80px]()))');
  });

  it('does not mount anything when removed before the page settles', async () => {
    const { root, settle, shown } = harness();
    shown.value = false;
    await nextTick();
    settle();
    await nextTick();
    expect(show(root)).toBe('root(page(text(first)))');
  });

  it('parses placeholder-height and warns once on garbage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(deferPlaceholderHeight(undefined)).toBeNull();
      expect(deferPlaceholderHeight(0)).toBeNull();
      expect(deferPlaceholderHeight(300)).toBe('300px');
      expect(deferPlaceholderHeight('300')).toBe('300px');
      expect(deferPlaceholderHeight(' 12.5px ')).toBe('12.5px');
      expect(deferPlaceholderHeight('10vh')).toBeNull();
      expect(deferPlaceholderHeight('10vh')).toBeNull();
      expect(deferPlaceholderHeight(-4)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(2); // '10vh' once, -4 once
    } finally {
      warn.mockRestore();
    }
  });

  it('is registered on both hosts under the same tag', async () => {
    const flutter = await import('../src/app/flutter');
    const web = await import('../src/web/components/index');
    expect(flutter.FjsDefer.name).toBe('FjsDefer');
    expect(web.fjsComponents.defer).toBeDefined();
    expect((web.fjsComponents.defer as { name: string }).name).toBe('FjsDefer');
  });
});
