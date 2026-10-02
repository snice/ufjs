// Tab keep-alive on the Flutter router: switching between two `meta.tab`
// pages parks the leaving one — its Vue app stays mounted and its root is
// only marked `__navHidden` (the host renders it offstage) — so coming
// back does not remount the page. Leaving the tab group drops the lot.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineComponent, h } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { createRouter, definePage } from '../src/router/flutter';
// VDOM pages mount through the injected mounter (specs/169); app/flutter.ts
// registers it in an app — a bare router needs it imported
import '../src/router/flutter-vdom';
import type { RouteRecord } from '../src/router/types';

const enum Op {
  Create = 1,
  Remove = 2,
  Insert = 3,
  RemoveChild = 4,
  SetText = 5,
  SetProps = 6,
}

/** Just enough of the mirror tree to see roots and their props. */
class Roots {
  readonly ids: number[] = [];
  readonly props = new Map<number, Record<string, unknown>>();

  apply(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder();
    let i = 0;
    const u32 = () => {
      const v = view.getUint32(i, true);
      i += 4;
      return v;
    };
    while (i < bytes.length) {
      const op = bytes[i++];
      switch (op) {
        case Op.Create:
          u32();
          i += 2 + view.getUint16(i, true);
          break;
        case Op.Remove: {
          const id = u32();
          const at = this.ids.indexOf(id);
          if (at >= 0) this.ids.splice(at, 1);
          this.props.delete(id);
          break;
        }
        case Op.Insert: {
          const parent = u32();
          const child = u32();
          u32();
          if (parent === 0 && !this.ids.includes(child)) this.ids.push(child);
          break;
        }
        case Op.RemoveChild:
          u32();
          u32();
          break;
        case Op.SetText:
          u32();
          i += 4 + view.getUint32(i, true);
          break;
        case Op.SetProps: {
          const id = u32();
          const len = u32();
          const json = dec.decode(bytes.subarray(i, i + len));
          i += len;
          this.props.set(id, {
            ...(this.props.get(id) ?? {}),
            ...(JSON.parse(json) as Record<string, unknown>),
          });
          break;
        }
        default:
          throw new Error(`unknown op ${op} at ${i - 1}`);
      }
    }
  }

  parked(id: number): boolean {
    return this.props.get(id)?.__navHidden === true;
  }
}

const roots = new Roots();
const mounts: Record<string, number> = {};

function page(name: string) {
  return defineComponent({
    name,
    setup() {
      mounts[name] = (mounts[name] ?? 0) + 1;
      return () => h('view', { class: name });
    },
  });
}

const table: RouteRecord[] = [
  { path: '/', name: 'index', meta: { tab: 0 } },
  { path: '/api', name: 'api', meta: { tab: 1 } },
  { path: '/detail', name: 'detail' },
];

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeAll(() => {
  setOpSink((frame) => roots.apply(frame));
  definePage('/', page('home'));
  definePage('/api', page('api'));
  definePage('/detail', page('detail'));
});

afterEach(() => {
  roots.ids.length = 0;
  roots.props.clear();
  for (const key of Object.keys(mounts)) delete mounts[key];
});

describe('flutter router tab keep-alive', () => {
  it('parks the leaving tab and comes back to it without remounting', async () => {
    const router = createRouter({ routes: table, rootTag: 'view' });
    router.start();
    await flush();

    expect(mounts).toEqual({ home: 1 });
    const home = roots.ids[0];

    await router.replace('/api');
    await flush();
    expect(mounts).toEqual({ home: 1, api: 1 });
    // the home root is still in the tree, just parked
    expect(roots.ids).toContain(home);
    expect(roots.parked(home)).toBe(true);
    const api = roots.ids.find((id) => id !== home)!;

    await router.replace('/');
    await flush();
    // back on the same instance: no second setup() run
    expect(mounts).toEqual({ home: 1, api: 1 });
    expect(roots.parked(home)).toBe(false);
    expect(roots.parked(api)).toBe(true);
    expect(router.currentRoute.path).toBe('/');

    // a page outside the tab group ends the group's keep-alive
    await router.replace('/detail');
    await flush();
    expect(roots.ids).not.toContain(home);
    expect(roots.ids).not.toContain(api);

    await router.replace('/');
    await flush();
    expect(mounts).toEqual({ home: 2, api: 1, detail: 1 });
  });
});
