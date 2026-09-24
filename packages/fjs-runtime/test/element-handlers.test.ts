// Which handler prop names actually reach the native side.
//
// A template writes `@scrolltolower`, and Vue turns that into the prop
// `onScrolltolower` — all lower case. That spelling was missing from
// EventType, so on the Flutter path the handler was dropped without a
// word and the event never fired on device (the web adapter, which never
// goes through this layer, worked). Both halves of that failure are
// asserted here: the name resolves, and an unknown one is loud.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, setProps, installEventDispatcher, forgetHandlers } from '../src/ui/element';
import { getWriter, setOpSink } from '../src/host';
import { patchProp } from '../src/vue/renderer';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

type Dispatch = (id: number, type: number, payload: string | null) => void;
const dispatchEvent = () =>
  (globalThis as { __fjsDispatchEvent?: Dispatch }).__fjsDispatchEvent!;

beforeEach(() => {
  setOpSink(() => {});
  installEventDispatcher();
});

/** The props a setProps call actually sends to the peer — the frame is
 * binary, so the writer is watched instead of decoded. */
function sentProps(fn: () => void): Record<string, unknown> {
  const writer = getWriter();
  const spy = vi
    .spyOn(writer, 'setProps')
    .mockImplementation(() => {});
  try {
    fn();
    return spy.mock.calls.length
      ? (spy.mock.calls[spy.mock.calls.length - 1][1] as Record<string, unknown>)
      : {};
  } finally {
    spy.mockRestore();
  }
}

const SCROLL_TO_UPPER = 24;
const SCROLL_TO_LOWER = 25;

describe('handler prop names', () => {
  it('accepts the spelling a template produces, under one canonical name',
    (): void => {
      const el = create('scroll-view');
      const seen: string[] = [];
      const props = sentProps(() =>
        setProps(el, {
          onScrolltolower: () => seen.push('lower'),
          onScrolltoupper: () => seen.push('upper'),
        }),
      );
      // the prop the Dart side looks for is the all-lower one
      expect(props.onScrolltolower).toBe(true);
      expect(props.onScrolltoupper).toBe(true);

      dispatchEvent()(el.id, SCROLL_TO_LOWER, null);
      dispatchEvent()(el.id, SCROLL_TO_UPPER, null);
      expect(seen).toEqual(['lower', 'upper']);
    });

  it('routes the camelCase alias to the same canonical prop and event', () => {
    const el = create('scroll-view');
    const seen: string[] = [];
    const props = sentProps(() =>
      setProps(el, { onScrollToLower: () => seen.push('lower') }),
    );
    expect(props.onScrolltolower).toBe(true);
    expect(props.onScrollToLower).toBeUndefined();

    dispatchEvent()(el.id, SCROLL_TO_LOWER, null);
    expect(seen).toEqual(['lower']);
  });

  it('sends a swiper\'s @change as the page event, not the value one', () => {
    // The web adapter emits `change` from the swiper as well, so a template
    // that works there has to work here: without the tag-aware alias the
    // handler lands under onValueChanged (5) while the swiper dispatches
    // pageChanged (6), and nothing ever calls it.
    const swiper = create('swiper');
    const swiperProps = sentProps(() =>
      patchProp(swiper, 'onChange', null, () => {}),
    );
    expect(swiperProps.onPageChanged).toBe(true);

    // ...and a control's @change still means the value changed
    const box = create('checkbox');
    const boxProps = sentProps(() => patchProp(box, 'onChange', null, () => {}));
    expect(boxProps.onValueChanged).toBe(true);
  });

  it('warns instead of silently dropping a handler it does not know', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = create('scroll-view');
    setProps(el, { onScrollToNowhere: () => {} });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('onScrollToNowhere');
    warn.mockRestore();
  });
});

