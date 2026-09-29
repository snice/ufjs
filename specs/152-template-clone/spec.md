# Spec: 原生模板克隆（Vapor 路径）

- **ID**: 152-template-clone
- **状态**: done
- **日期**: 2026-09-29

## 1. 要解决什么

Vue Vapor 挂载靠「解析一次 HTML 模板、每个实例 `cloneNode(true)`」。fjs 的 Vapor DOM 外壳
（`vapor/dom.ts` `instantiate`）把每次克隆逐节点翻译成 `nodeOps.createElement` → `setAttribute`（scope / class）
→ `appendChild` → `nodeOps.insert`：一个 N 节点的模板实例化要付 N 份元素层 + 渲染器登记 + 样式输入的逐元素成本。
flat-4050 Vapor 挂载 49.4 ms（离线 PrimJS，specs/151 之后），其中这部分占大头。

specs/151 的 spike：把 flat-4050 的格子（`view.cell > text.tiny`）改成「一个 op 克隆一棵子树、C++ 展开」，
这 2000 棵子树 19.8 → 5.5 ms（带现有记账 7.3 ms），样式逐项一致。

## 2. 不做什么（Non-goals）

- VDOM 路径不做（需要编译期标出静态子树，另议）。
- 不改 Dart：克隆在 libfjs-style 里展开成现有的 Create / Insert / SetText / SetProps op，Dart 看到的帧不变。
- 不改 Vapor 编译产物、不改 CSS 语义。
- TS 样式引擎路径（无 natives、`__fjsNativeStyle = false`）不克隆，照旧逐节点。

## 3. 用户可见的行为

页面代码零改动。可观察的只有耗时：

```text
# examples/bench（fjsrun，Mac，PrimJS）
pnpm run vapor     flat-4050 Vapor 挂载 49.4 → ≤ 36 ms
```

## 4. 两端约定（宪法 I）

不涉及：Flutter 路径上 JS → libfjs-style 的实现细节。web 的 Vapor 跑真 DOM。

## 5. 契约变更（宪法 II）

- [x] 样式输入词流（Dart 不可见）：新增 `TEMPLATE`（定义）/ `CLONE`（实例化），`fjs_style.h` + `ops.ts` 同步
- [ ] natives 表
- [ ] 事件类型

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`、`fjs-style-test` / `fjs-test`（两 flavor）、`flutter test` 通过。
2. Vapor 对拍：flat-4050 Vapor 在 TS 模式与 native（克隆）模式下每元素样式 hash 一致；verify 模式下 demo
   `vant/vapor` 页与 flat-4050 Vapor 0 不一致。
3. 克隆节点的卸载：flat-4050 Vapor 挂载 / 卸载 8 轮后 libfjs-style 的 `elements` 回到基线（不泄漏）。
4. `examples/bench` 达到 §3；VDOM 数字与 `demo` `bench:mount` 不回退。
5. 模拟器冒烟：demo `vant: Vapor 页` 与 hello-fjs 4050 的 Vapor 显示正常。

## 7. 待澄清

无（用户已确认：另开 spec，按 specs/151 §8 的建议从 Vapor 入手）。

## 8. 结果（2026-09-29）

离线 fjsrun（PrimJS，Mac），中位数 ms：

| | 改前（specs/151） | 改后 |
|---|---:|---:|
| 同一个格子模板实例化 2000 次（`native/clone-floor.ts`） | 24.6（逐节点） | 10.6（克隆） |
| flat-4050 Vapor 挂载（`native:on`） | 49.4 | 35.6–36.2 |
| flat-4050 Vapor 挂载首帧字节 | 120 KB | 49 KB（展开在 C++ 里生成） |
| flat-4050 VDOM 挂载 | 38.5 | 37.5–37.9（不走克隆，持平） |

- 路径：Vapor 外壳第一次 `cloneNode` 时把模板转成克隆计划（只带 class / 一个 scope 的元素、静态文字、`<!>`
  锚点；其余整棵模板回落逐节点），在 libfjs-style 注册一次（`W_TEMPLATE`）；之后每个实例一条 `W_CLONE`，C++ 在
  输出帧开头写 Create / SetProps / SetText / Insert 并直接登记样式，JS 只建 host（`adoptElement`）、外壳节点与
  渲染器记账。
- 过程中量出的额外两刀（逐节点路径同样受益）：外壳 `Element` 构造函数从 17 个字段减到 8 个（其余用到才建），
  `new Element` 1.0 → 0.67 µs；克隆用的 host / 外壳数组复用，不再每次分配。附着状态按帧缓存（`frameEpoch`），
  不再每次克隆问一次 native。
- 对拍：flat-4050 Vapor 在 TS / native / verify 三种模式 hash 一致（`d4f26919`），verify 连 VDOM 共 132121 次比较
  0 不一致；demo 16 页（含 `vant/vapor`）、bench:mount（含 / 不含快照）、hello-fjs 66 页 0 不一致。
- 卸载：多轮挂载 / 卸载后 libfjs-style 的元素数回到 3（两个应用根的骨架），与 TS 模式一致。
- bench:mount（VDOM）：同一 fjsrun 交替各跑三次，vant-form 24.1 → 24.5（约 +1%），其余页在噪声内。
- 模拟器冒烟（iPhone 17）：hello-fjs 4050 Vapor 显示 JS 74.9 ms（specs/150 时同机 108 ms），改 2000 格文字正确更新；
  demo `vant: Vapor 页` 外观、按钮计数、stepper 与禁用态正常，日志无错误。
- 未做：VDOM 路径的克隆（需编译期标出静态子树）；带其他属性 / style 的模板仍逐节点。
