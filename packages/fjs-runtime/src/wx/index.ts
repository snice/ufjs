// '@ufjs/runtime/wx' — the mini-program target's runtime entry. Compiled
// SFC modules import from here (the build aliases `vue` to the same place).
// Importing this module installs the fetch polyfill as a side effect, so
// `app.js` only needs `require('fjs/shared')` and every page sees fetch.
export * from './vue';
export * from './instance';
export { registerRoutes, useRouter, useRoute, createRouter, setActiveRoute, onPageSettled } from './router';
export type { MpRouteRecord } from './router';
export { adaptEvent } from './events';
export { stringifyClass, stringifyStyle, project, resolveCssColor, onCssVarsChange } from './style';
export { motion, motionEach } from './motion';
export type { MotionHost, MotionInstance, UseMotion } from './motion';
export { installFetchPolyfill, registerPublicData } from './fetch';
// not here: buildWxRichText (rich-text.ts) is bundled on its own as
// fjs/rich-text.js, only when a page uses <rich-text> under skyline (spec 050)
import { installFetchPolyfill } from './fetch';
import { installAnimationFramePolyfill } from './raf';
export { requestAnimationFrame, cancelAnimationFrame, setImmediate, clearImmediate } from './raf';

installFetchPolyfill();
installAnimationFramePolyfill();
