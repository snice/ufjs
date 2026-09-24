// <defer>: mount below-the-fold content after the page transition settles.
//
// Why it exists (specs/118): on the Flutter host a page mounts inside
// navMount, on the UI thread, while the push transition waits for it. Under
// the interpreter a vant node costs ~150 µs to mount (Vue + element layer +
// cascade), so a 350-node form is ~50 ms of frozen transition however much
// the per-node price is trimmed. The only lever left is mounting fewer nodes
// in that first frame: the part of the page the user sees first, now; the
// rest once the page has arrived.
//
// Why "after settle" and not "next frame": the next frame is still inside
// the transition, so the deferred mount would land on an animating frame
// and drop it. After settle nothing is animating. The cost is that deferred
// content shows up ~300 ms later — fine for content below the fold, which
// is the only thing this is for.
//
// Why not automatic (measure the viewport, defer whatever falls outside):
// there is no layout before the mount, so any guess can leave the first
// screen blank — a silent failure (constitution V). The page author knows
// where the fold is; the tag says it.
//
// Both hosts share this factory (constitution I). Each passes its own
// router's onPageSettled — the Flutter one keys off the page entry, the web
// one off vue-router's route — and its own placeholder tag. Once ready the
// slot renders as a fragment, with no wrapper element, so `.page > .group`
// selectors and flex layout are the same with and without <defer>.
import { defineComponent, h, onBeforeUnmount, ref, type PropType } from '@vue/runtime-core';

const warned = new Set<string>();

/** `placeholder-height` as a CSS length: a number is px, a string may be
 * `120` or `120px`. Anything else warns once and means no height. */
export function deferPlaceholderHeight(value: unknown): string | null {
  if (value == null || value === '' || value === 0 || value === '0') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return `${value}px`;
  if (typeof value === 'string') {
    const m = /^\s*(\d+(?:\.\d+)?)(px)?\s*$/.exec(value);
    if (m) return `${m[1]}px`;
  }
  const key = String(value);
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(
      `[fjs] <defer placeholder-height="${key}">: expected a px length ` +
        "(a number, '120' or '120px'); the placeholder gets no height.",
    );
  }
  return null;
}

/** Builds the <defer> component for one host. `onSettled` must be that
 * host's onPageSettled: called from setup, fires at most once, always
 * asynchronously. */
export function createDefer(onSettled: (cb: () => void) => void, placeholderTag: string) {
  return defineComponent({
    name: 'FjsDefer',
    props: {
      /** Height of the box shown until the content mounts, so the page does
       * not jump when it arrives. Default: none (zero height). */
      placeholderHeight: {
        type: [Number, String] as PropType<number | string>,
        default: undefined,
      },
    },
    setup(props, { slots }) {
      const ready = ref(false);
      let alive = true;
      // the page usually outlives us, so its settle callback can arrive
      // after a v-if already removed this <defer>
      onBeforeUnmount(() => {
        alive = false;
      });
      onSettled(() => {
        if (alive) ready.value = true;
      });
      return () => {
        if (ready.value) return slots.default?.();
        const height = deferPlaceholderHeight(props.placeholderHeight);
        return h(placeholderTag, height ? { style: { height } } : null);
      };
    },
  });
}
