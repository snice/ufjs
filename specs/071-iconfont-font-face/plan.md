# Plan: iconfont 支持——`@font-face` 自定义字体在 App 端加载渲染

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Web 端 `@font-face` / `font` / `font-family` 全由浏览器原生处理（vite 与 `web: true` 的 bundler 路径都保持真 CSS，不做任何改写）；本 spec 只补 Flutter 一侧：构建（`packages/fjs/src/bundler/`）+ JS 引擎（`fjs-runtime/src/css/`、`vue/renderer.ts`）+ Dart（`flutter_fjs/lib/src/`）。差异（首帧先空、远程源/unicode-range 不支持）登记 `docs/css-compat.md` |
| II 边界即契约 | 否（三张表不动） | 新宿主方法名 `fjs.font.load(family, dataUrl)` 走既有 `invokeHost` 通道（`engine.dart` 的 `host.register`，同 `fjs.viewport.get`）；方法名登记 `docs/ui-api.md`。spec §5 的签名收窄为两参：`loadFontFromList` 只认 family，字重/字形由字体文件自身元数据区分，多传的参数没有去处 |
| III 同步单线程零序列化 | 是 | `invokeHost` 同步返回（fire-and-forget），Dart 侧 base64 解码 + `loadFontFromList` 以 `unawaited` 异步进行，不阻塞 JS；无新桥 |
| IV 外观照 WeUI | 否 | 字体来自页面 CSS |
| V 静默失效是 bug | 是 | ①无可用 src（只有远程/未转码格式）→ JS `warnOnce` 指名 family；②Dart 解码/加载失败 → 引擎 log 指名 family；③构建期转码失败 → 构建告警指名文件与 family，原 src 保留（App 端随后走 ①）；④`unicode-range` / `local()` → warnOnce；⑤`@font-face` 以外的 at-rule 维持告警 |
| VI 注释记录权衡 | 是 | 为什么构建期转码（运行时零成本、Flutter 只保证 TTF/OTF）；为什么 `font` 简写在解析期展开（层叠顺序）且 `var()` 延后拆分；为什么内联成 data URL 而不是拷进 assets（见 §3 备选） |
| VII JS 能包就不要下 Dart | 是 | 解析 `@font-face`、展开 `font` 简写、PUA 放行判断全在 JS；Dart 只做 JS 做不了的两件事：把字节注册进 Flutter 字体表（`dart:ui loadFontFromList`）、把 `font-family` 栈映射成 `TextStyle.fontFamily/fontFamilyFallback` |
| VIII 变更落到文档 | 是 | `docs/css-compat.md`（`@font-face` 新行、`font` 简写新行、`font-family` 行、伪元素行删 iconfont 限制、at-rule 行）、`docs/ui-api.md`（宿主方法 `fjs.font.load`）、`docs/toolchain.md`（构建期字体转码说明） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/bundler/font-face.ts`（新） | `inlineFontFaces(css, fromDir)`：扫描 `@font-face` 的 `src`，把 `data:` 的 WOFF/WOFF2、相对路径的 woff/woff2/ttf/otf 文件统一转成 `url(data:font/ttf;base64,…) format("truetype")`；WOFF1 自己解（zlib，格式简单），WOFF2 用 `wawoff2.decompress`；远程 `http(s)` 原样保留 |
| CLI / 构建 | `packages/fjs/src/bundler/vue-plugin.ts` | 非 web 路径两处调用 `inlineFontFaces`：`.css` onLoad、SFC `<style>` 的 registerStyles 分支 |
| CLI / 构建 | `packages/fjs/package.json` | 新依赖 `wawoff2` |
| JS runtime | `packages/fjs-runtime/src/css/parser.ts` | `@font-face` 块收集进可选的 `fontFaces` 输出（无收集者时维持旧告警）；`parseDeclarations` 解析期展开 `font` 简写；`normalizeValue` 认延后拆分标记 |
| JS runtime | `packages/fjs-runtime/src/css/font-face.ts`（新） | `font` 简写解析器；`@font-face` 注册表（已声明 family 集合、去重、选 src、`invokeHost('fjs.font.load')`） |
| JS runtime | `packages/fjs-runtime/src/css/style.ts` | `register()` 把收集到的 `@font-face` 交给注册表；`resolveVars` 丢弃拆分后为空的键 |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | `pseudoContent` 的 PUA 置空只在该伪元素的字体栈**没有**命中已声明 family 时生效 |
| Web 适配层 | — | 不动（浏览器原生） |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/font_loader.dart`（新） | `fjs.font.load` 处理器：解析 data URL → base64 解码 → `ui.loadFontFromList(bytes, fontFamily:)`；按 family+长度+哈希去重；失败打日志 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | 注册上面的模块（紧挨 `_setupViewportModule`） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/style.dart` | `fontFamily` 解析字体栈（去引号、逗号分隔，首项 + monospace 映射）；新增 `fontFamilyFallback` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/text.dart`、`button.dart`、`input.dart` | `TextStyle` 带上 `fontFamilyFallback` |
| 测试 | `packages/fjs/test/font-face.test.ts`、`packages/fjs-runtime/test/font-face.test.ts`、`packages/flutter_fjs/test/font_loader_test.dart` | 见 §5 |
| 测试夹具 | `packages/fjs/test/fixtures/vant-icon.woff2`、`packages/flutter_fjs/test/fixtures/vant-icon.ttf` | 取自 vant（MIT）内联字体，用于转码与排版断言 |
| 文档 | `docs/css-compat.md`、`docs/ui-api.md`、`docs/toolchain.md` | 见 §1 VIII |

