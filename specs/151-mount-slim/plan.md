# Plan: 挂载路径瘦身

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| II 边界即契约 | 是 | `EL` 扩展同时改 `fjs_style.h`、`style.cpp`、`ops.ts`；Dart 不可见 |
| V 静默失效是 bug | 是 | 每项改完跑 verify 对拍（native 与 TS 逐元素比较） |
| VI 注释记录权衡 | 是 | — |
| VIII 变更落到文档 | 是 | performance.md 的 specs/150 段补记 |

## 2. 阶段 A：瘦身（每项做完量一次 floor，没收益就回滚）

| # | 文件 | 改什么 |
|---|---|---|
| A1 | `vue/renderer.ts` | createElement：按 tag 缓存一份描述（要创建的 tag、emits、块级、文本控件、HTML 默认值、样式用 tag），每元素一次查表；不再预写 `parentOf.set(id, null)`（读者都把缺省当 null——逐个核对） |
| A2 | `vue/renderer.ts` | insert 快路径：新元素（无父）、追加（无 anchor）、父无 ::before 盒、未提升、无模态遮罩时，跳过 trackDetach / 提升 / indexOf / 遮罩同步 |
| A3 | `css/native-style.ts`、`ui/ops.ts`、`style.cpp`、`fjs_style.h` | 样式输入合并：后端留一个「待写元素」槽（最近一次 ensure 的元素），紧随其后的 addScope / setClasses 折进槽里；写别的元素、别的样式 op、或帧发出前（preFlush）把槽写成一个 `EL`（带 scope / classes）。Vue 的顺序是 createElement → setScopeId → patchProp(class) → …子元素…，槽正好接住 |
| A4 | `vue/renderer.ts` | 渲染器到后端的调用：native 下 setScopeId / class 直接调后端（若 A3 后仍有可测差异） |

## 3. 阶段 B：原生模板克隆 spike（门控）

- 目标：量出「一个 op 换一整棵静态子树」能省多少，决定是否另开 spec。
- 做法：fjsrun 上用 flat-4050 的格子（`view.cell > text.tiny`）做模板：JS 注册一次模板（结构 + tag + class + scope），
  实例化时发 `Clone(templateId, firstId)`，libfjs 在 C++ 里展开成 Create / Insert / 样式输入（Dart 看到的帧不变），
  JS 侧只分配 id 与最少的元素对象。先写 floor 级实验，再看 Vapor 路径怎么接。
- 结果与判断写 spec §8。

## 4. 风险

- A3 槽没写出去就发帧：由 preFlush 与每个写 op 的入口兜住；verify 对拍覆盖。
- A1 去掉 `parentOf.set(null)`：`parentOf.has` 的读者会变；实现前 grep 核对。
