# Spec: TS 样式引擎出包 + 移除构建期样式快照

- **ID**: 172-native-style-only
- **状态**: done
- **日期**: 2026-10-01

## 1. 要解决什么

1. **TS 逐元素样式引擎白占包体积。** specs/150 之后，宿主只要有
   `__fjs.fns.styleAttach`（所有 libfjs 构建都链了 libfjs-style）就走 native：
   元素状态、签名、匹配/计算缓存、脏标记、flush 全在 C++ 里。但 `css/style.ts`
   的 `StyleEngine` 仍把整套 TS 逐元素实现（`states`、`markDirty`、`locate`、
   `matchRules`、`recompute`、verify 对拍……）一起打进每个 Flutter 包，只在
   `nativeOnly` 分支里跳过。vapor-app release 的 shared.js 里 `css/style.ts`
   是最大的单个模块（41.9 KB）。
2. **构建期样式快照（specs/119）不再划算。** native 引擎上线后首开 CSS 已很快，
   快照却让每次 `fjs build` 多跑一遍 Node 挂载、vant 页每页多 50–75 KB JSON，
   还把「Node 里跑 TS 引擎抓缓存」这条依赖钉死在 TS 引擎上——它是第 1 条出包的
   最大障碍。用户决定整个拿掉。

## 2. 不做什么（Non-goals）

- 不动 CSS 语义：选择器解析（parser.ts）、`buildMatch` / `computeResult`
  （层叠、var()、em、keyframes、伪元素）仍在 TS，libfjs-style 照旧回调它们。
- 不改 native 侧（`native/style`、`natives.cpp`、预编译产物）。SEED_CHAIN /
  SEED_COMPUTE 两个 op 与 `fjs_style_subject.seeded` 留在 C 里不再被调用；
  删它们要重出全平台预编译库，另立 spec。
- 不改 web / 小程序：它们不用 `StyleEngine`。
- 不做「TS 引擎运行时按需下载/分包」。

## 3. 用户可见的行为

- `fjs build` / `fjs run`（Flutter 目标，任何模式）产物里不再有 TS 逐元素引擎；
  样式结果与现在完全一致（现在默认就走 native）。
- 构建日志不再有 `style prewarm: …` 一行，页面 chunk 首行不再有快照 JSON。
- `package.json` 里残留的 `fjs.styleSnapshot` 被忽略（不报错，打印一次弃用告警）。
- 需要 TS 引擎的场景（压测对拍 `__fjsNativeStyle = false / 'verify'`、
  手解帧的 check harness）在构建时加 `--ts-style`：

  ```bash
  fjs build native/entry-verify.ts --ts-style --out dist/native-verify
  ```

  不加 `--ts-style` 却在运行时设了 `__fjsNativeStyle`，启动时 `console.error`
  一次说明要用 `--ts-style` 重建，然后照常走 native。
- 宿主没有 `styleAttach`（极旧的 flutter_fjs）时，native-only 包启动即报错
  `[fjs] this host has no native style engine (libfjs-style); rebuild with --ts-style or upgrade flutter_fjs`，
  不静默渲染出无样式页面。
- vitest 等不经 CLI 的环境（未定义开关）行为不变：TS 引擎在，宿主有 styleAttach 才挂 native。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 样式由 libfjs-style 计算，TS 只保留 CSS 语义回调 | 不涉及（浏览器 CSS） |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无新增 | 无 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——seed op 的 JS 写入端删除，协议本身不改
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及（编译期新增 define `__FJS_TS_STYLE__`，属 CLI ↔ runtime 内部约定）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过（快照相关测试随功能删除）。
2. `grep -rn "styleSnapshot\|exportSnapshot\|importSnapshot\|__fjsCaptureStyles\|__fjsStyleSnapshots" packages/fjs/src packages/fjs-runtime/src`
   无结果。
3. `pnpm --filter vapor-app` release `--pages` 构建：shared.js 比 214.9 KB 小，
   `--analyze` 里不再有 TS 逐元素引擎（`markDirty` / `locate` 等标识符不在产物里）；
   demo VDOM release 同样变小。
4. `examples/vapor-app` `pnpm run check`（带 `--ts-style`）通过；
   `examples/bench` `native:verify`（带 `--ts-style`）0 mismatch。
5. demo 的 vapor-check / nav-vapor 用 fjsrun 跑通（native-only 包）。
6. iOS 模拟器跑 vapor-app：首页、about、controls 三页样式正常，返回可用。

## 7. 待澄清

无（用户已确定：快照整个删除；TS 引擎出包）。dev 构建也走 native-only——
fjs-go / 模拟器宿主都带 libfjs-style，保留 TS 引擎只会让 dev 与 release 行为分叉。
