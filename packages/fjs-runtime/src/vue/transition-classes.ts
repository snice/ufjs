// Classes a running <Transition> put on an element (the `-enter-*` /
// `-leave-*` set). vue's runtime-dom records the same list (`_vtc`): a class
// patch from the renderer replaces the whole list, and without this record
// it would silently drop the classes a live transition depends on. The
// WeakMap lives in its own module so the renderer's class patch can read it
// without importing the shim back (vue-shim.ts already imports renderer.ts).
const transitionClasses = new WeakMap<object, Set<string>>();

export function trackTransitionClass(el: object, cls: string): void {
  let set = transitionClasses.get(el);
  if (!set) transitionClasses.set(el, (set = new Set()));
  set.add(cls);
}

export function untrackTransitionClass(el: object, cls: string): void {
  const set = transitionClasses.get(el);
  if (!set) return;
  set.delete(cls);
  if (!set.size) transitionClasses.delete(el);
}

/** The transition classes currently on [el], if any. */
export function transitionClassesOf(el: object): string[] {
  const set = transitionClasses.get(el);
  return set ? [...set] : [];
}
