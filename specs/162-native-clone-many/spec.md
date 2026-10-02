# Spec: 静态形状列表的批量克隆 op（W_CLONE_MANY，libfjs-style 批量执行）

- **ID**: 162-native-clone-many
- **状态**: ready
- **日期**: 2026-09-30

## 1. 要解决什么

specs/161 的 `repeatTemplate` / `repeatTemplateLive` 把静态形状 v-for 的挂载压到了
「每格一次批量克隆 + 一次写文本/一次 effect」，但帧协议侧仍是**每格独立 op**：2000 格 =
2000 个 `W_CLONE` 字 op + 2000 个 Insert 字节 op + （静态）2000 个 SetText 字节 op。实测
（flat-4050 离线，原生样式）：挂载 JS 12.4 ms（静态）/ 30.3 ms（Live），其中 op 编码与
宿主 insert 循环约 4 ms；真机上编码与 Dart 逐 op 派发按 ~5x 放大。

libfjs-style 的 `W_CLONE` 展开发生在 C++（`style.cpp clone()`，specs/152），Dart 只见普通
op——批量化的正确位置就在这一层：**一个 op 让 C++ 循环展开 N 份并顺带做 root 插入与首写
文本**，JS 侧从「每格 3 次 op」变成「整表 1 次 op」。

边界（与 2026-09-30 的评估一致）：只下「runtime 已知形状的批量执行」，不下整个 runtime；
响应式、表达式求值、事件留在 JS。

## 2. 方案

新增样式字 op（样式引擎子协议，0x40+ 段，Dart 不可见、零改动）：

```
9 CLONE_MANY templateId, firstId, count, parent, anchor, textNode,
             nTexts, text[len+words] * nTexts
```

- `firstId`：首份首节点 id，第 i 份首节点 = `firstId + i * nNodes`（模板节点数引擎已知）。
- `parent` / `anchor`：root 插入目标；`anchor = 0` 表示 append，否则插在该节点之前
  （引擎在展开时取 anchor 当前 index，逐份递增）。
- `textNode`：模板内文本节点的 index（`0xffffffff` = 无）；存在时压制模板该节点的静态
  SetText，改用数组里的字符串（第 i 份写第 i 条）。`nTexts` 必须等于 `count`。

改动面：

| 文件 | 改什么 |
|---|---|
| `native/style/include/fjs_style.h` | op 枚举 + 线格式注释 |
| `native/style/src/style.cpp` | `clone()` 重构出 `clone_at()`；CLONE_MANY 解码 + 循环展开 + root 插入 + 文本覆盖 |
| `native/style/test/style_test.cpp` | 新 op 的展开顺序 / 插入位置 / 文本覆盖用例 |
| `fjs-runtime/src/ui/ops.ts` | `styleCloneMany()` 编码 |
| `fjs-runtime/src/css/native-style.ts` + `css/style.ts` | 透传 |
| `fjs-runtime/src/vue/renderer.ts` | `cloneListMany()`：一次 allocIds + 一个 op + 既有逐节点记账（含 parentOf/childrenOf 的 root 补记，镜像 `insert()` 的行为） |
| `fjs-runtime/src/vapor/runtime.ts` | `VaporBackend.cloneList` 可选缝；`repeatTemplate`（带 texts）/ `repeatTemplateLive`（texts=null）优先走它 |
| `fjs-runtime/src/vapor/backend-flutter.ts` | plan 可用 → `cloneListMany`；否则返回 null（走旧路径） |
| `fjs-runtime/src/vapor/web.ts` | DOM 等价实现（cloneNode 循环 + insertBefore + 文本） |

约束遵循：

- **op 协议双向同步**（AGENTS #1）：本 op 的两端是 `ops.ts`（编码）与 `fjs_style.h/style.cpp`
  （解码）；`ui_ops.dart` 不变——字 op 在 libfjs-style 内消费，永不到 Dart（文件头注释即此约定）。
- **两端同源**（AGENTS #4）：`cloneList` 是 backend 缝上的可选方法，web 有等价实现；TS 引擎
  模式（无原生样式，plan 为 null）自动走旧路径，行为零变化。

## 3. 验收标准

1. `cmake --build build-native` + fjs-style 自测（含新 op 用例）全绿；`fjs-test` 通过。
2. `pnpm test` 全绿（vitest 覆盖：op 字布局、web 等价实现、回退路径 parity）。
3. bench（`fjsrun --frames`，flat-4050，N=2000）出前后对比：静态挂载（12.4 ms 基线）与
   Live 挂载（30.3 ms 基线）的 JS 降幅记入 `docs/performance.md`；更新路径数字不变
   （0.0 / 1.7 / 16.8 ms）。
4. hello-fjs 真机复测（需重出 apple 预编译产物，AGENTS #8）：挂载与网格内容parity 不回退。

## 4. 不做什么

- 不动逐节点 JS 记账的形态（adoptElement/track/映射表照旧）——若实测它仍是单项大头，
  另评估「批量格子的轻量记账」，不在本 spec。
- 不动响应式、不动 per-cell effect、不动 `styleClone`（单份克隆保留，模板克隆另有调用方）。
- 不改 Dart、不改字节码工具链（fjsc）。
