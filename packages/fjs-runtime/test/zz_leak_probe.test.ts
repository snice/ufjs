import { beforeAll, describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { createRouter, definePage } from '../src/router/flutter';
// VDOM pages mount through the injected mounter (specs/169); app/flutter.ts
// registers it in an app — a bare router needs it imported
import '../src/router/flutter-vdom';
import { registerStyles, styleEngine } from '../src/vue';
import { UiOp as Op } from '../src/ui/ops';
import type { RouteRecord } from '../src/router/types';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

const created: number[] = [];

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

let detailTaps = 0;

function page(name: string) {
  return defineComponent({
    name,
    setup() {
      // stands in for the page's own state: what a leak keeps alive
      const marker = { name, rows: Array.from({ length: 50 }, (_, i) => ({ i })) };
      const items = ref(marker.rows);
      return () =>
        h(
          'view',
          { class: `leak-page page-${name}` },
          items.value.map((row) =>
            h('view', {
              key: row.i,
              class: 'row',
              onTap: () => {
                if (marker.name === 'detail') detailTaps++;
              },
            }, [
              h('text', null, `row${row.i}`),
            ]),
          ),
        );
    },
  });
}

const table: RouteRecord[] = [
  { path: '/leak-home', name: 'leak-home' },
  { path: '/leak-detail', name: 'leak-detail' },
];

beforeAll(() => {
  setOpSink((frame) => collect(frame));
  registerStyles(
    null,
    '.leak-page { color: #111111; } .page-detail .row { color: #222222; }',
  );
  definePage('/leak-home', page('home'));
  definePage('/leak-detail', page('detail'));
});

describe('router navigation', () => {
  it('releases the handlers, elements, and style caches of every popped page', async () => {
    const beforeElements = styleEngine.stats.elements;
    const router = createRouter({
      routes: table,
      rootTag: 'view',
      initial: '/leak-home',
    });
    router.start();
    await flush();

    let baselineCache: ReturnType<typeof styleEngine.cacheStatsForTest> | null = null;
    for (let i = 0; i < 4; i++) {
      const firstNew = created.length;
      await router.replace('/leak-detail');
      await flush();
      const detailIds = created.slice(firstNew);

      await router.replace('/leak-home');
      await flush();

      const beforeTap = detailTaps;
      for (const id of detailIds) globalThis.__fjsDispatchEvent?.(id, 1, null);
      expect(detailTaps).toBe(beforeTap);

      const cache = styleEngine.cacheStatsForTest();
      baselineCache ??= cache;
      expect(cache.matchCache).toBeLessThanOrEqual(baselineCache.matchCache + 2);
      expect(cache.chainIds).toBeLessThanOrEqual(baselineCache.chainIds + 2);
      expect(cache.byParent).toBeLessThanOrEqual(baselineCache.byParent + 2);
    }

    // current home page only: root + page + 50 row views + 50 text nodes.
    // The exact global value depends on tests that ran before this file, so
    // assert the delta rather than the absolute count.
    expect(styleEngine.stats.elements - beforeElements).toBeLessThanOrEqual(104);
  });
});
