// The wevu-style component shell: runs an SFC's setup(), keeps the returned
// bindings in a @vue/reactivity-tracked snapshot, and diffs that snapshot
// into setData on every change (microtask-batched). Templates are WXML and
// never render through Vue — this file is the entire "runtime" a compiled
// SFC needs.
//
// Shape of the compiler output this expects (`script.ts` in @ufjs/cli):
//
//   const __sfc__ = {
//     __name: 'switch-page',
//     props: { title: null },          // from defineProps, or absent
//     setup(__props) {
//       ...user code...
//       const __ev0 = ($event) => ...; // extracted inline handlers
//       const __d0 = computed(() => ...); // extracted expressions
//       const __returned__ = { wifi, push, __ev0, __d0 };
//       Object.defineProperty(__returned__, '__isScriptSetup', {...});
//       return __returned__;
//     },
//   };
//   __createWevuComponent(__sfc__);
import {
  effectScope,
  reactive,
  watch,
  type Ref,
} from '@vue/reactivity';
import {
  __withInstanceHooks,
  runHooks,
  type HookType,
  type Hooks,
} from './vue';
import { adaptEvent, type NormalizedEvent } from './events';
import { attachCanvases, detachCanvases, type WxCanvasRef } from './canvas';
import { mediaMatches, parseMediaCondition, type MediaCondition } from '../css/parser';

/** Minimal structural type of the mini-program Component instance (`this`)
 * we attach our state to. Declared loosely on purpose: the real host is
 * WeChat's, which we don't ship types for. */
interface MpInstance {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>, callback?: () => void): void;
  triggerEvent(name: string, detail?: unknown): void;
  [key: string]: unknown;
}

/** The compileScript product (a defineComponent options object), typed
 * loosely — the mp shell only needs setup/props/__name. */
export interface WevuSfc {
  __name?: string;
  props?: Record<string, unknown> | string[];
  setup?: (props: Record<string, unknown>, ctx: WevuSetupCtx) => unknown;
  /** Compiler-injected: exactly the setup bindings the template reads in
   * expressions. When present, setData is narrowed to these keys — event
   * handler bindings (a router object) never become data. */
  __fjsData?: string[];
  /** Compiler-injected: this SFC's @media conditions by block index. Skyline
   * applies every @media block unconditionally, so the compiler turned each
   * into a class and the runtime switches it (see syncMedia). */
  __fjsMedia?: string[];
  /** Compiler-injected: `<canvas ref>`s of this template (see canvas.ts). */
  __fjsCanvas?: WxCanvasRef[];
}

export interface WevuSetupCtx {
  attrs: Record<string, unknown>;
  emit: (event: string, ...args: unknown[]) => void;
  expose: (exposed?: Record<string, unknown>) => void;
}

interface InstanceState {
  fns: Record<string, (...args: unknown[]) => unknown>;
  returned: Record<string, unknown>;
  hooks: Hooks;
  scope: ReturnType<typeof effectScope>;
  stopWatch: () => void;
  props: Record<string, unknown>;
}

const MOUNTED: HookType = 'mounted';

function propNames(sfc: WevuSfc): string[] {
  const raw = sfc.props;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.keys(raw);
}

/** Deep-walks a binding value into a plain (non-reactive) snapshot, reading
 * everything on the way so the watcher tracks nested mutations too —
 * unlike a vdom render, nothing else walks the data for us. */
