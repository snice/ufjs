# Tasks: demo 第二批扩展 NutUI 与 Vant 组件页

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 注册层

- [x] T010 `demo/src/plugins/nutui.ts` + `nutui-components.d.ts`：新增
      Input / Textarea / Switch / Checkbox / CheckboxGroup / Radio /
      RadioGroup / Rate / InputNumber / SearchBar / Badge / Progress /
      CircleProgress / Skeleton / Empty / Noticebar / Image / Grid /
      GridItem / Tabs / TabPane / Steps / Step / Pagination / Swiper /
      SwiperItem / Popup / Overlay / Toast / Dialog
- [x] T011 `demo/src/plugins/vant.ts`：新增 Calendar / DatePicker / TimePicker /
      TreeSelect / Cascader / DropdownMenu / DropdownItem / List /
      PullRefresh / ImagePreview / Uploader（import + style + use）

## NutUI 页面

- [x] T020 `demo/src/pages/nutui/form.vue`（新）：Input / Textarea /
      Switch / Checkbox(Group) / Radio(Group) / Rate / InputNumber / SearchBar
- [x] T021 `demo/src/pages/nutui/display.vue`（新）：Badge / Progress /
      CircleProgress / Skeleton / Empty / Noticebar / Image / CountDown
- [x] T022 `demo/src/pages/nutui/nav.vue`（新）：Grid(GridItem) /
      Tabs(TabPane) / Steps(Step) / Pagination / Swiper(SwiperItem)
- [x] T023 `demo/src/pages/nutui/float.vue`（新）：Popup / Overlay /
      Toast（命令式）/ Dialog（命令式）
- [x] T024 `demo/src/pages/nutui/vapor.vue`（新）：`<script setup vapor>`，
      Button / Cell / Switch / Rate / InputNumber + Popup 探针

## Vant 页面

- [x] T030 `demo/src/pages/vant/pickers.vue`（新）：Calendar /
      DatetimePicker / TreeSelect / Cascader / Uploader
- [x] T031 `demo/src/pages/vant/scroll.vue`（新）：List / PullRefresh /
      DropdownMenu(DropdownItem) / ImagePreview（命令式）
- [x] T032 `demo/src/pages/vant/vapor.vue`：追加 Tabs / Popup /
      Checkbox / Rate 区块（不改既有区块）

## 验证

- [x] T040 `pnpm --filter demo run typecheck` 通过
- [x] T041 `pnpm test` 通过
- [x] T042 `pnpm --filter demo run build:release` 成功
- [x] T043 web（`fjs dev:web`）：9 个页面逐页打开，控制台无未捕获异常
- [x] T044 App（`fjs run ios`）：9 个页面逐页打开，交互/v-model 状态可见；
      差异逐条记入 spec §8

## 文档

- [x] T050 差异登记改判：无 CSS 引擎级新差异；组件级缺口记入 spec §8，
      两条工程坑（插件排序、Vapor 组件名）记入 `docs/toolchain.md`
- [x] T051 spec §8 过程发现补全；状态改 done
