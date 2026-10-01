# Plan: 172-native-style-only

## 1. 拆分线

native 模式下 libfjs-style 仍回调 TS 的 `buildMatch` / `computeResult`，
`register` 解析样式表、`setViewport` 判 `@media`、inline 记录也都在 TS。
所以按「CSS 语义 vs 逐元素状态」切 `StyleEngine`：

| 文件 | 内容 | 谁用 |
|---|---|---|
| `css/style-core.ts`（新） | `StyleCore` 基类：规则表 / 桶、`registerSheet`（失效动作走钩子）、视口、`:root` 变量、keyframes、defaults id、`buildMatch`、`computeResult`、inline 记录 API（`setInlineStyle` / `patchInlineStyle` / `mutateInline` / `setInlineCustomProps` / `inlineRecord`，记录与失效走抽象钩子）；纯函数工具（`resolveVars`、`resolveEm`…）与公共类型 | 两个引擎 |
| `css/style.ts` | `StyleEngine extends StyleCore`：TS 逐元素实现 + attachNative / verify（行为不变）；re-export `style-core` 的公共导出，现有 `from '../css/style'` 的测试不用改 | vitest、`--ts-style` 构建 |
| `css/style-native.ts`（新） | `NativeStyleEngine extends StyleCore`：构造即 attach libfjs-style，逐元素入口全部委托 `NativeStyleBackend`；宿主无 `styleAttach` 抛错 | Flutter 构建（默认） |

`NativeStyleHost.engine` 的类型从 `StyleEngine` 换成 `StyleCore`。

## 2. 编译期开关

- runtime：`globals.d.ts` 声明 `__FJS_TS_STYLE__`。`vue/host-ops.ts`：
  `typeof __FJS_TS_STYLE__ === 'undefined' || __FJS_TS_STYLE__` 时 `new StyleEngine`
  + 现有 `__fjsNativeStyle` 逻辑；否则 `new NativeStyleEngine`，并在运行时发现
  `__fjsNativeStyle` 被设置时 `console.error` 一次。`nativeStyle` 常量在后者恒 true。
- CLI：`bundler/build.ts` 照 `setDevtoolsBundling` 加 `setTsStyleBundling`，
  `fjsDefines()` 输出 `__FJS_TS_STYLE__`（Flutter 默认 `false`；web 构建 `true`，
  web 不碰 host-ops，保持现状最安全）；`--ts-style` 标志进 `parseBuildArgs`。
- 验证 esbuild 摇掉 `StyleEngine`：release 产物里搜 `markDirty` / `subtreeEpoch`。

## 3. 删除快照

| 层 | 改动 |
|---|---|
| CLI | 删 `bundler/style-snapshot.ts` 与测试；`build.ts` 两处 `if (opts.styleSnapshot)`、`prewarmStyles`、`BuildOptions.styleSnapshot`、`readConfig().styleSnapshot`；`run.ts` 传参；`project/config.ts` 字段改为弃用（读到时告警一次）；`vue-plugin.ts` 的 `styleSheetHash` 及生成代码里的第三个参数 |
| runtime | `StyleEngine` 的 `exportSnapshot` / `importSnapshot*` / `snapshotMismatch` / `snapshotEpoch` / `sheetLog` / `inputSheets` / `trackSheets` / `MatchResult.sheets` / `CssRule.sheet` / `STYLE_SNAPSHOT_VERSION` / `StyleSnapshot`；`native-style.ts` 的 `seedChain` / `seedCompute` 与 `compute` 的 `seeded` 分支（参数保留，非 0 时报错）；`ui/ops.ts` writer 的 `styleSeed*` 编码（op 常量保留注释说明 native 仍识别）；`router/flutter.ts` 的 `captureStyles`、`importPageStyleSnapshot`、类型；`app/flutter.ts` / `flutter-vapor.ts` 的 `__fjsCaptureStyles` 钩子；`registerStyles` 的 `hash` 参数 |
| 示例 | `demo` / `examples/vapor-app` 的 `fjs.styleSnapshot`；`demo/bench/mount-core.ts` 快照段；需要 TS 引擎的 harness 脚本加 `--ts-style` |
| 测试 | 删 `style-snapshot*.test.ts`；`css-inline-memo` / `css-scoped-register` / `router-preload` 去掉快照用例 |
| 文档 | `toolchain.md` 删「构建期样式预热」节、加 `--ts-style`；`architecture.md` / `performance.md` / `css-compat.md` 的 `__fjsNativeStyle` 说明补 `--ts-style`；`roadmap.md` 标注移除 |

native C++（SEED op、`seeded` 字段）不动，见 spec 非目标。

## 4. 顺序

1. 删快照（runtime → CLI → 示例/测试），`pnpm test` 绿。
2. 拆 `style-core.ts`，`StyleEngine` 继承它，`pnpm test` 绿（纯重构）。
3. `NativeStyleEngine` + host-ops 选择 + CLI define/标志。
4. 构建对比体积；fjsrun 跑 check / bench verify / demo vapor；iOS 模拟器。
5. 文档。
