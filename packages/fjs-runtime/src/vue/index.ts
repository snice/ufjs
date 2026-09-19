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
export type { Element } from '../ui/element';
export type { GlobalPointerDown } from './renderer';
