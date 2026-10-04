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
    // specs/203 batch 2 — keep in sync with src/plugins/nutui.ts
    NutInput: typeof import('@nutui/nutui')['Input'];
    NutTextarea: typeof import('@nutui/nutui')['Textarea'];
    NutSwitch: typeof import('@nutui/nutui')['Switch'];
    NutCheckbox: typeof import('@nutui/nutui')['Checkbox'];
    NutCheckboxGroup: typeof import('@nutui/nutui')['CheckboxGroup'];
    NutRadio: typeof import('@nutui/nutui')['Radio'];
    NutRadioGroup: typeof import('@nutui/nutui')['RadioGroup'];
    NutRate: typeof import('@nutui/nutui')['Rate'];
    NutInputNumber: typeof import('@nutui/nutui')['InputNumber'];
    // GlobalComponents keys must match the REGISTERED name exactly: demo
    // pages compile to Vapor (specs/177), and the vapor resolver only tries
    // camelize/capitalize of the template tag — `nut-searchbar` →
    // `NutSearchbar`, not `NutSearchBar`.
    NutSearchbar: typeof import('@nutui/nutui')['Searchbar'];
    NutBadge: typeof import('@nutui/nutui')['Badge'];
    NutProgress: typeof import('@nutui/nutui')['Progress'];
    NutCircleProgress: typeof import('@nutui/nutui')['CircleProgress'];
    NutSkeleton: typeof import('@nutui/nutui')['Skeleton'];
    NutEmpty: typeof import('@nutui/nutui')['Empty'];
    NutNoticebar: typeof import('@nutui/nutui')['Noticebar'];
    NutImage: typeof import('@nutui/nutui')['Image'];
    NutCountdown: typeof import('@nutui/nutui')['Countdown'];
    NutGrid: typeof import('@nutui/nutui')['Grid'];
    NutGridItem: typeof import('@nutui/nutui')['GridItem'];
    NutTabs: typeof import('@nutui/nutui')['Tabs'];
    NutTabPane: typeof import('@nutui/nutui')['TabPane'];
    NutSteps: typeof import('@nutui/nutui')['Steps'];
    NutStep: typeof import('@nutui/nutui')['Step'];
    NutPagination: typeof import('@nutui/nutui')['Pagination'];
    NutSwiper: typeof import('@nutui/nutui')['Swiper'];
    NutSwiperItem: typeof import('@nutui/nutui')['SwiperItem'];
    NutPopup: typeof import('@nutui/nutui')['Popup'];
    NutOverlay: typeof import('@nutui/nutui')['Overlay'];
  }
}