function snapshot(value: unknown, seen: Set<object>): unknown {
  // setData serializes across the JSCore bridge: a function or symbol reached
  // through a bound object (an anime.js easing carries `ease` / `onComplete`)
  // is not serializable and the host throws on the whole payload
  if (typeof value === 'function' || typeof value === 'symbol') return null;
  if (value === null || typeof value !== 'object') return value ?? null;
  const obj = value as object;
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);
  try {
    if ((value as { __v_isRef?: boolean }).__v_isRef === true) {
      return snapshot((value as Ref<unknown>).value, seen);
    }
    if (Array.isArray(value)) {
      return (value as unknown[]).map((v) => snapshot(v, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // an array slot keeps its index (null); an object key just goes away
      if (typeof v === 'function' || typeof v === 'symbol') continue;
      out[k] = snapshot(v, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

function shallowDiff(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let changed = false;
  for (const key of Object.keys(next)) {
    if (!deepEqual(prev[key], next[key])) {
      patch[key] = next[key];
      changed = true;
    }
  }
  return changed ? patch : null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    )
      return false;
  }
  return true;
}

/** Wires one mini-program instance to one SFC. Called from the `attached`
 * lifetime, or page `onLoad` for pages — a page root is both, so this is
 * idempotent (first caller wins). */
function mountInstance(self: MpInstance, sfc: WevuSfc): void {
  if (self.__fjs_state) return;
  const names = propNames(sfc);
  // props live in a reactive object so computeds that read props re-run
  // when a parent updates them (observers keep it in sync with this.data)
  const props = reactive(
    Object.fromEntries(names.map((n) => [n, self.data[n] ?? null])),
  ) as Record<string, unknown>;
  self.__fjs_props = props;

  const hooks: Hooks = {};
  const scope = effectScope(true);
  const ctx: WevuSetupCtx = {
    attrs: {},
    emit: (event, ...args) => self.triggerEvent(event, args.length === 1 ? args[0] : args),
    expose: () => {},
  };

  let returned: Record<string, unknown> = {};
  __withInstanceHooks(hooks, () => {
    scope.run(() => {
      try {
        const r = sfc.setup?.(props, ctx);
        if (r && typeof r === 'object') returned = r as Record<string, unknown>;
      } catch (err) {
        console.error(`[fjs/wx] setup failed in ${sfc.__name ?? '<anonymous>'}:`, err);
      }
    });
  });

  // script setup's __returned__ carries a non-enumerable marker; hide any
  // other non-function state that must not reach setData (functions become
  // event targets, everything else becomes template data)
  const fns: Record<string, (...args: unknown[]) => unknown> = {};
  const dataKeys: string[] = [];
  const dataFilter = sfc.__fjsData;
  for (const [k, v] of Object.entries(returned)) {
    if (typeof v === 'function') fns[k] = v as (...args: unknown[]) => unknown;
    else if (!dataFilter || dataFilter.includes(k)) dataKeys.push(k);
  }
  self.__fjs_fns = fns;
  self.__fjs_returned = returned;
  self.__fjs_hooks = hooks;

  let prev: Record<string, unknown> = {};
  const render = (): Record<string, unknown> => {
    const next: Record<string, unknown> = {};
    for (const k of dataKeys) {
      next[k] = snapshot(returned[k], new Set());
    }
    return next;
  };
  // watch() (not effect()) so the callback only fires when a tracked dep
  // changed — the getter builds the full snapshot each run, which doubles
  // as the deep dependency scan. Data stays untouched until the first diff.
  //
  // The scheduler is not optional here: @vue/reactivity on its own has no job
  // queue (that lives in runtime-core, which this target does not ship), so
  // without one the getter re-runs and setData fires on EVERY property write.
  // One Anime.js tick writing 25 objects × 3 properties crossed the bridge 75
  // times per frame. Coalescing to one flush per microtask is what
  // runtime-core's pre-flush queue does, and it keeps `nextTick()` (also a
  // microtask) ordered after the setData of the writes that preceded it.
  let queued = false;
  const stopWatch = scope.run(() =>
    watch(
      render,
      (next) => {
        const patch = shallowDiff(prev, next as Record<string, unknown>);
        if (patch) {
          prev = next as Record<string, unknown>;
          self.setData(patch, () => runHooks(hooks, 'rendered'));
        }
      },
      {
        scheduler: (job, isFirstRun) => {
          if (isFirstRun) {
            job();
            return;
          }
          if (queued) return;
          queued = true;
          void Promise.resolve().then(() => {
            queued = false;
            job();
          });
        },
      },
    ),
  );

  self.__fjs_state = {
    fns,
    returned,
    hooks,
    scope,
    stopWatch: stopWatch ?? (() => {}),
    props,
  } satisfies InstanceState;

  // first snapshot lands synchronously in attached — WeChat folds setData
  // issued here into the initial render, so there's no empty flash
  const first = render();
  prev = first;
  self.setData(first);
  self.__fjs_sfc = sfc;
  watchMedia(self, sfc);
}

/** 'rendered' hooks (pickerSync) want to know when the mounted render has
 * actually been laid out; an empty setData's callback is that signal. Only
 * issued for instances that registered one. */
function afterMountedRender(self: MpInstance): void {
  const state = self.__fjs_state as InstanceState | undefined;
  if (state) {
    const refs = (self.__fjs_sfc as WevuSfc | undefined)?.__fjsCanvas;
    attachCanvases(self as never, refs, state.returned, state.fns);
  }
  const hooks = state?.hooks;
  if (!hooks?.rendered?.length) return;
  self.setData({}, () => runHooks(hooks, 'rendered'));
}

// ---- @media -----------------------------------------------------------------

const mediaInstances = new Set<MpInstance>();
let resizeHooked = false;
const parsedMedia = new Map<string, MediaCondition | null>();

function windowSize(): { width: number; height: number } {
  const info =
    typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
  return { width: info.windowWidth, height: info.windowHeight };
}

/** `__fjsMq[n]` = 'fjs-mq-n' while condition n holds, '' otherwise. A
 * condition the evaluator does not support never holds (the App engine
 * drops such a block the same way). */
function syncMedia(self: MpInstance, sfc: WevuSfc): void {
  const { width, height } = windowSize();
  const next = (sfc.__fjsMedia ?? []).map((text, n) => {
    if (!parsedMedia.has(text)) parsedMedia.set(text, parseMediaCondition(text));
    const cond = parsedMedia.get(text);
    return cond && mediaMatches(cond, width, height) ? `fjs-mq-${n}` : '';
  });
  const prev = self.data.__fjsMq as string[] | undefined;
  if (!prev || prev.join('|') !== next.join('|')) self.setData({ __fjsMq: next });
}

function watchMedia(self: MpInstance, sfc: WevuSfc): void {
  if (!sfc.__fjsMedia?.length) return;
  syncMedia(self, sfc);
  mediaInstances.add(self);
  if (!resizeHooked && typeof wx.onWindowResize === 'function') {
    resizeHooked = true;
    wx.onWindowResize(() => {
      for (const inst of mediaInstances) syncMedia(inst, inst.__fjs_sfc as WevuSfc);
    });
  }
}

function unmountInstance(self: MpInstance): void {
  mediaInstances.delete(self);
  detachCanvases(self as never);
  const state = self.__fjs_state as InstanceState | undefined;
  if (!state) return;
  runHooks(state.hooks, 'before-unmounted');
  runHooks(state.hooks, 'unmounted');
  state.stopWatch();
  state.scope.stop();
  self.__fjs_state = undefined;
}

function stateOf(self: MpInstance): InstanceState {
  const state = self.__fjs_state as InstanceState | undefined;
  if (!state) throw new Error('[fjs/wx] instance accessed outside its lifetime');
  return state;
}

/** Event funnel: every event binding the compiler emits lands here. The
 * dataset carries which function to call and which template-scope values
 * (v-for item etc.) to pass — generated closures can't see those. */
type RawEvent = { currentTarget?: { dataset?: Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>;

function fjsCall(this: MpInstance, e: RawEvent): void {
  if (needsTouchOrigin(e)) {
    withTouchOrigin(this, e);
    return;
  }
  dispatchCall(this, e);
}

// ---- touch origin -------------------------------------------------------------
//
// Touch payloads carry offsetX/Y relative to the listening node, derived from
// currentTarget.offsetLeft/Top (events.ts). Skyline's currentTarget has only
// id and dataset, so every offset came out as the page position — a canvas
// library (F2's tooltip) got points far from where the finger was. A node
// with an id is measured instead: touchstart asks for its viewport rect (the
// frame clientX/Y are in) and the stream waits for the answer, keeping order;
// later events in the same gesture reuse it.

interface TouchOrigin {
  left: number;
  top: number;
  /** events queued while the rect query runs */
  pending: RawEvent[] | null;
}

const touchOrigins = new WeakMap<MpInstance, Map<string, TouchOrigin>>();

function needsTouchOrigin(e: RawEvent): boolean {
  const type = String(e.type ?? '');
  if (!type.startsWith('touch')) return false;
  const ct = e.currentTarget;
  return !!ct && ct.offsetLeft === undefined && ct.offsetTop === undefined && !!ct.id;
}

/** The event with its currentTarget's offsets filled in — a copy: the
 * platform's event object is not ours to mutate. */
function withOffsets(e: RawEvent, o: { left: number; top: number }): RawEvent {
  return { ...e, currentTarget: { ...e.currentTarget, offsetLeft: o.left, offsetTop: o.top } };
}

function withTouchOrigin(self: MpInstance, e: RawEvent): void {
  let byId = touchOrigins.get(self);
  if (!byId) touchOrigins.set(self, (byId = new Map()));
  const id = String(e.currentTarget!.id);
  const origin = byId.get(id);
  if (e.type === 'touchstart' && !origin?.pending) {
    const next: TouchOrigin = { left: origin?.left ?? 0, top: origin?.top ?? 0, pending: [e] };
    byId.set(id, next);
    const flush = () => {
      const queued = next.pending ?? [];
      next.pending = null;
      // unmounted while the query ran: nothing left to deliver to
      if (!self.__fjs_state) return;
      for (const q of queued) dispatchCall(self, withOffsets(q, next));
    };
    const scope = self as unknown as {
      createSelectorQuery?: () => {
        select(sel: string): {
          boundingClientRect(cb: (r: { left: number; top: number } | null) => void): { exec(): void };
        };
      };
    };
    if (typeof scope.createSelectorQuery !== 'function') {
      flush();
      return;
    }
    scope
      .createSelectorQuery()
      .select(`#${id}`)
      .boundingClientRect((rect) => {
        if (rect) {
          next.left = Number(rect.left) || 0;
          next.top = Number(rect.top) || 0;
        }
        flush();
      })
      .exec();
    return;
  }
  if (origin?.pending) {
    origin.pending.push(e);
    return;
  }
  dispatchCall(self, origin ? withOffsets(e, origin) : e);
}

function dispatchCall(self: MpInstance, e: RawEvent): void {
  const ds = e.currentTarget?.dataset ?? {};
  const name = String(ds.fn ?? '');
  const state = stateOf(self);
  const fn = state.fns[name];
  if (!fn) {
    console.warn(`[fjs/wx] event handler "${name}" not found on ${String(sfcName(self))}`);
    return;
  }
  // wx events carry their own type ("tap", "load", "modal-closed") — that,
  // not a template attribute, is what the payload adapter dispatches on
  const norm = adaptEvent(
    String(ds.tag ?? ''),
    String((e as { type?: string }).type ?? ''),
    e as never,
  ) as NormalizedEvent;
  const scopeArgs = Array.isArray(ds.args) ? (ds.args as unknown[]) : [];
  try {
    // multi-event elements share one data-fn: the compiler's type dispatcher
    // (flagged __fjsByType) picks the branch from the event type
    if ((fn as { __fjsByType?: boolean }).__fjsByType) {
      fn(String((e as { type?: string }).type ?? ''), norm.payload, ...scopeArgs);
    } else {
      fn(norm.payload, ...scopeArgs);
    }
  } catch (err) {
    console.error(`[fjs/wx] handler ${name} failed:`, err);
  }
}

function sfcName(self: MpInstance): string {
  return String((self.__fjs_sfc as WevuSfc | undefined)?.__name ?? '<anonymous>');
}

export interface WevuComponentOptions {
  /** virtualHost removes the component's host node so flex chains run
   * through the template root exactly like the vdom platforms. */
  virtualHost?: boolean;
  /** `Component()`-constructed pages get their lifecycle hooks here. */
  isPage?: boolean;
  /** Initial template data known at compile time. A page mounts in onLoad,
   * after its child components attached — the page's route location goes
   * here so the shell reads it from the very first render. */
  data?: Record<string, unknown>;
}

let loadingQuery: Record<string, string> | null = null;

/** The query of the page whose setup() is running (compiled pages read it
 * into their route location before any page code runs); `{}` elsewhere. */
export function pageQuery(): Record<string, string> {
  return { ...(loadingQuery ?? {}) };
}

/** Registers the SFC with the mini-program runtime. Calling this is the
 * module's side effect — exactly what `Component()` means on wx. */
export function createWevuComponent(sfc: WevuSfc, options: WevuComponentOptions = {}): void {
  const names = propNames(sfc);
  const config: Record<string, unknown> = {
    options: {
      // virtualHost everywhere EXCEPT the page root: a Component()-page
      // without its own host node crashed skyline's attachView ("appendChild
      // expects a valid Node") — the official skyline pages never do this
      virtualHost: options.virtualHost !== false && !options.isPage,
      multipleSlots: true,
      addGlobalClass: true,
    },
    properties: Object.fromEntries(names.map((n) => [n, { type: null, value: null }])),
    data: { ...(options.data ?? {}) },
    // keep the props mirror in sync; assigning the reactive props re-runs
    // computeds that depend on them
    observers: names.length
      ? { [names.join(',')]: function (this: MpInstance) {
          const state = this.__fjs_state as InstanceState | undefined;
          if (!state) return;
          for (const n of names) state.props[n] = this.data[n] ?? null;
        } }
      : {},
    lifetimes: {
      attached(this: MpInstance) {
        this.__fjs_sfc = sfc;
        // a page mounts in onLoad, where its query exists (see pageQuery)
        if (!options.isPage) mountInstance(this, sfc);
      },
      // pages run their mounted hooks from methods.onReady below — running
      // them here too fired every page's onMounted twice
      ready(this: MpInstance) {
        if (options.isPage) return;
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, MOUNTED);
        afterMountedRender(this);
      },
      detached(this: MpInstance) {
        unmountInstance(this);
      },
    },
    pageLifetimes: {
      show(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'show');
      },
      hide(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'hide');
      },
    },
    methods: {
      __fjsCall: fjsCall,
      // catchtouchmove target for a `touch-action: none` node without a
      // touchmove handler: the catch is the point, the call does nothing
      __fjsNoop() {},
      // webview sticky-header's re-measure trigger (specs/053): the
      // compiler binds the hosting scroll-view's scroll here, and the
      // fjs-sticky-header components listen on the app-level registry —
      // an IntersectionObserver cannot see the pin moment of a header
      // that is fully visible (its ratio never changes).
      __fjsStickyTick(this: MpInstance) {
        const app = getApp() as {
          __fjsStickyHeaders?: unknown[];
          __fjsStickyHostTops?: number[];
        };
        const listeners = app?.__fjsStickyHeaders;
        if (!listeners) return;
        // refresh the host scrollers' viewport tops first: a pinned header
        // sits at HOST top + offset-top, and the scroller usually sits
        // mid-page, so the tops are the pin line's real coordinates
        const scope = this as unknown as {
          createSelectorQuery: () => {
            selectAll: (sel: string) => {
              boundingClientRect: (
                cb: (rects: Array<{ top: number }>) => void,
              ) => { exec: () => void };
            };
          };
        };
        scope
          .createSelectorQuery()
          .selectAll('.fjs-sticky-host')
          .boundingClientRect((rects) => {
            app.__fjsStickyHostTops = (rects ?? []).map((r) => r.top);
            for (const fn of listeners) (fn as () => void)();
          })
          .exec();
      },
    },
  };

  if (options.isPage) {
    // Component()-constructed pages carry the page lifecycle in methods
    // (the skyline quickstart template registers pages exactly this way)
    config.methods = {
      ...(config.methods as Record<string, unknown>),
      onLoad(this: MpInstance, query: Record<string, string>) {
        this.__fjs_sfc = sfc;
        loadingQuery = query ?? {};
        try {
          mountInstance(this, sfc);
        } finally {
          loadingQuery = null;
        }
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'load', query ?? {});
      },
      onShow(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'show');
      },
      onReady(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, MOUNTED);
        afterMountedRender(this);
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'ready');
      },
      onHide(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'hide');
      },
      onUnload(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'unload');
        unmountInstance(this);
      },
    };
  }

  Component(config);
}
