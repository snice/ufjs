// specs/118: elements share one prototype instead of carrying their own
// closures. The DOM-shaped surface pages and libraries use must be exactly
// what it was — every member present, `this` resolving to the element it is
// called on, and no state leaking between two elements through the shared
// object.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, getWriter, setOpSink } from '../src/index';
import type { Element } from '../src/ui/element';

beforeEach(() => {
  setOpSink(() => {});
});

const MEMBERS = [
  'appendChild', 'removeChild', 'setText', 'setProps', 'getBoundingClientRect',
  'addEventListener', 'removeEventListener', 'focus', 'blur',
] as const;
const GETTERS = ['style', 'offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop', 'offsetParent'];

describe('Element prototype (specs/118)', () => {
  it('has every DOM-shaped member, and only id/tag as own state', () => {
    const el = create('view');
    for (const m of MEMBERS) expect(typeof el[m], m).toBe('function');
    for (const g of GETTERS) expect(g in el, g).toBe(true);
    expect(Object.keys(el).sort()).toEqual(['id', 'tag']);
  });

  it('two elements share the methods but not their identity', () => {
    const a = create('view');
    const b = create('text');
    expect(a.setText).toBe(b.setText);
    expect(a.id).not.toBe(b.id);
    expect([a.tag, b.tag]).toEqual(['view', 'text']);
  });

  it('methods write ops for the element they are called on', () => {
    const a = create('view');
    const b = create('view');
    const w = getWriter();
    const setText = vi.spyOn(w, 'setText');
    const insert = vi.spyOn(w, 'insert');
    const removeChild = vi.spyOn(w, 'removeChild');
    try {
      expect(b.setText('hi')).toBe(b);
      expect(setText).toHaveBeenLastCalledWith(b.id, 'hi');
      expect(a.appendChild(b)).toBe(b);
      expect(insert).toHaveBeenLastCalledWith(a.id, b.id, 0x7fffffff);
      a.removeChild(b);
      expect(removeChild).toHaveBeenLastCalledWith(a.id, b.id);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('methods resolve their element from `this`', () => {
    const el = create('view');
    const { getBoundingClientRect } = el;
    expect(() => getBoundingClientRect.call(el)).not.toThrow();
  });

  it('el.style reads and writes per element', () => {
    const a = create('view');
    const b = create('view');
    a.style.opacity = '0.5';
    b.style.setProperty('opacity', '0.25');
    expect(a.style.opacity).toBe('0.5');
    expect(b.style.getPropertyValue('opacity')).toBe('0.25');
  });

  it('an instance member shadows nothing it should not', () => {
    const el = create('input') as Element & { value?: string };
    Object.defineProperty(el, 'value', { value: 'x', configurable: true });
    const other = create('input') as Element & { value?: string };
    expect(el.value).toBe('x');
    expect(other.value).toBeUndefined();
  });
});
