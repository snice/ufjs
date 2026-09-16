// Tests for the wx runtime shell. WeChat's host globals (Component, wx) are
// faked with plain objects that record what got registered, so the tests
// drive instances through their lifetimes exactly like the platform would.
import { describe, expect, it, vi, beforeEach } from 'vitest';

type CmpConfig = Record<string, any>;

let registered: CmpConfig | null = null;

function makeInstance(config: CmpConfig): any {
  const instance: any = {
    data: Object.fromEntries(
      Object.entries(config.properties ?? {}).map(([k, v]: [string, any]) => [
        k,
        v?.value ?? null,
      ]),
    ),
    setData: vi.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
    triggerEvent: vi.fn(),
    __config: config,
  };
  return instance;
}

vi.stubGlobal('Component', (config: CmpConfig) => {
  registered = config;
});
vi.stubGlobal('wx', {
  showToast: vi.fn(),
  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
  navigateBack: vi.fn(),
  request: vi.fn(),
});

import { createWevuComponent } from '../src/wx/instance';
import { adaptEvent } from '../src/wx/events';
import { stringifyClass, stringifyStyle } from '../src/wx/style';
import { ref, computed, onMounted, onUnmounted, onShow, onLoad, pickerSync } from '../src/wx/vue';

function instanceOf(): any {
  expect(registered).not.toBeNull();
  return makeInstance(registered!);
}

