# Spec: hello-js 压测屏换用 native 样式引擎（修测量仪器）

- **ID**: 187-hello-js-native-style-engine
- **状态**: ready
- **日期**: 2026-10-02

## 1. 要解决什么

specs/150/172 之后，Flutter 构建里运行时自身的样式走 `NativeStyleEngine`
（C++ libfjs-style，逐元素工作全在 native；TS 逐元素引擎靠
`__FJS_TS_STYLE__=false` 的 define 剪枝从 host-ops 里消失）。但 hello-js 的
两块压测屏（theme-bench、flat4050）都是 `new StyleEngine(...)` 直接实例化
**未 attachNative 的 TS 引擎**——真机 profile 实测（specs/186）：

- 样式 flush 25.4–25.9ms / 次挂载，是 TS 逐元素重算的钱，native 引擎上这笔
  趋近 0；
- element 层 76–78ms 里混着 TS 引擎的逐节点登记开销；
- 对照失真：纯 API 屏 show 的 JS 105–107ms，比 hello-fjs 优化后的 VDOM 页
  （88–91ms，含 Vue）还慢——量的是被淘汰的引擎路径。

fjs 主入口只导出 `StyleEngine`，第三方手写 app 拿不到正确的引擎——index.ts
那句 "any other adapter (or a benchmark) constructs its own the same way"
在 native 化之后已经不成立。

## 2. 不做什么（Non-goals）

- 不动 TS 引擎本身（web / vitest / `--ts-style` 的 fallback 照旧）。
- 不动 op 协议、natives 表、事件类型（宪法 II：只加导出，不加 ABI）。
- 不在本 spec 里做模板克隆（`defineCloneTemplate` / `cloneMany` 已存在，
  等 187 修完仪器、拿到干净的 element 层账目再决定，见 specs/186 分析）。
- 不改 docs/performance.md 的历史数字（等复测数字出来再补）。

## 3. 用户可见的行为

hello-js 的屏在 Flutter 上与 Vue 页走同一条样式路径；压测读数里
「样式 flush」一格在 native 引擎下应趋近 0。写法（手写 app 的标准接法）：

```ts
import { NativeStyleEngine, StyleEngine, host, registerPreFlush } from 'fjs';

const engine =
  host?.styleAttach !== undefined && new NativeStyleEngine(applyStyle).attachNative(host)
    ? nativeEngine   // Flutter：逐元素工作在 libfjs-style
    : new StyleEngine(parentOf, childrenOf, applyStyle);   // web / fjsrun / --ts-style
registerPreFlush(() => engine.flushPending());
```

要点：`recomputeSubtree` 照旧调（native 下是 no-op，libfjs-style 自己读
Insert/Remove op）；`flushPending()` 必须挂 pre-flush（native 的 commit
要赶在帧出去之前）。

## 4. 两端约定（宪法 I）

不涉及页面能力变化。TS 引擎继续服务 web / vitest / `--ts-style`；Flutter
构建两块屏与 Vue 页同引擎。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议 / natives 表 / 事件类型
- [x] 都不涉及（仅 fjs 主入口新增三个导出：`NativeStyleEngine`、`host`、
  `registerPreFlush`——`host` 本就是 `globalThis.__fjs.fns` 的同一对象，
  导出只是给它一个有类型的入口）

## 6. 验收标准

1. `pnpm --filter hello-js run build` 通过；`pnpm --filter @ufjs/runtime run test`
   通过（若 runtime 有测试）。
2. 离线 `fjsrun`（无宿主 → TS fallback）跑 `__flat4050.show()`：读数正常、
   不异常，行为与改前一致。
3. 真机 `fjs run ios --profile`：4050 屏样式正常（格子有背景色、文字有样式）；
   show 的「样式 flush」一格 ≈0；JS 段显著低于 105ms。
4. theme-bench 同样走 native 引擎，主题切换正常（亮/暗生效）。

## 7. 待澄清

- 无。
