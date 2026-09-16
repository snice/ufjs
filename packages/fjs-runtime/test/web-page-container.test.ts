// @vitest-environment happy-dom
//
// specs/065, web half. The transition is phase-driven (mount at "out", flip
// to "in" two frames later, settle on transitionend-or-timer) — in happy-dom
// no transitionend ever fires, so every settle here goes through the timer
// fallback, which is the path real browsers take when duration is 0 or the
// tab is hidden. The Dart twin of this contract is the manual walkthrough in
// specs/065 (simulator); the mp side passes the wx built-in through.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Component } from 'vue';
import { FjsPageContainer } from '../src/web/components/page-container';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });

const events: string[] = [];

function mountContainer(overrides: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const show = ref(false);
  const app = createApp({
    setup() {
      return () =>
        h(
          FjsPageContainer,
          {
            show: show.value,
            duration: 300,
            position: 'bottom',
            onBeforeEnter: () => events.push('beforeEnter'),
            onEnter: () => events.push('enter'),
            onAfterEnter: () => events.push('afterEnter'),
            onBeforeLeave: () => events.push('beforeLeave'),
            onLeave: () => events.push('leave'),
            onAfterLeave: () => events.push('afterLeave'),
            onClickoverlay: () => events.push('clickoverlay'),
            ...overrides,
          },
          () => [h('view', { class: 'inner' }, 'hello')],
        );
    },
  } as Component);
  app.mount(el);
  const reopen = () => (show.value = true);
  const close = () => (show.value = false);
  return { el, reopen, close, app };
}

/** Flush the double-rAF "in" flip and the settle timer. */
const openUp = async () => {
  await nextTick();
  vi.advanceTimersByTime(32);
  await nextTick();
  vi.advanceTimersByTime(400);
  await nextTick();
};

const wrapper = () => document.body.querySelector('.fjs-page-container');

beforeEach(() => {
  events.length = 0;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('page-container (web)', () => {
  it('stays out of the DOM while show is false', () => {
    mountContainer();
    expect(wrapper()).toBeNull();
    expect(events).toEqual([]);
  });

  it('enters in order and settles afterEnter', async () => {
    const { reopen } = mountContainer();
    reopen();
    await openUp();

    expect(events).toEqual(['beforeEnter', 'enter', 'afterEnter']);
    const panel = wrapper()?.querySelector('.fjs-page-container-panel--bottom');
    expect(panel).not.toBeNull();
    // open state applied → transition target reached
    expect(wrapper()?.className).toContain('is-open');
    // slot content is live inside the panel
    expect(panel?.querySelector('.inner')?.textContent).toBe('hello');
  });

  it('leaves in order, unmounts, and reports afterLeave last', async () => {
    const { reopen, close } = mountContainer();
    reopen();
    await openUp();

    close();
    await nextTick();
    // leave chain fires immediately; the DOM stays until the transition ends
    expect(events).toEqual(['beforeEnter', 'enter', 'afterEnter', 'beforeLeave', 'leave']);
    expect(wrapper()).not.toBeNull();
    expect(wrapper()?.className).not.toContain('is-open');

    vi.advanceTimersByTime(400);
    await nextTick();
    expect(events[events.length - 1]).toBe('afterLeave');
    expect(wrapper()).toBeNull();
  });

  it('clicking the mask only reports clickoverlay — closing is up to the page', async () => {
    const { reopen } = mountContainer();
    reopen();
    await openUp();
    events.length = 0;

    (wrapper()?.querySelector('.fjs-page-container-mask') as HTMLElement).click();
    await nextTick();

    expect(events).toEqual(['clickoverlay']);
    expect(wrapper()).not.toBeNull();
  });

  it('maps position / round / duration onto classes and styles', async () => {
    const { reopen } = mountContainer({
      position: 'right',
      round: true,
      duration: 250,
    });
    reopen();
    await openUp();

    const panel = wrapper()?.querySelector('.fjs-page-container-panel--right');
    expect(panel).not.toBeNull();
    // happy-dom normalizes the shorthand ("0" → "0px")
    expect((panel as HTMLElement).style.borderRadius).toBe('24px 0px 0px 24px');
    expect((wrapper() as HTMLElement).style.getPropertyValue('--fjs-pc-dur')).toBe('250ms');
  });

  it('warns once and falls back to bottom for an unknown position', async () => {
    const warn: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((m: string) => warn.push(m));
    const { reopen } = mountContainer({ position: 'diagonal' });
    reopen();
    await openUp();

    expect(wrapper()?.querySelector('.fjs-page-container-panel--bottom')).not.toBeNull();
    expect(warn.join('\n')).toContain('position="diagonal"');
  });
});
