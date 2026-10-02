// The rest of compiler-vapor's helper surface (specs/170), framework-
// neutral like host.ts: every helper the compiler can emit has to resolve,
// or a page using the matching syntax dies at module load with
// `_xxx is not a function` (it did, on both ends — `ref=`, `v-show`,
// `v-model`, `:value`, `v-bind="obj"`…). What a backend cannot do degrades
// with a one-time warning instead (constitution V). Semantics follow
// @vue/runtime-vapor 3.6.0-rc.9; the hydration branches are left out.
import { camelize, extend as sharedExtend, looseEqual, looseToNumber, normalizeClass, normalizeStyle, toDisplayString } from '@vue/shared';
import { showTransitionOf } from './transition';
import {
  addListener,
  be,
  blockOf,
  hostOf,
  insertBlock,
  renderEffect,
  reportVaporError,
  setClass,
  setFallthroughClass,
  setStyleHost,
  showHost,
  TplNode,
  type Block,
  type HostNode,
} from './host';

const warned = new Set<string>();
export function warnVaporOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs vapor] ${message}`);
}

/** Every host a helper target stands for: a template node, a bare host, or
 * a block (a component / fragment — v-show on a component applies to each
 * of its element roots). */
function hostsOf(target: unknown): HostNode[] {
  if (target instanceof TplNode) return [target.host];
  if (target && typeof target === 'object' && Array.isArray((target as Block).nodes)) {
    return (target as Block).nodes.filter((n) => n && typeof n === 'object') as HostNode[];
  }
  return [hostOf(target)];
}

// ---- plain writes ----------------------------------------------------------------------

export function setValue(el: unknown, value: unknown): void {
  const host = hostOf(el);
  const b = be();
  if (b.setValue) b.setValue(host, value);
  else b.setAttr(host, 'value', value);
}

export function setDOMProp(el: unknown, key: string, value: unknown): void {
  const host = hostOf(el);
  const b = be();
  if (b.setDOMProp) b.setDOMProp(host, key, value);
  else b.setAttr(host, key, value);
}

export function setElementText(el: unknown, value: unknown): void {
  be().setElementText(hostOf(el), toDisplayString(value));
}

export function setHtml(el: unknown, value: unknown): void {
  const host = hostOf(el);
  const html = value == null ? '' : String(value);
  const b = be();
  if (b.setHtml) {
    b.setHtml(host, html);
    return;
  }
  warnVaporOnce('v-html', 'v-html has no HTML parser on this platform — the value is written as text. Use <rich-text> for markup.');
  b.setElementText(host, html);
}

// ---- v-show ----------------------------------------------------------------------------

export function applyVShow(target: unknown, source: () => unknown): void {
  const hosts = hostsOf(target);
  let shown: boolean | null = null;
  renderEffect(() => {
    const visible = !!source();
    const first = shown === null;
    if (visible === shown) return;
    shown = visible;
    for (const host of hosts) {
      // a <Transition> around the element (specs/174) registers itself after
      // this first run — the initial state never animates (appear does that)
      const t = first ? undefined : showTransitionOf(host);
      if (!t) {
        showHost(host, visible);
      } else if (visible) {
        showHost(host, true);
        t.enter([host]);
      } else {
        t.leave([host], () => showHost(host, false));
      }
    }
  });
}

// ---- v-model ---------------------------------------------------------------------------

type ModelModifiers = { trim?: boolean; number?: boolean; lazy?: boolean };

export function applyTextModel(
  el: unknown,
  get: () => unknown,
  set: (v: unknown) => void,
  modifiers: ModelModifiers = {},
): void {
  const host = hostOf(el);
  const b = be();
  const tm = b.textModel;
  if (!tm) {
    warnVaporOnce('v-model-text', 'v-model on a text field is not supported by this backend — bind :value and listen for the input event instead.');
    return;
  }
  let lastWritten: unknown;
  addListener(host, tm.event(!!modifiers.lazy), (payload: unknown) => {
    const raw = tm.read(payload, host);
    let value: unknown = raw;
    if (modifiers.trim) value = raw.trim();
    if (modifiers.number) value = looseToNumber(value as string);
    lastWritten = raw;
    set(value);
  });
  renderEffect(() => {
    const v = get();
    const next = v == null ? '' : String(v);
    // the field already shows what the user typed (a trimmed / numeric
    // model reads back differently): writing it back would move the caret
    if (lastWritten !== undefined && (modifiers.trim || modifiers.number)) {
      const typed = modifiers.number ? looseToNumber(modifiers.trim ? String(lastWritten).trim() : String(lastWritten)) : String(lastWritten).trim();
      if (looseEqual(typed, v)) return;
    }
    setValue(host, next);
  });
}

function choiceModel(kind: 'checkbox' | 'radio' | 'select' | 'dynamic') {
  return (el: unknown, get: () => unknown, set: (v: unknown) => void, modifiers: ModelModifiers = {}): void => {
    const host = hostOf(el);
    const b = be();
    if (kind === 'dynamic' && !b.applyChoiceModel) {
      applyTextModel(el, get, set, modifiers);
      return;
    }
    if (!b.applyChoiceModel?.(host, kind, get, set, modifiers as Record<string, boolean | undefined>)) {
      warnVaporOnce(`v-model-${kind}`, `v-model on a ${kind} control is not supported on this platform — use the fjs control's own value prop and change event.`);
    }
  };
}

