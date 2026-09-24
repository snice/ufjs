// What an unmounted page leaves behind in JS. Event handlers never cross the
// bridge — they live in a registry keyed by node id — and Vue names only the
// ROOT of a subtree when it removes one. So nothing but the renderer's own
// subtree walk can drop a row's `@tap`, and a handler that outlives its node
// is not a stray closure: it closes over the component's render scope, which
// keeps the whole page (every element, every reactive object) alive for as
// long as the app runs. Navigating in and out of a page then costs a page's
// worth of heap every time, which is exactly what this test rules out.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { h, ref } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { createApp, flutterRoot } from '../src/vue';
import { UiOp as Op } from '../src/ui/ops';

const created: number[] = [];

/** Collects the ids of every node the frames created. Only Create matters
 * here, but every op has to be stepped over to find the next one. */
function collect(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  const u32 = () => {
    const v = view.getUint32(i, true);
    i += 4;
    return v;
  };
  while (i < bytes.length) {
    const op = bytes[i++];
    switch (op) {
      case Op.Create: {
        created.push(u32());
        const len = view.getUint16(i, true);
        i += 2 + len;
        break;
      }
      case Op.Remove:
        i += 4;
        break;
      case Op.Insert:
        i += 12;
        break;
      case Op.RemoveChild:
        i += 8;
        break;
      case Op.SetText:
      case Op.SetProps:
      case Op.DefineStyle: {
        u32();
        const len = u32();
        i += len;
        break;
      }
      case Op.SetStyle:
        i += 12;
        break;
      case Op.ResetStyles:
        break;
      default:
        throw new Error(`unknown op ${op} at ${i - 1}`);
    }
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Taps every node the app ever created, the way the native side would. */
function tapEverything(): void {
  for (const id of created) globalThis.__fjsDispatchEvent?.(id, 1, null);
}

beforeAll(() => {
  setOpSink((frame) => collect(frame));
});

afterEach(() => {
  created.length = 0;
});

describe('unmount', () => {
  it('drops the handlers of a whole subtree, not just its root', async () => {
    // which handlers ran, not how often: a tap bubbles (specs/129), so
    // tapping a row also reaches the root
    const hit = new Set<string>();
    const rows = ref([1, 2, 3]);
    const app = createApp({
      render: () =>
        h(
          'view',
          // the root's own handler: this one was already dropped before,
          // because Vue does name the subtree root
          { onTap: () => hit.add('root') },
          rows.value.map((n) =>
            // a row's handler closes over `n`, like `@tap="() => open(item)"`
            h('view', { key: n, onTap: () => hit.add(`row${n}`) }, [h('text', null, `row${n}`)]),
          ),
        ),
    });
    app.mount(flutterRoot('view'));
    await flush();

    // the handlers are live while the page is: root + three rows
    tapEverything();
    expect(hit.size).toBe(4);

    hit.clear();
    app.unmount();
    await flush();

    // ...and gone with it. Before the subtree walk dropped them, the three
    // rows still answered — each one pinning the page it belonged to.
    tapEverything();
    expect(hit.size).toBe(0);
  });
});
