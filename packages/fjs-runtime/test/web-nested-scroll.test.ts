// @vitest-environment happy-dom
// specs/208: the web nested-scroll pair. The CSS rules (block baseline,
// first-child-only, absorption) are static — pinned here as source text,
// the way web-css-compat.test.ts pins its rules. The one piece with logic
// is the body's offset-top tail: a negative-top sticky ON THE HEADER (the
// body owns the prop), mounted when a header sits right before it. The
// scroll itself stays native — an earlier clamp at the collapse point froze
// the whole scroller, since the absorbed rows scroll in it too.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type Component } from 'vue';
import { FjsNestedScrollBody, FjsNestedScrollHeader } from '../src/web/components/nested-scroll';
import { BASE_CSS } from '../src/web/base-css';

function mount(render: () => unknown, into?: HTMLElement) {
  const el = into ?? document.createElement('div');
  if (!into) document.body.appendChild(el);
  const app = createApp({ render } as Component);
  app.mount(el);
  return el;
}

/** A type="nested" host with a header before the body, the shape the tail
 * expects. Returns the header element to assert its inline pin style. */
function mountNested(offsetTop: number | undefined) {
  const scroller = document.createElement('scroll-view');
  scroller.setAttribute('type', 'nested');
  scroller.style.overflowY = 'auto';
  const app = document.createElement('div');
  scroller.appendChild(app);
  document.body.appendChild(scroller);

  const app2 = createApp({
    render: () => [
      h(FjsNestedScrollHeader, () => h('view', 'hero')),
      h(FjsNestedScrollBody, offsetTop === undefined ? {} : { offsetTop }, () => h('view', 'rows')),
    ],
  } as Component);
  app2.mount(app);
  return scroller.querySelector('nested-scroll-header') as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('base-css rules', () => {
  it('hides every child but the first and absorbs the body scroller', () => {
    expect(BASE_CSS).toContain(
      'nested-scroll-header > :not(:first-child),\nnested-scroll-body > :not(:first-child) { display: none; }',
    );
    expect(BASE_CSS).toContain('nested-scroll-body > scroll-view');
    expect(BASE_CSS).toContain('overflow: visible !important');
  });
});

describe('FjsNestedScrollHeader', () => {
  it('renders the element around its children', () => {
    const el = mount(() => h(FjsNestedScrollHeader, () => h('view', 'x')));
    expect(el.querySelector('nested-scroll-header')).not.toBeNull();
  });
});

describe('FjsNestedScrollBody offset-top tail', () => {
  it('pins the preceding header with a negative-top sticky', async () => {
    // header measures 300 → the pin line is 88 - 300 = -212: the header
    // scrolls away until its bottom edge rests 88 from the viewport top
    const proto = HTMLElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'offsetHeight')!;
    const spy = vi.spyOn(proto, 'offsetHeight', 'get').mockReturnValue(300);
    try {
      const header = mountNested(88);
      await nextTick();
      expect(header.style.position).toBe('sticky');
      expect(header.style.top).toBe('-212px');
      expect(header.style.zIndex).toBe('1');
    } finally {
      spy.mockRestore();
      Object.defineProperty(proto, 'offsetHeight', desc);
    }
  });

  it('does not touch the header when offset-top is the default 0', async () => {
    const header = mountNested(undefined);
    await nextTick();
    expect(header.style.position).toBe('');
    expect(header.style.zIndex).toBe('');
  });

  it('warns when there is no header before the body', async () => {
    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((m: string) => warns.push(m));
    const scroller = document.createElement('scroll-view');
    scroller.setAttribute('type', 'nested');
    const app = document.createElement('div');
    scroller.appendChild(app);
    document.body.appendChild(scroller);
    mount(() => h(FjsNestedScrollBody, { offsetTop: 88 }, () => h('view')), app);
    await nextTick();
    expect(warns.join('\n')).toContain('has no <nested-scroll-header> right before it');
  });

  it('warns once when there is no scroll-view host', async () => {
    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((m: string) => warns.push(m));
    const el = mount(() => h(FjsNestedScrollBody, () => h('view')));
    await nextTick();
    expect(warns.join('\n')).toContain('has no <scroll-view> ancestor');
    expect(el.querySelector('nested-scroll-body')).not.toBeNull();
  });
});
