/// <reference types="@ufjs/runtime/ambient" />
import '@ufjs/runtime/vue-global';

// Augment THIS project's vue copy, not @ufjs/runtime's: a `declare module
// 'vue'` inside the runtime only reaches the vue instance the runtime
// resolves, which is a different module whenever the app pins another
// version (this project pins 3.6.0-rc.x for the vapor pages while the
// runtime stays on ^3.5). Extending the exported interface keeps the tag
// typing correct regardless of version drift (specs/164).
import type { FjsGlobalComponents } from '@ufjs/runtime/vue-global';

declare module 'vue' {
  interface GlobalComponents extends FjsGlobalComponents {}
}