function flush(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

beforeEach(() => {
  registered = null;
});

describe('createWevuComponent', () => {
  it('coalesces a tick of writes into one setData', async () => {
    // @vue/reactivity has no job queue of its own: unscheduled, the snapshot
    // and setData ran on every single property write — one animation tick
    // touching 25 objects crossed the bridge 75 times
    createWevuComponent({
      __name: 'dots',
      __fjsData: ['dots'],
      setup() {
        const dots = ref([{ scale: 1 }, { scale: 1 }, { scale: 1 }]);
        return { dots, bump: () => dots.value.forEach((d, i) => (d.scale = i + 2)) };
      },
    });
    const inst = instanceOf();
    (registered!.lifetimes.attached as () => void).call(inst);
    const first = inst.setData.mock.calls.length;
    (inst.__fjs_fns.bump as () => void)();
    expect(inst.setData.mock.calls.length).toBe(first); // nothing yet
    await flush();
    expect(inst.setData.mock.calls.length).toBe(first + 1);
    expect(inst.data.dots).toEqual([{ scale: 2 }, { scale: 3 }, { scale: 4 }]);
  });

  it('drops nested functions so setData stays serializable', () => {
    // an anime.js easing is a class instance carrying `ease` / `onComplete`;
    // a function reaching the bridge throws on the whole payload
    class Easing {
      stiffness = 120;
      ease = (t: number) => t;
    }
    createWevuComponent({
      __name: 'lanes',
      __fjsData: ['lanes'],
      setup() {
        const lanes = ref([{ name: 'spring', ease: new Easing(), cbs: [() => 1, 2] }]);
        return { lanes };
      },
    });
    const inst = instanceOf();
    (registered!.lifetimes.attached as () => void).call(inst);
    expect(inst.data.lanes).toEqual([
      { name: 'spring', ease: { stiffness: 120 }, cbs: [null, 2] },
    ]);
    expect(() => JSON.stringify(inst.data)).not.toThrow();
  });

  it('runs setup on attached and lands the first snapshot in data', () => {
    createWevuComponent({
      __name: 'counter',
      setup() {
        const count = ref(2);
        const label = computed(() => `n=${count.value}`);
        return { count, label };
      },
    });
    const inst = instanceOf();
    (registered!.lifetimes.attached as () => void).call(inst);
    expect(inst.data.count).toBe(2);
    expect(inst.data.label).toBe('n=2');
  });

  it('does not put function bindings into data (setData would throw)', () => {
    createWevuComponent({
      setup() {
        const inc = () => {};
        const count = ref(0);
        return { inc, count };
      },
    });
    const inst = instanceOf();
    (registered!.lifetimes.attached as () => void).call(inst);
    expect(inst.data).not.toHaveProperty('inc');
    expect(inst.__fjs_fns.inc).toBeTypeOf('function');
  });

  it('diffs reactive changes into setData', async () => {
    createWevuComponent({
      setup() {
        const count = ref(1);
        const items = ref([{ id: 1 }, { id: 2 }]);
        return { count, items };
      },
    });
    const inst = instanceOf();
    (registered!.lifetimes.attached as () => void).call(inst);
    const returned = inst.__fjs_returned as Record<string, any>;
    returned.count.value = 5;
    await flush();
    // the callback runs 'rendered' hooks once the patch is applied (pickerSync)
    expect(inst.setData).toHaveBeenCalledWith(expect.objectContaining({ count: 5 }), expect.any(Function));

    // deep mutation of a reactive array must be tracked (snapshot walks it)
    returned.items.value.push({ id: 3 });
    await flush();
    const patches = (inst.setData as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: any[]) => c[0] as Record<string, unknown>,
    );
    expect(patches.some((p) => Array.isArray(p.items) && p.items.length === 3)).toBe(true);
  });

  it('pickerSync bumps after the mounted render and after a rendered change of its deps', async () => {
    let tick: { value: number } | null = null;
    let value: { value: number[] } | null = null;
    createWevuComponent({
      setup() {
        const v = ref([6, 8]);
        value = v;
        tick = pickerSync(() => [v.value]);
        return { v, tick };
      },
    });
    const inst = instanceOf();
    // a setData that renders at once: run its callback
    inst.setData = vi.fn(function (this: any, patch: Record<string, unknown>, cb?: () => void) {
      Object.assign(this.data, patch);
      cb?.();
    });
    (registered!.lifetimes.attached as () => void).call(inst);
    expect(tick!.value).toBe(0);
    (registered!.lifetimes.ready as () => void).call(inst);
    expect(tick!.value).toBe(1); // the empty setData after mounted
    await flush();
    value!.value = [2, 3];
    await flush();
    expect(tick!.value).toBe(2);
    expect(inst.data.tick).toBe(2);
  });

  it('maps lifetimes to vue hooks: ready→mounted, detached→unmounted', () => {
    const order: string[] = [];
    createWevuComponent({
      setup() {
        onMounted(() => order.push('mounted'));
        onUnmounted(() => order.push('unmounted'));
        onShow(() => order.push('show'));
        return {};
      },
    });
    const inst = instanceOf();
    (registered!.lifetimes.attached as () => void).call(inst);
    (registered!.lifetimes.ready as () => void).call(inst);
    (registered!.pageLifetimes.show as () => void).call(inst);
    (registered!.lifetimes.detached as () => void).call(inst);
    expect(order).toEqual(['mounted', 'show', 'unmounted']);
  });

  it('isPage registers page lifecycle in methods and fires load with query', () => {
    const seen: unknown[] = [];
    createWevuComponent(
      {
        setup() {
          onLoad((query: unknown) => seen.push(query));
          onMounted(() => seen.push('mounted'));
          return { a: ref(1) };
        },
      },
      { isPage: true },
    );
    const inst = instanceOf();
    // a page root is BOTH a component (attached) and a page (onLoad) —
    // mount must happen exactly once
    (registered!.lifetimes.attached as () => void).call(inst);
    (registered!.methods.onLoad as (q: unknown) => void).call(inst, { from: 'tab' });
    expect(seen).toEqual([{ from: 'tab' }]);
    expect(inst.data.a).toBe(1);
    (registered!.methods.onReady as () => void).call(inst);
    expect(seen).toEqual([{ from: 'tab' }, 'mounted']);
  });

  it('props land in setup and observers update the reactive mirror', async () => {
    createWevuComponent({
      __name: 'paneled',
      props: { title: { type: String } },
      setup(props: any) {
        return { upper: computed(() => String(props.title ?? '').toUpperCase()) };
      },
    });
    const inst = instanceOf();
    (registered!.lifetimes.attached as () => void).call(inst);
    expect(inst.data.upper).toBe('');
    inst.data.title = 'hello';
    (registered!.observers.title as () => void).call(inst);
    expect(inst.__fjs_props.title).toBe('hello');
    await flush();
    expect(inst.data.upper).toBe('HELLO');
  });

  it('__fjsCall adapts the event and passes dataset scope args', () => {
    const calls: unknown[] = [];
    createWevuComponent({
      setup() {
        return {
          onChange: (v: unknown) => calls.push(v),
          __ev0: (v: unknown, item: unknown) => calls.push([v, item]),
        };
      },
    });
    const inst = instanceOf();
    (registered!.lifetimes.attached as () => void).call(inst);
    (registered!.methods.__fjsCall as (e: unknown) => void).call(inst, {
      type: 'change',
      currentTarget: { dataset: { fn: 'onChange', tag: 'switch' } },
      detail: { value: true },
    });
    expect(calls).toEqual(['1']);
    (registered!.methods.__fjsCall as (e: unknown) => void).call(inst, {
      type: 'tap',
      currentTarget: { dataset: { fn: '__ev0', tag: 'view', args: [{ id: 7 }] } },
    });
    expect(calls[1]).toEqual([undefined, { id: 7 }]);
  });
});