## 3. 方案

### 3.1 构建期：所有 `@font-face` 源统一成 TTF data URL

`inlineFontFaces` 用正则找 `@font-face { … }` 块，在块内定位 `src:`
声明，按顶层逗号拆出各 `url(…) [format(…)]` 项逐个处理：

| 源 | 处理 |
|---|---|
| `data:font/woff2` / `format("woff2")` | base64 解码 → `wawoff2.decompress` → TTF data URL |
| `data:font/woff` / `format("woff")` | 自带 WOFF1 解码（表目录 + zlib inflate 重建 sfnt） |
| `data:` TTF/OTF | 原样 |
| 相对路径 `.woff2/.woff/.ttf/.otf` | 相对 CSS 文件读入 → 同上 → 内联 |
| `http(s)://`、`//` | 原样保留（运行时跳过并在无其他源时告警） |

转码结果以 `format("truetype")`（OTF 为 `"opentype"`）标注。同一字节内容
按哈希缓存，dev 模式重复构建不重复解码。只作用于非 web 路径。

**备选（否）**：

- *相对路径字体拷进 assets、src 改写为资源路径*（spec 原写法）：bundler
  目前对 CSS `url()` 没有任何资源管线，要为字体新建「拷贝 + dev server 路由
  + Dart 资源解析」三处；而 iconfont 通常几十 KB，内联更简单、dev 与 release
  行为一致。代价是大字体（CJK 正文字体数 MB）会撑大 JS 包——构建期对
  超过 1 MB 的字体打印体积告警，拷贝方案留作后续（写进 css-compat）。
  spec §6 验收 2 的「拷进 assets」相应改为「内联为 TTF data URL」。
- *运行时 Dart 解 WOFF2*：Brotli + glyf 变换重建，复杂度与包体积都高（spec
  已拍板构建期）。

### 3.2 运行时 JS：`@font-face` 注册

- `parser.ts`：`parseStylesheet(css, scope, order, fontFaces?)`。遇到
  `@font-face` 且调用方传了收集数组 → `parseDeclarations(block)`（`url(…)`
  里的 `;` 在括号内，`splitTopLevel` 已安全）得到 `fontFamily` 与 `src`
  原始串，推入数组；没传则维持旧的 at-rule 告警（别的调用方行为不变）。
- `font-face.ts`：`registerFontFace({family, src})`
  - family 去引号，加入 `declaredFamilies`；
  - 拆 `src` 列表，取第一个 `data:` 且 MIME/format 为 TTF/OTF 的项；
    `unicode-range`、`local()` warnOnce；没有可用项 → warnOnce 指名 family；
  - 有原生宿主时 `invokeHost('fjs.font.load', family, dataUrl)`，按
    family+src 长度+前后缀去重（dev 热更新重复注册同一样式表）。
- `style.ts` `register()`：传入收集数组，逐个 `registerFontFace`。

### 3.3 运行时 JS：`font` 简写展开

CSS 语法 `[style] [variant] [weight] [stretch] size[/line-height] family`。
在 `parseDeclarations` 里**解析期**展开成 `fontStyle`、`fontWeight`、
`fontSize`、`lineHeight`、`fontFamily`，按出现位置写入——同一条规则里后写的
`font-size: inherit` 自然覆盖（vant `.van-icon` 正是这样），跨规则的层叠
也照常进行。省略的子属性按 CSS 重置为 `normal`（`fontStyle`/`fontWeight`/
`lineHeight`）。

