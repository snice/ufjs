import '../raf';

export {
  createApp,
  flutterRoot,
  render,
  patchProp,
  registerStyles,
  // document-level pointer downs (click-away), see renderer.ts
  onGlobalPointerDown,
  // the live engine instance: `styleEngine.stats` is how a page answers
  // "why is this restyle expensive"
  styleEngine,
} from './renderer';
export { useCssVars } from './css-vars';
// a detached paragraph's size, for DOM shims that measure text the way a
// browser's hidden <div> does (demo's vant dom-env, specs/128)
export { measureTextBlock } from '../ui/geometry';
export type { Element } from '../ui/element';
export type { GlobalPointerDown } from './renderer';
