/// <reference types="@ufjs/runtime/ambient" />
import '@ufjs/runtime/vue-global';

// Augment THIS project's vue copy, not @ufjs/runtime's (specs/164): module
// augmentation never crosses copies, and this app pins an exact 3.5.x while
// the runtime stays on a range.
import type { FjsGlobalComponents } from '@ufjs/runtime/vue-global';

declare module 'vue' {
  interface GlobalComponents extends FjsGlobalComponents {}
}