值里有 `var()` 时（vant：`var(--van-icon-font-family, "vant-icon")`）解析期
无法拆：五个子属性各写成「延后拆分」字符串 ` font:<part> <原值>`，
`resolveVars` 替换完变量后调 `normalizeValue`，后者识别前缀、解析整条简写并
取出对应部分；取不出（比如没写 line-height 就是 `normal`）按上面重置值。
系统字体关键字（`caption`、`icon`、`menu`…）warnOnce 跳过。

**备选（否）**：合并层叠后再展开——会让简写覆盖同规则/后续规则里的
longhand，层叠顺序错。

### 3.4 运行时 JS：PUA 放行

`syncPseudoBoxes` 把伪元素样式的 `fontFamily` 传给 `pseudoContent`；只有
字体栈里**没有**任何一个 family 在 `declaredFamilies` 中时才把纯 PUA 文本
置空（维持旧降级）。

### 3.4b 实施中补充：伪元素文字节点的样式（设备实测发现）

设备上图标位置已对、但画成 `?` 方框：`syncPseudoBoxes` 给盒子设了样式，
盒子里的文字节点却**从未设样式**（不经样式引擎，Dart 的 text 只读自身
样式）→ 默认字体、默认 14px #333。以前 PUA 被置空、伪元素内容多为空串，
一直没暴露。修复：文字节点带上伪元素样式里的可继承文字属性（与引擎的
INHERITABLE 同一张表）；盒子复用时同步更新文字内容与样式（vant Rate /
Checkbox 切换 class 会换 `content`，旧代码只更新盒子样式，字形不变）。

### 3.5 Dart：加载与字体栈

- `font_loader.dart`：`registerFontModule(host, log)` 注册 `fjs.font.load`；
  解析 `data:[mime][;charset=…];base64,<payload>` → `base64Decode` →
  `unawaited(ui.loadFontFromList(bytes, fontFamily: family))`。引擎在加载后
  自动广播 `fontsChange`，`RenderParagraph` 监听系统字体变化重新排版——
  不需要额外的重建通知。去重键 family + 字节长度 + 前 64 字节哈希。失败
  （base64 非法、字体数据损坏抛错）→ log 指名 family。
- `style.dart`：`fontFamily` 解析 CSS 字体栈：按顶层逗号拆、去引号/空白；
  首项作主族（`monospace` 走现有平台映射）；`fontFamilyFallback` 返回其余
  项（同样映射 monospace，丢掉 `sans-serif` 等 Flutter 不认识的通用族名——
  它们本来也解析不到，写进 fallback 只会徒增查找）。
- `text.dart` / `button.dart` / `input.dart` 的 `TextStyle` 加
  `fontFamilyFallback: style.fontFamilyFallback`。

## 4. 风险

- **`loadFontFromList` 对 wawoff2 输出的兼容性**：wawoff2 是 Google woff2
  参考实现的 wasm 版，输出标准 sfnt；设备上以 vant 图标实际出图为准（验收 3）。
- **`font` 简写展开是全局行为变化**：此前 App 忽略 `font:`，现在字号/行高/
  字重生效。vant 之外的页面若依赖旧的忽略行为会变样——这是对齐 web，
  重对拍 vant 五页 + hello-fjs 首页确认无回归。
- **字体栈解析影响所有文字**：`-apple-system-font, helvetica neue, …` 这类
  栈过去整串当 family 名（解析不到 → 系统字体），现在取首项
  `-apple-system-font`（同样解析不到 → 系统字体），结果不变；需确认
  Flutter 对未知主族不报错（fallback 到默认）。
- **JS 包体积**：vant-icon TTF 内联后 shared.js 增加约 80KB（base64）；构建
  打印字体体积，>1MB 告警。
- **加载时序**：字体异步加载完成前首帧图标为空（或回退字体的方块？——
  PUA 在回退字体里通常无字形，iOS 可能画出 `?` 方框）。若设备上出现方框
  闪烁，改为在 JS 侧等 Dart 回报再放行 PUA（需要加载完成事件，届时回 spec）。

## 5. 验证路径

```bash
# 单测
pnpm --dir packages/fjs exec vitest run test/font-face.test.ts
pnpm --dir packages/fjs-runtime exec vitest run test/font-face.test.ts
cd packages/flutter_fjs && flutter test test/font_loader_test.dart

# 全量
pnpm run typecheck && pnpm test
cd packages/flutter_fjs && flutter test

# 构建 CLI 后在模拟器上对拍（dev server 随 fjs run 重启）
pnpm --dir packages/fjs run build
cd demo && fjs run ios --device <sim>
# web: http://localhost:5175 → vant-nav / vant-basic / vant-form 对照截图
```
