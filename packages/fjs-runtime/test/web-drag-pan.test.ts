// @vitest-environment happy-dom
//
// specs/127: mouse drag-panning a web scroller gives way when the page
// preventDefaults the touchmove of that same drag — vant's picker inside a
// Popup, driven by @vant/touch-emulator, used to spin AND drag the page.
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, ref } from 'vue';
import { dragPanBindings } from '../src/web/components/gestures';

async function mountScroller(onChildTouchmove?: (event: Event) => void) {
  const host = ref<HTMLElement | null>(null);
  const root = document.createElement('div');
  document.body.appendChild(root);
  createApp({
    setup: () => () =>
      h('div', { ref: host, class: 'scroller', ...dragPanBindings(host) }, [
        h('div', { class: 'child', onTouchmove: onChildTouchmove }),
      ]),
  }).mount(root);
  const scroller = root.querySelector('.scroller') as HTMLElement;
  const child = root.querySelector('.child') as HTMLElement;
  // happy-dom has no layout: make scrollTop writable and skip capture
  let top = 100;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set: (v: number) => (top = v),
  });
  scroller.setPointerCapture = () => {};
  // Vue drops an event stamped no later than its listener was attached;
  // dispatching in the mount's own millisecond made this test flaky
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { scroller, child };
}

function pointer(target: Element, type: string, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: 10, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

function touchmove(target: Element) {
  target.dispatchEvent(new Event('touchmove', { bubbles: true, cancelable: true }));
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dragPanBindings', () => {
  it('pans the scroller with a mouse drag', async () => {
    const { scroller, child } = await mountScroller();
    pointer(child, 'pointerdown', 200);
    pointer(child, 'pointermove', 150);
    touchmove(child); // not prevented: no effect
    await flush();
    expect(scroller.scrollTop).toBe(150);
  });

  it('gives the drag up when the page prevents its touchmove', async () => {
    const { scroller, child } = await mountScroller((event) => {
      // what vant's PickerColumn does
      event.preventDefault();
      event.stopPropagation();
    });
    pointer(child, 'pointerdown', 200);
    pointer(child, 'pointermove', 150);
    expect(scroller.scrollTop).toBe(150); // pointermove came first
    touchmove(child);
    await flush();
    expect(scroller.scrollTop).toBe(100); // taken back
    pointer(child, 'pointermove', 80);
    expect(scroller.scrollTop).toBe(100); // and the rest of the drag ignored
  });
});
