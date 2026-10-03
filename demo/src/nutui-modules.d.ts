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
// specs/203 batch 2. Components whose type dir lacks an index.d.ts (only
// index.vue.d.ts) are typed through the `…/index.vue` module instead.
declare module '@nutui/nutui/dist/packages/input/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/input/index';
}
declare module '@nutui/nutui/dist/packages/textarea/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/textarea/index';
}
declare module '@nutui/nutui/dist/packages/switch/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/switch/index';
}
declare module '@nutui/nutui/dist/packages/checkbox/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/checkbox/index.vue';
}
declare module '@nutui/nutui/dist/packages/checkboxgroup/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/checkboxgroup/index.vue';
}
declare module '@nutui/nutui/dist/packages/radio/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/radio/index';
}
declare module '@nutui/nutui/dist/packages/radiogroup/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/radiogroup/index';
}
declare module '@nutui/nutui/dist/packages/rate/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/rate/index';
}
declare module '@nutui/nutui/dist/packages/inputnumber/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/inputnumber/index';
}
declare module '@nutui/nutui/dist/packages/searchbar/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/searchbar/index.vue';
}
declare module '@nutui/nutui/dist/packages/badge/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/badge/index';
}
declare module '@nutui/nutui/dist/packages/progress/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/progress/index';
}
declare module '@nutui/nutui/dist/packages/circleprogress/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/circleprogress/index';
}
declare module '@nutui/nutui/dist/packages/skeleton/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/skeleton/index';
}
declare module '@nutui/nutui/dist/packages/empty/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/empty/index';
}
declare module '@nutui/nutui/dist/packages/noticebar/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/noticebar/index.vue';
}
declare module '@nutui/nutui/dist/packages/image/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/image/index';
}
declare module '@nutui/nutui/dist/packages/countdown/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/countdown/index';
}
declare module '@nutui/nutui/dist/packages/grid/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/grid/index';
}
declare module '@nutui/nutui/dist/packages/griditem/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/griditem/index';
}
declare module '@nutui/nutui/dist/packages/tabs/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/tabs/index.vue';
}
declare module '@nutui/nutui/dist/packages/tabpane/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/tabpane/index.vue';
}
declare module '@nutui/nutui/dist/packages/steps/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/steps/index';
}
declare module '@nutui/nutui/dist/packages/step/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/step/index';
}
declare module '@nutui/nutui/dist/packages/pagination/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/pagination/index.vue';
}
declare module '@nutui/nutui/dist/packages/swiper/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/swiper/index.vue';
}
declare module '@nutui/nutui/dist/packages/swiperitem/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/swiperitem/index.vue';
}
declare module '@nutui/nutui/dist/packages/popup/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/popup/index.vue';
}
declare module '@nutui/nutui/dist/packages/overlay/index.mjs' {
  export { default } from '@nutui/nutui/dist/types/__VUE/overlay/index';
}
declare module '@nutui/nutui/dist/packages/dialog/index.mjs' {
  export { default, showDialog } from '@nutui/nutui/dist/types/__VUE/dialog/index';
}
declare module '@nutui/nutui/dist/packages/toast/index.mjs' {
  export { default, showToast } from '@nutui/nutui/dist/types/__VUE/toast/index';
}
