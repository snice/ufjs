# Tasks: iconfont 支持——`@font-face` 自定义字体在 App 端加载渲染

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 登记宿主方法 `fjs.font.load(family, dataUrl)`（fire-and-forget，
      不回派事件）：Dart 注册点 `packages/flutter_fjs/lib/src/engine.dart`
      + 新文件 `packages/flutter_fjs/lib/src/font_loader.dart`；JS 调用点
      `packages/fjs-runtime/src/css/font-face.ts`。三张契约表不动

## 实现

- [x] T010 构建期转码：新建 `packages/fjs/src/bundler/font-face.ts`
      （`inlineFontFaces`：WOFF2 经 `wawoff2`、WOFF1 自解、相对路径读入，
      统一内联为 TTF data URL；>1MB 告警；失败保留原 src 并告警），
      `packages/fjs/package.json` 加 `wawoff2`
- [x] T011 `packages/fjs/src/bundler/vue-plugin.ts`：非 web 路径的 `.css`
      onLoad 与 SFC `<style>` 两处接入 `inlineFontFaces`
- [x] T012 `packages/fjs-runtime/src/css/font-face.ts`：`font` 简写解析器 +
      `@font-face` 注册表（`declaredFamilies`、去重、选 TTF/OTF data 源、
      unicode-range/local()/无可用源告警、`invokeHost`）
- [x] T013 `packages/fjs-runtime/src/css/parser.ts`：`@font-face` 收集进可选
      输出数组；`parseDeclarations` 解析期展开 `font` 简写（含 `var()` 的
      延后拆分标记）；`normalizeValue` 识别标记
- [x] T014 `packages/fjs-runtime/src/css/style.ts`：`register()` 交给注册表；
      `resolveVars` 丢弃拆分后为空的键
- [x] T015 `packages/fjs-runtime/src/vue/renderer.ts`：PUA 置空仅在伪元素
      字体栈未命中已声明 family 时生效
- [x] T016 `packages/flutter_fjs/lib/src/font_loader.dart`：data URL 解码 →
      `ui.loadFontFromList`，去重、失败日志；`engine.dart` 注册
- [x] T017 `packages/flutter_fjs/lib/src/render/style.dart`：`fontFamily`
      解析字体栈，新增 `fontFamilyFallback`；`widgets/text.dart`、
      `widgets/button.dart`、`widgets/input.dart` 的 TextStyle 带上 fallback

- [x] T018（实施中补充，见 plan §3.4b）`packages/fjs-runtime/src/vue/renderer.ts`：
      伪元素文字节点带可继承文字样式；复用盒子时同步更新文字内容/样式；
      `css/style.ts` 导出 INHERITABLE；回归测试进 `vue_overlay_pseudo.test.ts`

## 两端对齐

- [x] T020 Web 侧：确认 vite 与 `web: true` bundler 路径不经过
      `inlineFontFaces`、字体栈/简写由浏览器原生处理（无代码改动，写进
      notes）
- [x] T021 iOS 模拟器 ↔ web 对拍：vant-nav（NavBar 返回箭头、Tabbar 图标）、
      vant-basic（Cell 右箭头、Grid 图标）、vant-form（Checkbox 对勾、Rate
      星星）；回归 vant 五页与 hello-fjs 首页字体无异常

## 测试

- [x] T030 `packages/fjs/test/font-face.test.ts`：woff2 data URL → TTF
      （sfnt 头 0x00010000）；WOFF1 解码；相对路径内联；http 源原样；非字体
      at-rule 不受影响（夹具 `test/fixtures/vant-icon.woff2`）
- [x] T031 `packages/fjs-runtime/test/font-face.test.ts`：`@font-face` 收集与
      `invokeHost` 调用、告警分支；`font` 简写展开（纯值 / `var()` 回退 /
      同规则后续 longhand 覆盖）；PUA 放行与降级
- [x] T032 `packages/flutter_fjs/test/font_loader_test.dart`：字体栈解析；
      `fjs.font.load` 加载 TTF 夹具后 PUA 字形宽度等于字体 advance（与未加载
      时不同）；坏数据打日志不抛（夹具 `test/fixtures/vant-icon.ttf`）

## 文档

- [x] T040 `docs/css-compat.md`：`@font-face` 新行、`font` 简写新行（行为变化）、
      `font-family` 行（字体栈）、伪元素行删 iconfont 限制、at-rule 行
- [x] T041 `docs/ui-api.md` 登记宿主方法 `fjs.font.load`；`docs/toolchain.md`
      说明构建期字体转码与体积告警
- [x] T042 `docs/roadmap.md` 有对应条目则打勾

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test` + `cd packages/flutter_fjs && flutter test`
- [x] T052 spec.md 第 6 节逐条核对；notes.md 记录