describe('adaptEvent', () => {
  it('maps switch change to fjs "1"/"0" strings', () => {
    expect(adaptEvent('switch', 'change', { detail: { value: true } }).payload).toBe('1');
    expect(adaptEvent('switch', 'change', { detail: { value: false } }).payload).toBe('0');
  });

  it('input events carry detail.value; tap carries nothing', () => {
    expect(adaptEvent('input', 'input', { detail: { value: 'abc' } }).payload).toBe('abc');
    expect(adaptEvent('view', 'tap', {}).payload).toBeUndefined();
  });

  it('touch events become the DOM-shaped FjsTouchEvent of the other ends', () => {
    const payload = adaptEvent('view', 'touchmove', {
      type: 'touchmove',
      timeStamp: 5,
      currentTarget: { id: 'block-1', offsetLeft: 10, offsetTop: 20 },
      touches: [{ identifier: 3, clientX: 12, clientY: 34 }],
      changedTouches: [{ identifier: 3, clientX: 12, clientY: 34 }],
    }).payload as {
      type: string;
      target: { id: string };
      touches: Array<Record<string, number>>;
      changedTouches: Array<Record<string, number>>;
    };
    expect(payload.type).toBe('touchmove');
    expect(payload.target.id).toBe('block-1');
    expect(payload.changedTouches[0]).toMatchObject({
      identifier: 3,
      clientX: 12,
      clientY: 34,
      x: 12,
      y: 34,
      offsetX: 2,
      offsetY: 14,
    });
    expect(payload.touches).toHaveLength(1);
  });

  it('canvas touches take offsetX/Y from their canvas-relative x/y, not clientY minus the origin', () => {
    // skyline: the origin comes from a rect query whose frame can differ from
    // clientY (here by 88, a navigation bar) — x/y are already canvas-local
    const payload = adaptEvent('canvas', 'touchstart', {
      type: 'touchstart',
      currentTarget: { id: 'fjs-cv-cv', dataset: { tag: 'canvas' }, offsetLeft: 12, offsetTop: 200 },
      touches: [{ identifier: 0, clientX: 112, clientY: 388, x: 100, y: 100 }],
      changedTouches: [{ identifier: 0, clientX: 112, clientY: 388, x: 100, y: 100 }],
    }).payload as { touches: Array<Record<string, number>> };
    expect(payload.touches[0]).toMatchObject({ offsetX: 100, offsetY: 100, clientX: 112, clientY: 388 });

    // webview canvas: only x/y — client coordinates rebuilt from the origin
    const local = adaptEvent('canvas', 'touchmove', {
      type: 'touchmove',
      currentTarget: { id: 'fjs-cv-cv', dataset: { tag: 'canvas' }, offsetLeft: 12, offsetTop: 200 },
      touches: [{ identifier: 0, x: 5, y: 6 }],
      changedTouches: [{ identifier: 0, x: 5, y: 6 }],
    }).payload as { touches: Array<Record<string, number>> };
    expect(local.touches[0]).toMatchObject({ offsetX: 5, offsetY: 6, clientX: 17, clientY: 206 });
  });

  it('long-press still carries the x/y position', () => {
    const payload = adaptEvent('view', 'longpress', {
      changedTouches: [{ clientX: 12, clientY: 34 }],
    }).payload as { x: number; y: number };
    expect(payload).toEqual({ x: 12, y: 34 });
  });

  it('custom component events pass detail through', () => {
    expect(adaptEvent('fjs-modal', 'modal-closed', { detail: { a: 1 } }).payload).toEqual({
      a: 1,
    });
  });
});

describe('style helpers', () => {
  it('stringifyClass flattens object/array/string forms', () => {
    expect(stringifyClass({ active: true, off: false })).toBe('active');
    expect(stringifyClass(['a', { b: 1 }, ''])).toBe('a b');
    expect(stringifyClass('plain')).toBe('plain');
  });

  it('stringifyStyle handles objects, numbers and strings', () => {
    expect(stringifyStyle({ color: 'red', flexGrow: 2 })).toBe('color:red;flex-grow:2');
    expect(stringifyStyle('width: 10px')).toBe('width: 10px');
    expect(stringifyStyle([{ a: 1 }, 'b:2;'])).toBe('a:1px;b:2');
  });
});

describe('css variables recorded from :style bindings', () => {
  it('resolves var() colors, fallbacks and nested vars, and notifies changes', async () => {
    const { stringifyStyle, resolveCssColor, onCssVarsChange } = await import('../src/wx/style');
    let calls = 0;
    const off = onCssVarsChange(() => calls++);
    stringifyStyle({ '--t-primary': '#007AFF', '--t-link': 'var(--t-primary)' });
    expect(resolveCssColor('var(--t-primary)')).toBe('#007AFF');
    expect(resolveCssColor('var(--t-link)')).toBe('#007AFF');
    expect(resolveCssColor('var(--t-missing, #ff0000)')).toBe('#ff0000');
    expect(resolveCssColor('var(--t-missing)')).toBe('');
    expect(resolveCssColor('#123456')).toBe('#123456');
    expect(calls).toBe(1);
    stringifyStyle({ '--t-primary': '#007AFF' });
    expect(calls).toBe(1);
    stringifyStyle({ '--t-primary': '#0A84FF' });
    expect(calls).toBe(2);
    expect(resolveCssColor('var(--t-link)')).toBe('#0A84FF');
    off();
  });
});
