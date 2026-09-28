# Plan: 原生模板克隆（Vapor 路径）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| II 边界即契约 | 是 | TEMPLATE / CLONE 进 `fjs_style.h` 词流定义，`ops.ts` 同步；Dart 协议不变 |
| III 同步单线程 | 是 | 展开在 uiOps 内同步完成 |
| V 静默失效是 bug | 是 | 不可克隆的模板整体回落逐节点路径；TS / native / verify 三方对拍 |
| VIII 变更落到文档 | 是 | architecture.md（数据流）、performance.md |

## 2. 数据流

```
Vapor template(html) ─ innerHTML ─► 模板节点树（JS，只解析一次）
                                        │ 第一次 cloneNode：判定可克隆 → 编码成 TEMPLATE（词流）
cloneNode(true) ──► allocIds(n) → CLONE(tid, firstId)（词流，2 词）
                  → 按模板结构建外壳节点 + host Element（makeElement）+ 渲染器记账
libfjs-style（uiOps 内，词流先消费）：
   CLONE → 输出帧开头追加 Create ×n / SetProps（常量 props）/ SetText（静态文字）/ Insert（子节点，根不插）
         → 样式树：登记元素（tag / defaults / scope / classes / raw）+ 挂接子节点
根节点之后照常由 insertBefore → nodeOps.insert 插进父节点（字节流 Insert）
```

克隆展开写在输出帧**开头**：展开只引用新 id，而之后引用它们的 op（根的 Insert、动态文字 SetText）都在字节流里，
先于它们即可。

## 3. 涉及的层

| 层 | 文件 | 改什么 |
|---|---|---|
| C++ | `style/src/style.cpp`、`fjs_style.h`、`test/style_test.cpp` | 词流 `W_TEMPLATE` / `W_CLONE`；模板表；展开到输出（Create / SetProps / SetText / Insert）+ 样式登记 + 树挂接 |
| JS op | `ui/ops.ts` | `styleTemplate(...)` / `styleClone(tid, firstId)` 词流写入 |
| JS 元素层 | `ui/element.ts` | `allocIds(n)`、`adoptElement(id, tag)`（不写 Create op 的 makeElement） |
| JS 渲染器 | `vue/renderer.ts` | `cloneTemplate(plan)`：分配 id、写 CLONE、建 host、记账（elementsById / parentOf / childrenOf / htmlDefaults / payloadEvents）；verify 模式下对 TS 引擎补登记 |
| JS 样式 | `css/native-style.ts` | 模板里的 tag / scope / class 原子；`commit()` 在 CLONE 前 |
| Vapor 外壳 | `vapor/dom.ts` | `instantiate`：模板可克隆 → 走 `cloneTemplate`，按结构建外壳；否则原路 |
| bench | `examples/bench/native/` | Vapor 对拍（TS / native hash）、卸载不泄漏检查 |

## 4. 可克隆判定（模板节点逐个）

- Element：attrs 只含 `class` 与空值 `data-v-*`；tag 不是文本控件（input / textarea）、不是 canvas；
- 静态文字：作为元素唯一子节点的 inline 文字（SetText），或独立 Text 节点（raw text 元素）；
- `<!>` 锚点：anchor view（常量 props）；
- 其余（style / 其他属性 / 事件属性）→ 整个模板回落逐节点路径。

## 5. 风险

- 卸载：克隆节点也进 elementsById / childrenOf，`nodeOps.remove` → `dropElement` → `forgetSubtree` 照常 FORGET。
- verify 模式：TS 引擎看不到 C++ 展开的元素 → 克隆后对每个节点补 `styleEngine.ensure / addScope / setClasses`
  与插入通知（双登记对 native 无害：首次登记为准）。
- 失败帧：libfjs-style 失败后只剔除，克隆展开丢失 → 渲染器检查 `attached`，断开后回落逐节点。
