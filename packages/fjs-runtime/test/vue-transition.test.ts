// <Transition> on the fjs renderer: the shim (vue-shim.ts) flips the
// `-enter-*` / `-leave-*` classes through the style engine and times their
// removal off the element's computed animation duration — there are no DOM
// end events. These tests pin the sequence vant's overlays rely on: enter
// classes land at mount and come off when the animation ends; a leave keeps
// the element in the tree until its animation has played, then (v-if) it
// unmounts or (v-show) drops to display:none.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, nextTick, ref, withDirectives } from '@vue/runtime-core';
import type { VNode } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { Transition, vShow } from '../src/vue/vue-shim';
import { createApp, flutterRoot, registerStyles, styleEngine } from '../src/vue';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

const CSS = `
  .box { width: 100px; height: 40px }
  .van-fade-enter-active { animation: van-fade-in .3s both }
  .van-fade-leave-active { animation: van-fade-out .3s both }
  @keyframes van-fade-in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes van-fade-out { from { opacity: 1 } to { opacity: 0 } }
  .sheet { transition: transform .3s }
  .van-slide-enter-from, .van-slide-leave-active { transform: translate3d(0, 100%, 0) }
  .van-slide-leave-active { transition-timing-function: ease-in }
`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let unmount: (() => void) | undefined;

function mountTransition(child: () => VNode, name = 'van-fade'): () => number {
  const root = flutterRoot();
  registerStyles(null, CSS);
  const app = createApp({
    render: () => h(Transition, { name }, { default: child }),
  });
  app.mount(root);
  unmount = () => app.unmount();
  // resolved lazily: a v-if child that starts false does not exist yet. The
  // engine is a process-wide singleton and ids only grow, so the box of the
  // CURRENT test is the last one carrying the class.
  return (): number => {
    let found: number | undefined;
    for (let id = 1; id < 4096; id++) {
      if (styleEngine.classesOf(id).includes('box')) found = id;
    }
    expect(found, 'no .box element registered').toBeDefined();
    return found!;
  };
}

describe('<Transition> class timing', () => {
  beforeEach(() => setOpSink(() => {}));
  afterEach(async () => {
    unmount?.();
    unmount = undefined;
    // unmount queued an op flush on a microtask; drain it while the sink is
    // still set or the flush lands on null and vitest records an unhandled
    // error
    await new Promise((r) => setTimeout(r, 0));
    setOpSink(null);
  });

  it('enter: -from + -active at mount, off when the animation ends', async () => {
    const show = ref(false);
    const boxId = mountTransition(() => (show.value ? h('view', { class: 'box' }, 'x') : null));

    show.value = true;
    await nextTick();
    await nextTick();
    const id = boxId();
    // mounted with the from+active pair; the animation is live
    expect(styleEngine.classesOf(id)).toContain('van-fade-enter-active');
    expect(styleEngine.computedOf(id)?.animationName).toBe('van-fade-in');

    // .3s animation + two nextFrame hops + slack
    await sleep(600);
    expect(styleEngine.classesOf(id).filter((c) => c.startsWith('van-fade-'))).toEqual([]);
    expect(styleEngine.computedOf(id)?.animationName).toBeUndefined();
  });

  it('leave (v-if): the element stays and animates, then unmounts', async () => {
    const show = ref(true);
    const boxId = mountTransition(() => (show.value ? h('view', { class: 'box' }, 'x') : null));
    await nextTick();
    const id = boxId();
    await sleep(600); // let the enter finish first
    expect(styleEngine.classesOf(id).filter((c) => c.startsWith('van-fade-'))).toEqual([]);

    show.value = false;
    await nextTick();
    await nextTick();
    // still mounted, playing the leave animation
    expect(styleEngine.classesOf(id)).toContain('van-fade-leave-active');
    expect(styleEngine.computedOf(id)?.animationName).toBe('van-fade-out');

    await sleep(600);
    // done: classes off and the element gone from the engine
    expect(styleEngine.classesOf(id).filter((c) => c.startsWith('van-fade-'))).toEqual([]);
    expect(styleEngine.computedOf(id)?.animationName).toBeUndefined();
  });

  it('leave (v-show): display none arrives only after the animation', async () => {
    const show = ref(true);
    const boxId = mountTransition(() =>
      withDirectives(h('view', { class: 'box' }, 'x'), [[vShow, show.value]]),
    );
    await nextTick();
    const id = boxId();
    await sleep(600); // enter settles
    expect(styleEngine.inlineRecord(id)?.display).toBeUndefined();

    show.value = false;
    await nextTick();
    await nextTick();
    // mid-leave: the leave animation is on, display NOT none yet
    expect(styleEngine.classesOf(id)).toContain('van-fade-leave-active');
    expect(styleEngine.inlineRecord(id)?.display).toBeUndefined();

    await sleep(600);
    // done: hidden and classes off
    expect(styleEngine.inlineRecord(id)?.display).toBe('none');
    expect(styleEngine.classesOf(id).filter((c) => c.startsWith('van-fade-'))).toEqual([]);

    // the SECOND show: display must come back before the enter animation,
    // or the popup would only ever open once (vant's v-model:show cycle)
    show.value = true;
    await nextTick();
    await nextTick();
    expect(styleEngine.inlineRecord(id)?.display).toBeUndefined();
    expect(styleEngine.classesOf(id)).toContain('van-fade-enter-active');
    await sleep(600);
    expect(styleEngine.inlineRecord(id)?.display).toBeUndefined();
    expect(styleEngine.classesOf(id).filter((c) => c.startsWith('van-fade-'))).toEqual([]);
  });

  it('leave (v-show) on a `transition` element waits for the transition', async () => {
    // vant's popup slide: no animation, a class-flipped transform under
    // `transition: transform .3s` — resolving at once would hide the sheet
    // before it ever slides out
    const show = ref(true);
    const boxId = mountTransition(
      () => withDirectives(h('view', { class: 'box sheet' }, 'x'), [[vShow, show.value]]),
      'van-slide',
    );
    await nextTick();
    const id = boxId();
    await sleep(600);

    show.value = false;
    await nextTick();
    await nextTick();
    await sleep(150);
    // mid-slide: still displayed, sliding out
    expect(styleEngine.classesOf(id)).toContain('van-slide-leave-active');
    expect(styleEngine.inlineRecord(id)?.display).toBeUndefined();

    await sleep(450);
    expect(styleEngine.inlineRecord(id)?.display).toBe('none');
    expect(styleEngine.classesOf(id).filter((c) => c.startsWith('van-slide-'))).toEqual([]);
  });
});
