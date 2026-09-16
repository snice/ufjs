// v-motion on the mini program (spec 061): the runtime hands the library a
// DOM-shaped stand-in and turns its style writes into a bindable string.
// `useMotion` is faked here — what is under test is the stand-in and the
// per-item instance bookkeeping, not @vueuse/motion itself.
import { describe, expect, it } from 'vitest';
import { ref } from '@vue/reactivity';

import { motion, motionEach, type MotionHost, type UseMotion } from '../src/wx/motion';

function fakeUseMotion(seen: Array<Record<string, unknown>>): UseMotion {
  return (target, variants, options) => {
    seen.push({ variants, options });
    const host = target as MotionHost;
    // the real library applies `initial` synchronously, then tweens
    Object.assign(host.style, (variants.initial as object) ?? {});
    return {
      apply: async (name: string) => {
        Object.assign(host.style, (variants[name] as object) ?? {});
      },
      stop: () => {
        seen.push({ stopped: true });
      },
    };
  };
}

describe('motion', () => {
  it('binds the stand-in style as css text and disables the DOM features', () => {
    const seen: Array<Record<string, unknown>> = [];
    const style = motion(fakeUseMotion(seen), () => ({
      initial: { opacity: 0, transform: 'translateX(0px)' },
    }));
    expect(style.value).toBe('opacity:0;transform:translateX(0px)');
    expect(seen[0].options).toEqual({
      syncVariants: true,
      lifeCycleHooks: true,
      visibilityHooks: false,
      eventListeners: false,
    });
  });

  it('hands the stand-in to the :ref attachment so the page can drive it', async () => {
    const seen: Array<Record<string, unknown>> = [];
    let handle: MotionHost | null = null;
    const style = motion(
      fakeUseMotion(seen),
      () => ({ initial: { opacity: 0 }, right: { opacity: 1 } }),
      (host) => (handle = host),
    );
    await handle!.motionInstance!.apply('right');
    expect(style.value).toBe('opacity:1');
  });
});

describe('motionEach', () => {
  it('makes one instance per item, with the item in its variants', () => {
    const seen: Array<Record<string, unknown>> = [];
    const list = ref([{ x: 1 }, { x: 2 }]);
    const styles = motionEach(
      fakeUseMotion(seen),
      () => list.value,
      (item) => ({ initial: { opacity: (item as { x: number }).x } }),
    );
    expect(styles.value).toEqual(['opacity:1', 'opacity:2']);
  });

  it('keeps existing instances when the list grows and stops the ones that go', () => {
    const seen: Array<Record<string, unknown>> = [];
    const list = ref([1, 2]);
    const styles = motionEach(
      fakeUseMotion(seen),
      () => list.value,
      (item) => ({ initial: { opacity: item as number } }),
    );
    const created = seen.length;
    list.value = [1, 2, 3];
    expect(styles.value).toEqual(['opacity:1', 'opacity:2', 'opacity:3']);
    expect(seen.length).toBe(created + 1); // only the new item was created
    list.value = [1];
    expect(styles.value).toEqual(['opacity:1']);
    expect(seen.filter((e) => e.stopped).length).toBe(2);
  });

  it('rebuilds an item whose :key changed, the way a remount replays', () => {
    const seen: Array<Record<string, unknown>> = [];
    const run = ref(0);
    const styles = motionEach(
      fakeUseMotion(seen),
      () => ['a', 'b'],
      () => ({ initial: { opacity: run.value } }),
      undefined,
      (item) => `${run.value}-${item as string}`,
    );
    expect(styles.value).toEqual(['opacity:0', 'opacity:0']);
    const created = seen.length;
    run.value = 1;
    expect(styles.value).toEqual(['opacity:1', 'opacity:1']);
    expect(seen.length).toBe(created + 4); // two stops, two fresh instances
  });

  it('counts 1..n for a numeric v-for, as Vue does', () => {
    const seen: Array<Record<string, unknown>> = [];
    const styles = motionEach(
      fakeUseMotion(seen),
      () => 3,
      (item) => ({ initial: { opacity: item as number } }),
    );
    expect(styles.value).toEqual(['opacity:1', 'opacity:2', 'opacity:3']);
  });
});
