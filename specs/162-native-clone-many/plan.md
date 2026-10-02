# Plan: 162-native-clone-many

## 改动层与顺序

1. **协议层（先定线格式）**
   - `packages/fjs-runtime/src/ui/ops.ts`：`styleCloneMany(template, first, count, parent, anchor, textNode, texts?)`，
     字布局与 `fjs_style.h` 注释逐字对齐（字符串按 `u32 len + ceil(len/4)` words，同 W_TEMPLATE）。
   - `packages/flutter_fjs/native/style/include/fjs_style.h`：`FJS_STYLE_W_CLONE_MANY = 9` + 注释。

2. **C++ 消费侧**
   - `native/style/src/style.cpp`：把 `clone(tid, first)` 拆出 `clone_at(tid, first, skipTextNode)`；
     新增 `clone_many()`：校验 → anchor index（扫 parent kids）→ 逐份 `clone_at` + 文本
     SetText + root `Insert`（emitted + `apply_insert`）。`anchor=0` 即 append（0x7fffffff）。
   - `native/style/test/style_test.cpp`：三用例（顺序、anchor 前插、文本覆盖 + 模板静态文本压制）。

3. **TS 运行时**
   - `css/native-style.ts` / `css/style.ts`：`cloneMany` 透传（未 attach 时抛/拒）。
   - `vue/renderer.ts`：抽 `fillCloneHosts(plan, first, hosts)`（现 cloneTemplate 循环体）；
     `cloneListMany(plan, count, parent, anchor, textIdx, texts)` = allocIds(n*count) + 一个 op +
     逐份记账；root 的 parentOf/childrenOf 补记镜像 `insert()`。
   - `vapor/runtime.ts`：`VaporBackend.cloneList?(def, count, parent, anchor, textIdx, texts, html)`；
     `repeatTemplate` 传 texts（静态首写随 op）、`repeatTemplateLive` 传 null；返回 null 或
     缺方法时走现有 instantiateMany + attach 路径。
   - `vapor/backend-flutter.ts`：plan 非空 → `cloneListMany`，否则 null。
   - `vapor/web.ts`：DOM 等价实现。

## 测试顺序

vitest（op 布局 / web 等价 / 回退 parity）→ cmake 重建 + fjs-style 自测 + fjs-test →
bench 前后对比（静态 + Live）→ docs/performance.md → （真机前）`tool/build-apple.sh`。

## 风险

- JS 记账与 C++ 树的 root 插入顺序不一致 → 以 `insert()` 现有映射行为为准，逐字段镜像。
- anchor index 在帧内必须稳定：同一帧内 CLONE_MANY 之前不得有改变 parent children 的 op——
  JS 侧同一挂载帧内只有本 op 动该 parent（模板实例化在前，兄弟挂载在后）。
- 字符串 blob 编码错误 → C++ `need()` 校验失败会拒整帧（样式引擎 detach），用 native 自测兜住。