export const applyCheckboxModel = choiceModel('checkbox');
export const applyRadioModel = choiceModel('radio');
export const applySelectModel = choiceModel('select');
export const applyDynamicModel = choiceModel('dynamic');

// ---- events ----------------------------------------------------------------------------

/** One stable listener per (host, event): v-on="obj" and v-bind="obj"
 * re-run on every change, and re-registering would stack listeners — the
 * invoker stays, its target handler is swapped. */
const invokers = new WeakMap<object, Map<string, { current: unknown }>>();

function bindHandler(host: HostNode, key: string, handler: unknown): void {
  let map = invokers.get(host as object);
  if (!map) {
    map = new Map();
    invokers.set(host as object, map);
  }
  const existing = map.get(key);
  if (existing) {
    existing.current = handler;
    return;
  }
  const slot = { current: handler };
  map.set(key, slot);
  addListener(host, key, (...args: unknown[]) => {
    const h = slot.current;
    if (Array.isArray(h)) for (const fn of h) callHandler(fn, args);
    else callHandler(h, args);
  });
}

function callHandler(fn: unknown, args: unknown[]): void {
  if (typeof fn !== 'function') return;
  try {
    (fn as (...a: unknown[]) => unknown)(...args);
  } catch (e) {
    reportVaporError(e, 'event handler');
  }
}

function eventKey(name: string): string {
  // `on:click` / `click` / `onClick` all land on the `onClick` key the
  // backends speak
  const bare = name.startsWith('on:') ? name.slice(3) : name;
  if (/^on[A-Z]/.test(bare)) return bare;
  const c = camelize(bare);
  return 'on' + c.charAt(0).toUpperCase() + c.slice(1);
}

export function onBinding(el: unknown, event: string, handler: unknown, _options?: unknown): void {
  bindHandler(hostOf(el), eventKey(event), handler);
}

export function setDynamicEvents(el: unknown, events: Record<string, unknown> | null | undefined): void {
  const host = hostOf(el);
  for (const name in events ?? {}) bindHandler(host, eventKey(name), (events as Record<string, unknown>)[name]);
}

/** A handler wrapped so a throw reaches the app's errorHandler. */
export function createInvoker<T extends (...args: unknown[]) => unknown>(handler: T): T {
  return ((...args: unknown[]) => {
    try {
      return handler(...args);
    } catch (e) {
      reportVaporError(e, 'event handler');
      return undefined;
    }
  }) as T;
}

// ---- v-bind="obj" ------------------------------------------------------------------------

/** What each host's last dynamic props were: a key that disappears must
 * be cleared, like a removed attribute. */
const dynamicRecords = new WeakMap<object, Record<string, unknown>>();

