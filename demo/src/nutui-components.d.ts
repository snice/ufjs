// NutUI declares GlobalComponents for just a handful of components; the
// ones src/plugins/nutui.ts registers are declared here — keep the list in
// sync with its app.use() calls. The per-component entry modules are typed
// in ./nutui-modules.d.ts.
export {};

declare module 'vue' {
  export interface GlobalComponents {
    NutButton: typeof import('@nutui/nutui')['Button'];
    NutCell: typeof import('@nutui/nutui')['Cell'];
    NutCellGroup: typeof import('@nutui/nutui')['CellGroup'];
    NutDivider: typeof import('@nutui/nutui')['Divider'];
    NutTag: typeof import('@nutui/nutui')['Tag'];
  }
}
