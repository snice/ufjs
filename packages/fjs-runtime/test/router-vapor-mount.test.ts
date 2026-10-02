// enableVapor on Flutter (specs/166): the router mounts a vapor page
// natively — createVaporApp into the page root, no per-page Vue app, no
// wrapper. Navigation goes through the real FlutterRouter (headless: no
// navigator, so a push swaps in place like a replace).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setOpSink } from '../src/host';
import { installEventDispatcher } from '../src/ui/element';
import { compileSfc } from './helpers/sfc';

type Vue = typeof import('../src/vapor/index');
type App = typeof import('../src/app/flutter');
type Renderer = typeof import('../src/vue/renderer');
let vue: Vue;
let appMod: App;
let r: Renderer;

beforeAll(async () => {
  vue = await import('../src/vapor/index');
  appMod = await import('../src/app/flutter');
  r = await import('../src/vue/renderer');
});

beforeEach(() => {
  setOpSink(() => {});
  installEventDispatcher();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  (await import('../src/ui/element')).flush();
};

interface OpRecorder {
  texts: Map<number, string>;
  tags: Map<number, string>;
  /** the newest page root still alive: flutterRoot bypasses insert, so the
   * page roots are the created ids no Insert ever attached — minus the ones
   * a teardown's Remove has retired */
  currentRoot(): number | null;
}

/** Decodes the op stream: Create (tag by id), Remove (retired roots),
 * Insert (the tree edges) and SetText (text by id). */
function recordOps(): OpRecorder {
  const texts = new Map<number, string>();
  const tags = new Map<number, string>();
  const created: number[] = [];
  const removed = new Set<number>();
  const childrenOf = new Map<number, number[]>();
  const parentOf = new Map<number, number>();
  setOpSink((frame: Uint8Array) => {
    const fjsText = (frame as Uint8Array & { fjsText?: string[] }).fjsText;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const dec = new TextDecoder();
    let i = 0;
    const u32 = () => ((i += 4), view.getUint32(i - 4, true));
    const u16 = () => ((i += 2), view.getUint16(i - 2, true));
    while (i < frame.length) {
      const op = frame[i++];
      if (op === 1) {
        const id = u32();
        const n = u16();
        tags.set(id, dec.decode(frame.subarray(i, i + n)));
        created.push(id);
        i += n;
      } else if (op === 2) {
        removed.add(u32());
      } else if (op === 3) {
        // op3(parent, child, index) — the index rides the tail
        const parent = u32();
        const child = u32();
        u32();
        parentOf.set(child, parent);
        const kids = childrenOf.get(parent) ?? [];
        kids.push(child);
        childrenOf.set(parent, kids);
      } else if (op === 4) {
        i += 8;
      } else if (op === 5) {
        const id = u32();
        const n = u32();
        texts.set(id, dec.decode(frame.subarray(i, i + n)));
        i += n;
      } else if (op === 0x4c && fjsText) {
        const id = u32();
        const idx = u32();
        texts.set(id, fjsText[idx] ?? '');
      } else if (op === 6 || op === 7) {
        // not `i += u32()`: the compound assignment reads the STALE i — the
        // advance inside u32() is clobbered. Bind the length first.
        u32();
        const n = u32();
        i += n;
      } else if (op === 8) {
        i += 12;
      } else {
        break;
      }
    }
  });
  const childIds = (id: number): number[] => childrenOf.get(id) ?? [];
  /** topmost live ancestor of the newest created element: the last page's
   * root (teardown retires the old one with a Remove) */
  const currentRoot = (): number | null => {
    for (let k = created.length - 1; k >= 0; k--) {
      let id = created[k] as number;
      if (removed.has(id)) continue;
      while (parentOf.has(id)) id = parentOf.get(id) as number;
      if (!removed.has(id)) return id;
    }
    return null;
  };
  return { texts, tags, currentRoot, childIds, removed };
}

function treeTexts(rec: OpRecorder, root: number | null): string[] {
  const out: string[] = [];
  const walk = (id: number): void => {
    // a teardown's Remove on a page root retires the whole subtree
    if (rec.removed.has(id)) return;
    const t = rec.texts.get(id);
    if (t !== undefined && rec.tags.get(id) === 'text') out.push(t);
    for (const kid of rec.childIds(id)) walk(kid);
  };
  if (root !== null) walk(root);
  return out;
}

const COUNT_PAGE = `
<script setup>
import { ref } from 'vue'
const n = ref(0)
</script>
<template>
  <view class="page">
    <text class="count">{{ n }}</text>
  </view>
</template>
`;

const TITLE_PAGE = `
<script setup>
import { useRoute } from 'fjs/router'
const route = useRoute()
</script>
<template>
  <view class="page">
    <text class="title">{{ route.meta.title }}</text>
  </view>
</template>
`;

describe('enableVapor: the Flutter router mounts vapor pages natively', () => {
  it('mounts the base page through the vapor runtime, navigates, and serves useRoute without a Vue instance', async () => {
    const { createFjsApp } = appMod;
    const { definePage } = await import('../src/router/flutter');
    const count = compileSfc(COUNT_PAGE, { vapor: true, runtime: vue as unknown as Record<string, unknown> });
    const title = compileSfc(TITLE_PAGE, {
      vapor: true,
      runtime: vue as unknown as Record<string, unknown>,
      modules: { 'fjs/router': (await import('../src/router/flutter')) as unknown as Record<string, unknown> },
    });
    definePage('/', count.component as never);
    definePage('/second', title.component as never);

    const rec = recordOps();
    const app = createFjsApp({
      enableVapor: true,
      routes: [
        { path: '/', meta: { title: 'home' }, component: count.component as never },
        { path: '/second', meta: { title: 'second' }, component: title.component as never },
      ],
    });
    app.mount();
    await settle();

    // the page's own reactive text, rendered through the vapor runtime with
    // no Vue app in sight
    expect(treeTexts(rec, rec.currentRoot())).toEqual(['0']);

    await app.router.push('/second');
    await settle();
    // the pushed page's `useRoute()` ran with no Vue instance — the
    // activeNativeRoute fallback served the reactive route copy
    expect(treeTexts(rec, rec.currentRoot())).toEqual(['second']);
    expect(app.router.currentRoute.path).toBe('/second');
    // (back() is a no-op headless: without the native navigator the base
    // page was torn down at push time and nothing re-mounts it — the real
    // pop flow is device-only)
  });
});

// specs/167: the page gets its router / route / entry through vapor
// provides, plugins and setup(app) run once against the app shell (pinia),
// and a page torn down by navigation runs its unmount hooks.
const STORE_PAGE = `
<script setup>
import { onMounted, onUnmounted, isReactive } from 'vue'
import { useRoute, useRouter, onPageSettled } from 'fjs/router'
const log = globalThis.__log
const route = useRoute()
const router = useRouter()
const store = globalThis.__useStore()
globalThis.__routes.push(route)
log.push('route ' + route.fullPath + ' reactive=' + isReactive(route) + ' router=' + (router === globalThis.__router()))
onMounted(() => log.push('mounted ' + route.fullPath))
onUnmounted(() => log.push('unmounted ' + route.fullPath))
onPageSettled(() => log.push('settled ' + route.fullPath))
</script>
<template>
  <view class="page">
    <text class="n">{{ store.n }}</text>
  </view>
</template>
`;

describe('enableVapor (Flutter): app shell, vapor provides, page lifecycle', () => {
  it('pinia through setup(app); per-page route; unmount hooks on navigation', async () => {
    const { createFjsApp } = appMod;
    const fjsRouter = (await import('../src/router/flutter')) as unknown as Record<string, unknown>;
    const pinia = await import('pinia');
    const log: string[] = [];
    const routes: { fullPath: string }[] = [];
    const g = globalThis as Record<string, unknown>;
    g.__log = log;
    g.__routes = routes;
    const useStore = pinia.defineStore('flutter-counter', { state: () => ({ n: 5 }) });
    g.__useStore = useStore;
    const page = compileSfc(STORE_PAGE, {
      vapor: true,
      runtime: vue as unknown as Record<string, unknown>,
      modules: { 'fjs/router': fjsRouter },
    });
    const { definePage } = await import('../src/router/flutter');
    definePage('/', page.component as never);
    definePage('/b', page.component as never);
    const rec = recordOps();
    let setupRuns = 0;
    const app = createFjsApp({
      enableVapor: true,
      setup(a) {
        setupRuns++;
        a.use(pinia.createPinia());
      },
      routes: [
        { path: '/', component: page.component as never },
        { path: '/b', component: page.component as never },
      ],
    });
    g.__router = () => app.router;
    app.mount();
    await settle();
    expect(treeTexts(rec, rec.currentRoot())).toEqual(['5']);
    await app.router.push('/b');
    await settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(setupRuns).toBe(1);
    expect(log).toContain('route / reactive=true router=true');
    expect(log).toContain('route /b reactive=true router=true');
    expect(log).toContain('mounted /');
    // headless push swaps in place: the base page is torn down
    expect(log).toContain('unmounted /');
    expect(log.indexOf('unmounted /')).toBeLessThan(log.indexOf('mounted /b'));
    // each page holds its OWN route object
    expect(routes.map((r) => r.fullPath)).toEqual(['/', '/b']);
  });
});

describe('enableVapor (Flutter): the vapor shell (specs/167 §8)', () => {
  it('wraps the page with its own route; a VDOM shell warns and is skipped', async () => {
    const { createFjsApp } = appMod;
    const fjsRouter = (await import('../src/router/flutter')) as unknown as Record<string, unknown>;
    const { definePage } = await import('../src/router/flutter');
    const shell = compileSfc(`
<script setup>
const props = defineProps(['route'])
</script>
<template><view class="shell"><text class="title">[{{ props.route.meta.title }}]</text><slot /></view></template>`, {
      vapor: true,
      runtime: vue as unknown as Record<string, unknown>,
      modules: { 'fjs/router': fjsRouter },
    });
    const count = compileSfc(COUNT_PAGE, { vapor: true, runtime: vue as unknown as Record<string, unknown> });
    definePage('/', count.component as never);
    const rec = recordOps();
    const app = createFjsApp({
      enableVapor: true,
      shell: shell.component as never,
      routes: [{ path: '/', meta: { title: 'home' }, component: count.component as never }],
    });
    app.mount();
    await settle();
    expect(treeTexts(rec, rec.currentRoot())).toEqual(['[home]', '0']);

    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => warns.push(String(m));
    try {
      const rec2 = recordOps();
      const app2 = createFjsApp({
        enableVapor: true,
        shell: { name: 'VdomShell', render: () => null } as never,
        routes: [{ path: '/', meta: { title: 'home' }, component: count.component as never }],
      });
      app2.mount();
      await settle();
      expect(treeTexts(rec2, rec2.currentRoot())).toEqual(['0']);
    } finally {
      console.warn = orig;
    }
    expect(warns.some((w) => w.includes('not a vapor component'))).toBe(true);
  });
});