/** Vue's mergeProps for the array form `v-bind="[a, b]"`: class and style
 * concatenate, `on*` handlers stack, the rest is last-wins. */
export function mergeVaporProps(list: readonly (Record<string, unknown> | null | undefined)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of list) {
    if (!p) continue;
    for (const key in p) {
      const v = p[key];
      if (key === 'class') out.class = normalizeClass([out.class, v] as never);
      else if (key === 'style') out.style = normalizeStyle([out.style, v] as never);
      else if (/^on[A-Z]/.test(key) && out[key] && out[key] !== v) {
        out[key] = ([] as unknown[]).concat(out[key], v);
      } else out[key] = v;
    }
  }
  return out;
}

/** Applies a props record to a host: the one writer v-bind="obj" and the
 * component attrs fallthrough share. `fallthrough` writes class into the
 * fallthrough layer (merged with the element's own) instead of replacing. */
export function patchHostProps(host: HostNode, next: Record<string, unknown>, recordKey: object, fallthrough = false): void {
  const prev = dynamicRecords.get(recordKey) ?? {};
  for (const key in prev) {
    if (key in next) continue;
    if (key === 'class') {
      if (fallthrough) setFallthroughClass(host, '');
      else setClass(host, '');
    } else if (key === 'style') {
      const cleared: Record<string, unknown> = {};
      for (const k in (prev.style as Record<string, unknown>) ?? {}) cleared[k] = null;
      setStyleHost(host, cleared);
    } else if (/^on[A-Z]/.test(key)) {
      bindHandler(host, key, undefined);
    } else {
      be().setAttr(host, key, null);
    }
  }
  for (const key in next) {
    const v = next[key];
    if (key === 'class') {
      if (fallthrough) setFallthroughClass(host, v);
      else setClass(host, v);
    } else if (key === 'style') {
      const style = (normalizeStyle(v as never) ?? {}) as Record<string, unknown>;
      const prevStyle = (prev.style as Record<string, unknown>) ?? {};
      const patch: Record<string, unknown> = { ...style };
      for (const k in prevStyle) if (!(k in style)) patch[k] = null;
      setStyleHost(host, patch);
      next = { ...next, style };
    } else if (/^on[A-Z]/.test(key)) {
      bindHandler(host, key, v);
    } else if (key === 'value') {
      setValue(host, v);
    } else {
      be().setAttr(host, key, v);
    }
  }
  dynamicRecords.set(recordKey, next);
}

export function setDynamicProps(el: unknown, args: readonly (Record<string, unknown> | null | undefined)[], _isSVG?: boolean): void {
  const host = hostOf(el);
  const props = args.length > 1 ? mergeVaporProps(args) : (args[0] ?? {});
  patchHostProps(host, props as Record<string, unknown>, host as object);
}

// ---- v-for selector -----------------------------------------------------------------------

/** `:class="{ on: sel === item }"` in a v-for compiles to a selector: Vue
 * re-runs only the two items whose match flipped. Here each registered
 * operation is a plain renderEffect over its own reads — correct, without
 * the O(1) switch (the compiled operation reads the source itself). */
export function createSelector(_source: () => unknown): ((key: unknown, oper: () => void) => void) & { reset: () => void } {
  const register = ((_key: unknown, oper: () => void) => {
    renderEffect(oper);
  }) as ((key: unknown, oper: () => void) => void) & { reset: () => void };
  register.reset = () => {};
  return register;
}

// ---- misc ------------------------------------------------------------------------------

export function insert(block: unknown, parent: unknown, anchor: unknown = null): void {
  insertBlock(blockOf(block), hostOf(parent), anchor == null ? null : hostOf(anchor));
}

export function getDefaultValue<T>(val: T | undefined, getDefault: () => T): T {
  return val === undefined ? getDefault() : val;
}

export function getRestElement(val: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const res: Record<string, unknown> = {};
  for (const key of Object.keys(val)) if (!keys.includes(key)) res[key] = val[key];
  return res;
}

export const extend = sharedExtend;
