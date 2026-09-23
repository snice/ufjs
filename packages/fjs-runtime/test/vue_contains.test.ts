// DOM `Node.contains` on renderer-created nodes (specs/072). vant's Checker
// runs `icon === target || icon.contains(target)` on every tap; without the
// method the tap threw `not a function` and Checkbox/Radio never toggled.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, nextTick, ref } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { createApp, flutterRoot, registerStyles } from '../src/vue';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

type Node = { id: number; contains(other: unknown): boolean };

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

function mount(render: () => ReturnType<typeof h>) {
  registerStyles(null, '');
  const app = createApp({ render });
  app.mount(flutterRoot());
  return app;
}

function dispatch(id: number, type: number, payload: string | null): void {
  (globalThis as { __fjsDispatchEvent?: (id: number, t: number, p: string | null) => void })
    .__fjsDispatchEvent!(id, type, payload);
}

describe('element.contains', () => {
  beforeEach(() => setOpSink(() => {}));
  afterEach(() => setOpSink(null));

  it('answers like the DOM over the shadow tree', async () => {
    const refs: Record<string, Node> = {};
    const at = (name: string) => (el: unknown) => {
      if (el) refs[name] = el as Node;
    };
    const showKid = ref(true);
    const app = mount(() =>
      h('view', { ref: at('parent') }, [
        h('view', { ref: at('child') }, [
          showKid.value ? h('view', { ref: at('grandchild') }) : null,
          h('text', { ref: at('label') }, 'hi'),
        ]),
        h('view', { ref: at('sibling') }),
      ]),
    );
    await settle();
    const { parent, child, grandchild, label, sibling } = refs;

    expect(parent.contains(parent)).toBe(true);
    expect(parent.contains(child)).toBe(true);
    expect(parent.contains(grandchild)).toBe(true);
    expect(child.contains(label)).toBe(true);

    expect(child.contains(parent)).toBe(false);
    expect(grandchild.contains(child)).toBe(false);
    expect(child.contains(sibling)).toBe(false);
    expect(sibling.contains(grandchild)).toBe(false);

    expect(parent.contains(null)).toBe(false);
    expect(parent.contains(undefined)).toBe(false);
    expect(parent.contains({ id: parent.id + 100000 })).toBe(false);
    expect(parent.contains('nope')).toBe(false);

    // an unmounted node is outside the tree
    showKid.value = false;
    await nextTick();
    await settle();
    expect(parent.contains(grandchild)).toBe(false);
    expect(child.contains(grandchild)).toBe(false);

    app.unmount();
  });

  // vant checkbox/Checker.mjs onClick, reduced — real Checker binds it on
  // its `div` root, which specs/103 keeps on the DOM-shaped event side
  it('lets a vant Checker-style click handler toggle', async () => {
    const checked = ref(false);
    const iconRef = ref<Node | null>(null);
    let rootNode: Node | undefined;
    const onClick = (event: { target: Node }) => {
      const icon = iconRef.value;
      const iconClicked = icon === event.target || icon?.contains(event.target);
      void iconClicked;
      checked.value = !checked.value;
    };
    const app = mount(() =>
      h(
        'div',
        { ref: (el: unknown) => (rootNode = el as Node), onClick },
        [h('view', { ref: iconRef }), h('text', 'label')],
      ),
    );
    await settle();
    dispatch(rootNode!.id, 1, null);
    expect(checked.value).toBe(true);
    dispatch(rootNode!.id, 1, null);
    expect(checked.value).toBe(false);
    app.unmount();
  });
});
