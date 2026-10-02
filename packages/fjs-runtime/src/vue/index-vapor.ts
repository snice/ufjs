// `fjs/vue` in an enableVapor Flutter build (specs/169): the host-primitive
// half of vue/index.ts — registerStyles (what every compiled <style> calls),
// the style engine, page / detached roots, pointer and measurement helpers —
// without the renderer's createApp / render, so importing it never pins
// runtime-core's rendering engine. Code that needs createApp has no VDOM
// renderer to run on in this mode; the missing export fails the build, which
// is the clearer place to learn it.
import '../raf';

export {
  flutterRoot,
  createDetachedRoot,
  releaseDetachedRoot,
  patchProp,
  registerStyles,
  onGlobalPointerDown,
  styleEngine,
} from './host-ops';
export { useCssVars } from './css-vars';
export { measureTextBlock } from '../ui/geometry';
export type { Element } from '../ui/element';
export type { GlobalPointerDown } from './host-ops';
export { childElementIds, elementTag } from './host-ops';
