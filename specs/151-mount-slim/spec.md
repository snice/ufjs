# Spec: 挂载路径瘦身——渲染器登记、样式输入合并、原生模板克隆 spike

- **ID**: 151-mount-slim
- **状态**: done（阶段 A 交付；阶段 B spike 结论见 §8）
- **日期**: 2026-09-28

## 1. 要解决什么

specs/150 把样式 flush 降到 0.6 ms 之后，flat-4050（4051 元素）离线 VDOM 挂载 43 ms（PrimJS，fjsrun），逐层
（`examples/bench/native/floor.ts`，不经过 Vue 的同一棵树，含 uiOps）：

| 层 | 累计 | 本层 | 每元素 |
|---|---:|---:|---:|
| 元素层（create / insert / setText + op 编码） | 9.5 | 9.5 | 2.3 µs |
| + 渲染器 nodeOps（createElement / insert / setElementText 的登记） | 19.2 | **9.7** | 2.4 µs |
| + 样式输入（setScopeId 2.7 + class 4.0） | 26.3 | **7.1** | 1.8 µs |
| + Vue（VDOM diff / 组件） | 43.2 | ~17 | |

渲染器与样式输入合计 ~17 ms，与 Vue 本身相当。其中 `nodeOps.createElement` 比裸 `create` 多 5.8 ms（每元素
5–6 次按 tag 的查表 + 登记），insert 多 ~3.9 ms（每次都走移动 / fixed 提升 / 伪元素盒的判断）。

## 2. 不做什么（Non-goals）

- 不改 Vue、不改 CSS 语义与支持范围、不改 Dart 渲染。
- TS 样式引擎路径（web 之外无 natives 的环境、`__fjsNativeStyle = false`）行为不变，不专门为它优化。
- 模板克隆只做门控 spike（阶段 B），全量落地另开 spec。

## 3. 用户可见的行为

页面代码零改动，渲染结果不变。可观察的只有耗时：

```text
# examples/bench（fjsrun，Mac，PrimJS）
pnpm run native:on    flat-4050 VDOM 挂载 43 → ≤ 37 ms
node floor            renderer 层 9.7 → ≤ 6 ms；样式输入 7.1 → ≤ 4.5 ms
```

## 4. 两端约定（宪法 I）

不涉及：只动 Flutter 路径上 JS 侧的登记与 op 写入。web 走浏览器 DOM。

## 5. 契约变更（宪法 II）

- [x] 样式输入 op：`EL` 可携带 scope 与 class（Dart 不可见，`fjs_style.h` + `ops.ts` 同步）
- [ ] natives 表
- [ ] 事件类型
- 阶段 B spike 若新增模板 op，只在 spike 分支上试，不进本 spec 的交付

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`、`fjs-style-test` / `fjs-test`（两 flavor）、`flutter test` 通过。
2. `examples/bench` `pnpm run native:verify` 0 不一致；`demo` `bench/verify-pages.ts`、`bench/mount-verify.ts`、
   hello-fjs `bench/verify-pages.ts` 0 不一致。
3. `examples/bench` 达到 §3；`demo` `bench:mount` 五页不回退。
4. 阶段 B：模板克隆 spike 在 fjsrun 上给出 flat-4050（VDOM / Vapor）的可省量，写进 §8，决定是否另开 spec。

## 7. 待澄清

无（用户已确认按「先合并样式输入 + 渲染器瘦身，同时做模板克隆门控 spike」推进）。

## 8. 结果（2026-09-29）

离线 fjsrun（PrimJS，Mac），机器空闲时中位数 ms：

| | 改前 | 改后 |
|---|---:|---:|
| floor：renderer 层（renderer − element） | 9.7 | 7.1 |
| floor：样式输入（styled − renderer） | 7.1 | 3.2 |
| floor：styled 合计 | 26.3 | 19.8 |
| flat-4050 VDOM 挂载（`native:on`，页面 / 结构规则） | 43.2 / 43.2 | 38.7 / 38.5 |
| flat-4050 VDOM 挂载（`vapor` bench） | 43.4 | 37.9 |
| flat-4050 Vapor 挂载 | 60.5 | 49.4 |

- A1 按 tag 描述缓存：`nodeOps.createElement` 比裸 create 多的 5.8 → 4.6 ms。
- A2 insert 快路径：−1.1 ms。
- A3 样式输入合并：拆开量才看清——`ensure` 的 0.77 µs 里，光写 14 字节的 EL op 就占 0.52 µs（解释器下每次
  typed-array 字节写 ~37 ns，Map 写反而只有 0.07 µs）。改成 Uint32 词流（随帧 `fjsStyle`，C++
  `fjs_style_process_words` 先于字节流消费——样式输入只改逐元素状态，由帧末 flush 读，与结构 op 的相对顺序无关）
  + 待写元素槽（scope / class 折进同一条 EL）：样式输入 7.1 → 3.2 ms。
- A4（渲染器直调后端）不做：specs/150 试过，差异在噪声内。
- §3 目标：43 → ≤ 37 ms 差一点（38.5）；renderer ≤ 6 未达（7.1）；样式输入 ≤ 4.5 达到。PrimJS 已过 specs/150 的
  ≤ 40 门槛；Vapor 达到 specs/150 的 ≤ 55。
- 对拍：flat-4050 verify 66451 次、demo 16 页 2359 次、bench:mount（含 / 不含快照）各 11160 次、hello-fjs 66 页
  17745 次，0 不一致；bench:mount 五页冷 / 热 / 快照均不回退。
- 预编译产物（Apple / Android / ohos）重新生成。

### 阶段 B：原生模板克隆 spike

临时实现（已还原，未进交付）：模板定义 op（节点的父索引、tag、样式原子、scope、class）+ `CLONE(模板, 首 id, 父,
位置)`，libfjs-style 在 uiOps 里展开成 Create / Insert 字节（Dart 帧不变）并直接登记样式。flat-4050 的 2000 个
格子（`view.cell > text.tiny`）按三种方式建（行与外框照常走渲染器）：

| | ms |
|---|---:|
| 渲染器路径（现状） | 19.8 |
| CLONE + setText（最低成本） | 5.5 |
| CLONE + setText + 渲染器现有记账（两个 Element 对象、elementsById / parentOf / childrenOf） | 7.3 |

克隆出的格子样式与渲染器路径逐项一致。**结论：值得另开 spec**——这一块能再省 ~12 ms（离线，真机约 ×2.5）。
全量要解决的：模板从哪来（Vapor 的 `template()` 天然是静态片段；VDOM 需要编译期标出静态子树）、克隆节点的
记账与卸载（渲染器登记后 FORGET，或由 C++ 的 Remove 带走）、动态绑定的定位（Vapor 的 child / next 游标要能走到
克隆出的节点）、Dart 不感知的前提下 op 协议怎么扩。建议从 Vapor 路径入手。
