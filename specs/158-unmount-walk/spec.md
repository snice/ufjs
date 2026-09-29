# Spec: 卸载时的子树清理瘦身

- **ID**: 158-unmount-walk
- **状态**: done（真机数字随 specs/159 一起量）
- **日期**: 2026-09-29

## 1. 要解决什么

真机 flat-4050 隐藏 JS 44–54 ms。离线（PrimJS）拆开：卸载 8.2 ms 里渲染器删元素就占 6.1 ms（73%），Vue 的遍历
约 2 ms。`dropElement` 对被删子树（4050 个元素）：

- 先整棵走一遍，只为查两张平时为空的表（弹层遮罩、伪元素盒）；
- `forgetSubtree` 再走一遍，每个元素约 20 次 Map 调用（多数表是空的）+ `forgetElementStyle` / `forgetHandlers` /
  `styleEngine.forget` 三次函数调用；原生引擎下每个元素还写一条 FORGET 词——而 libfjs-style 收到 Remove 时
  `remove_deep` 本来就会清掉整棵子树的样式状态。

## 2. 不做什么（Non-goals）

- 不改 Vue 的卸载遍历、不改 op 协议与 Dart。
- 不改单个元素的 `forget`（非子树删除的场景照旧写 FORGET）。

## 3. 用户可见的行为

无行为变化。可观察的是卸载耗时：`examples/bench` flat-4050 VDOM 卸载 8.2 → ≤ 5 ms（离线）。

## 4. 做法

- 遮罩表与伪元素盒表都为空时跳过第一遍遍历。
- `forgetSubtree`：各张少用的表是否为空在遍历前读一次；遍历只收集 id，`forgetElementStyles` /
  `forgetHandlersOf` / `styleEngine.forgetRemoved` 各对整批调一次。
- `forgetRemoved`：原生引擎只清 JS 侧记录、不写 FORGET 词（Remove 的 `remove_deep` 负责 C++ 状态）；TS 引擎逐个
  forget 照旧。

## 5. 契约变更（宪法 II）

无（FORGET 词本就 Dart 不可见；Remove 在 libfjs-style 里的语义不变）。

## 6. 验收标准

1. `pnpm test`、typecheck 通过。
2. 不泄漏：`native:on` / `native:ts` / `native:verify` 全部轮次后 elements 回到 3。
3. verify：flat-4050、demo 16 页、bench:mount、hello-fjs 66 页 0 不一致；交给 Dart 的帧不变。
4. 离线卸载达到 §3。

## 7. 待澄清

无。

## 8. 结果（2026-09-29，离线 fjsrun，PrimJS）

| | 改前 | 改后 |
|---|---:|---:|
| flat-4050 VDOM 卸载（Vue + 渲染器） | 8.0–8.3 | 3.8–3.9 |
| 　其中渲染器删元素 | 6.0–6.2 | 1.95 |
| `native:on` 页面卸载 | 8.1 | 4.0 |

- 三步各自的贡献：跳过空表 + 不写 FORGET 8.2 → 5.8；批量清理（去掉每元素三次函数调用）5.8 → 3.85。
- elements 三种模式都回到 3；verify 132121 / 2359 / 11160 / 17745 次 0 不一致；`native:on` 交给 Dart 的帧
  139 帧 460484 op 5577940 字节与改前相同。
- demo verify 里 about 页的 `store.count` 报错在 main 上同样存在（verify 环境没有 store），与本 spec 无关。

## 9. 追加（2026-09-29，复查发现的两处同类扫描）

复查发现卸载链上还有两处「每元素 × 全局表」的扫描，是 §4 手法的漏网：

- `forgetSubtree` 的 `onceFired` 清理：只要 app 里触发过任意一个 `.once`，隐藏 4050 页就是每元素拼一个
  模板字符串 + 全表 `startsWith`。
- `hoistedUnder`（nodeOps.remove 每次删除都调）：`hoistedFrom` 在真实 app 里几乎从不为空（fixed NavBar、
  Toast 都算），每个子树节点扫一遍全表。

改法同 §4：子树 id 收进一个 Set，全局表各扫一遍，嵌套 hoist（弹层里再弹）用不动点多扫几轮。

bench 加 `native:hostile` / `native:hostile-ts` 变体（`native/hostile.ts` 种 flag，App 里挂一个 hoisted 的
fixed 元素和一个已触发的 `.once`，随 v-if 循环存活）。离线 fjsrun，flat-4050 page unmount（min/med/max ms）：

| | 改前 | 改后 |
|---|---:|---:|
| native plain | 3.8 / 3.9 / 4.0 | 3.9 / 4.0 / 4.0（无回归） |
| native hostile | 10.2 / 10.3 / 10.8 | 6.6 / 6.9 / 7.1 |
| ts hostile | 11.6 / 11.7 / 12.1 | 8.3 / 8.5 / 8.6 |

- parity hash 六次全为 `48142bbd`；plain 泄漏 3、hostile 泄漏 6（+3 个故意存活的 fixture）。
- 剩余的 hostile − plain ≈ 2.9 ms 是两次 `Set(ids)` 构建（hoistedUnder 一次、onceFired 清理一次），
  已从 O(子树×表) 降到 O(子树)；要再压得跨函数共享 Set，收益有限，先不动。
- `NativeStyleBackend.forgetRemoved` 的四表合一次数检查保持不变：拆成四个 size 标志在表全空时（bench 正是
  这种）反而每元素多三次分支。
- 回归测试：`vue_unmount_handlers.test.ts` 加「无关子树卸载不得重新武装已触发的 .once」。