describe('Vue event option modifiers', () => {
  // `@touchstart.passive` compiles to `onTouchstartPassive`, and vant's
  // Slider writes that key by hand: kept whole, it named no event and the
  // drag never started
  it('peels Passive / Capture / Once off the event name', (): void => {
    const el = create('view');
    const props = sentProps(() => patchProp(el, 'onTouchstartPassive', null, () => {}));
    expect(props.onTouchstart).toBe(true);
    expect(props.onTouchstartPassive).toBeUndefined();
  });

  it('Once fires the handler a single time', (): void => {
    const el = create('view');
    let calls = 0;
    patchProp(el, 'onClickOnce', null, () => calls++);
    dispatchEvent()(el.id, 1, null);
    dispatchEvent()(el.id, 1, null);
    expect(calls).toBe(1);
    // a re-render re-patches an inline handler with a new function: still once
    patchProp(el, 'onClickOnce', null, () => calls++);
    dispatchEvent()(el.id, 1, null);
    expect(calls).toBe(1);
  });
});

describe('getBoundingClientRect', () => {
  it('answers an all-zero rect without a host, never throws', (): void => {
    const el = create('view');
    expect(el.getBoundingClientRect()).toMatchObject({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
  });

});

describe('addEventListener', () => {
  const TOUCH_MOVE = 16;
  const move = JSON.stringify({ ts: 1, touches: [[1, 10, 20]] });

  it('marks the node once and fires alongside the prop handler', (): void => {
    const el = create('view');
    const seen: string[] = [];
    const props = sentProps(() => el.addEventListener('touchmove', () => seen.push('listener')));
    expect(props.onTouchmove).toBe(true);
    setProps(el, { onTouchmove: () => seen.push('prop') });
    dispatchEvent()(el.id, TOUCH_MOVE, move);
    expect(seen).toEqual(['prop', 'listener']);
  });

  it('keeps the native marker while either side still listens', (): void => {
    const el = create('view');
    const fn = (): void => {};
    setProps(el, { onTouchmove: () => {} });
    el.addEventListener('touchmove', fn);
    // the prop handler goes, the listener stays: no `false` to the peer
    expect(sentProps(() => setProps(el, { onTouchmove: null })).onTouchmove).toBeUndefined();
    expect(sentProps(() => el.removeEventListener('touchmove', fn)).onTouchmove).toBe(false);
  });
});

// specs/118: forgetHandlers drops only the event types the node registered
// (an index kept per node) instead of trying every type there is. The
// behaviour must be the same — nothing registered on the node survives —
// for prop handlers and DOM listeners alike.
describe('forgetHandlers', () => {
  const TAP = 1;
  const TOUCH_MOVE = 16;
  const move = JSON.stringify({ ts: 1, touches: [[1, 10, 20]] });

  it('drops prop handlers and DOM listeners of every type the node used', (): void => {
    const el = create('view');
    const seen: string[] = [];
    setProps(el, { onTap: () => seen.push('tap'), onTouchmove: () => seen.push('prop-move') });
    el.addEventListener('touchmove', () => seen.push('listener-move'));
    forgetHandlers(el.id);
    dispatchEvent()(el.id, TAP, null);
    dispatchEvent()(el.id, TOUCH_MOVE, move);
    expect(seen).toEqual([]);
  });

  it('leaves other nodes alone', (): void => {
    const a = create('view');
    const b = create('view');
    const seen: string[] = [];
    setProps(a, { onTap: () => seen.push('a') });
    setProps(b, { onTap: () => seen.push('b') });
    forgetHandlers(a.id);
    dispatchEvent()(a.id, TAP, null);
    dispatchEvent()(b.id, TAP, null);
    expect(seen).toEqual(['b']);
  });

  it('is a no-op on a node that never registered anything, and twice', (): void => {
    const el = create('view');
    expect(() => {
      forgetHandlers(el.id);
      forgetHandlers(el.id);
    }).not.toThrow();
  });

  it('a node re-registering after a forget gets a fresh marker', (): void => {
    const el = create('view');
    setProps(el, { onTap: () => {} });
    forgetHandlers(el.id);
    // the registry no longer has it, so the peer must be told again
    expect(sentProps(() => setProps(el, { onTap: () => {} })).onTap).toBe(true);
  });
});
