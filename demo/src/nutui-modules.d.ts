// NutUI ships types only for its barrel (dist/types), not for the
// per-component entries src/plugins/nutui.ts imports. Deliberately a script
// file (no top-level import/export): inside a module these would be
// augmentations, which cannot type an untyped .mjs.
declare module '@nutui/nutui/dist/packages/button/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/button/index';
}
declare module '@nutui/nutui/dist/packages/cell/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/cell/index';
}
declare module '@nutui/nutui/dist/packages/cellgroup/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/cellgroup/index';
}
declare module '@nutui/nutui/dist/packages/divider/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/divider/index';
}
declare module '@nutui/nutui/dist/packages/tag/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/tag/index';
}
