# 071 实施记录（2026-09-19）

## 两端对齐（T020）

Web 侧无代码改动，确认路径如下：

- demo 的 web 开发走 vite（`demo/vite.config.ts`），CSS 由浏览器直接解析，
  `@font-face` / `font` / 字体栈 / WOFF2 全部原生。
- `packages/fjs` 的 bundler 在 `web: true` 时：`.css` onLoad 不注册（交给
  esbuild 的 css loader），SFC `<style>` 走 `compileStyle` + `injectStyle`，
  两处都不经过 `inlineFontFaces`。回归：`packages/fjs/test/font-face.test.ts`
  「web: the browser gets the original WOFF2」。

## 设备对拍（T021，iOS 模拟器 iPhone 17 Pro ↔ web 375×812）

| 页面 | 图标 | 结果 |
|---|---|---|
| vant-nav | NavBar 返回箭头、Search 放大镜、Tabbar 首页/搜索/设置 | ✅ 与 web 一致 |
| vant-basic | Cell `is-link` 右箭头、Grid 三图标 | ✅ |
| vant-form | Checkbox / Radio 对勾、Rate 实心/空心星 | ✅ |

第一轮设备上图标位置对、但画成 `?` 方框——伪元素的文字节点从未带样式
（plan §3.4b、T018），修复后出图。

## 实施中的偏差

- spec §5 的宿主方法签名收窄为 `fjs.font.load(family, dataUrl)`（plan §1 II）。
- 相对路径字体改为构建期内联为 data URL，而不是拷进 assets（plan §3.1 备选）。
- 新增 T018：伪元素文字节点样式 + 内容同步（plan §3.4b）。
- `font: inherit`（vant 按钮/输入框在用）在首次设备运行时告警，补了 CSS 全局
  关键字 `inherit` / `unset` / `initial` 的展开。

## 范围外发现（未在本 spec 修）

- **vant Checkbox / Radio 点击报 `TypeError: not a function`**：Checker 的
  `onClick` 调 `iconRef.value.contains(event.target)`，fjs 元素没有 DOM 的
  `contains`。与字体无关，建议另立项给元素补 `contains`（renderer 的
  parentOf 链即可实现）。
- **vant Rate 点击无响应**：`useRect` 依赖 `window` / `getBoundingClientRect`
  （同 070 的 D2 一类）。

## 验收（T050–T052，spec §6 逐条）

1. `pnpm run typecheck` 全部 Done；`pnpm test`：fjs 283、fjs-runtime 523、
   fjs-webview 36、fjs-webgl 30 全过；`flutter test` 378 全过（`flutter analyze`
   余 1 条既有告警 `_debugLog`，非本 spec 引入）。
2. 单测：构建 `packages/fjs/test/font-face.test.ts`（7 条）；运行时
   `packages/fjs-runtime/test/font-face.test.ts`（11 条）+
   `vue_overlay_pseudo.test.ts` 两条；Dart `test/font_loader_test.dart`（6 条，
   PUA 字形着墨像素加载前 320 → 加载后 102）。
3. 设备对拍见上表 ✅。
4. 坏字体源：JS 侧 warnOnce 指名 family、Dart 侧 log 指名 family 均由单测覆盖；
   未在设备上故意构造坏 src（按「基本测试过了就停」约定，留待需要时补）。
5. 文档：css-compat（`@font-face`、`font` 简写、`font-family`、伪元素行）、
   ui-api（自定义字体一节、`fjs.font.load`）、toolchain（构建期字体转码）、
   roadmap 打勾。
