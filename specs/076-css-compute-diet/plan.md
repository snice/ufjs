# Plan: CSS 计算段分配瘦身 + 链缓存跨卸载保留

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不涉及 | 引擎内部实现优化，样式结果逐位不变；web 走浏览器原生 CSS |
| II 边界即契约 | 不涉及 | 三张表零改动 |
| III 同步单线程零序列化 | 不涉及 | 全部是同步路径上的对象共享/遍历改造，无新异步 |
| IV 外观照 WeUI | 不涉及 | 不改任何样式数值 |
| V 静默失效是 bug | **涉及（核心风险）** | custom 共享的前提是"没人原地改这张表"——已核查 `s.custom` 的全部消费点（resolveVars / attachKeyframes / 子级继承拷贝）均只读，代码里以注释钉住这个前提；LRU 的逐出必须保守（重被引用的键跳过），专项测试覆盖 |
| VI 注释记录权衡 | 涉及 | 共享/写拷贝的分界、LRU 上限的量级依据（~0.5 MB）、保留与 register() 失效的交互，都在代码里留"为什么" |
| VII JS 能包就不要下 Dart | 不涉及 | 纯 JS 层 |
| VIII 变更落到文档 | 涉及 | `docs/vant-mount-perf.md` 落 A/B 数字；`docs/performance.md` 热点清单更新 |

无破例。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/css/style.ts` | ① compute miss 的 custom 表共享（单来源直接引用，多来源才拷贝）；② `resolveVars` 预扫描快路径；③ `matchRules` 折叠的 `Object.entries` → `for-in`；④ 链缓存卸载保留（retired 队列 + 上限逐出） |
| JS runtime（测试） | `packages/fjs-runtime/test/css-compute-diet.test.ts` | spec 第 6 节第 3 条用例 |
| 文档 | `docs/vant-mount-perf.md`、`docs/performance.md` | A/B 数字与热点状态 |

CLI/构建、web 适配层、C++、Dart：零改动。

## 3. 方案

### ① custom 表共享（主收益）

现状：compute miss 无条件 `for (const k in parentCustom) copy`，vant token 表
494 键 → 286 miss ≈ 14 万次拷贝。改为**按来源数分派**：

- 0 来源（无父表、无 matched.custom、无内联 `--x`）→ `undefined`（现状如此）；
- 恰 1 来源（父表 / `matched.custom` / `inlineCustom` 三者之一）→ **直接引用
  该对象**，不拷贝；
- ≥2 来源 → 新建对象逐层覆盖（copy-on-write）。

安全性：`s.custom` 的全部下游（`resolveVars` 的查表、`attachKeyframes` 的帧
解析、子级 compute 的继承源）都是只读；引擎没有任何原地写 custom 表的路径
（已 grep 核查，Web 侧无此引擎）。共享后同一张表被多个元素引用，`customId`
照旧每 miss 发号（id 只做身份比较，不因共享而出错）。

### ② resolveVars 快路径

现状：先 `Object.entries`（key 数组 + entry 元组）+ 逐键拷贝进新 `out`，
扫完才发现"没有 var()"然后扔掉 `out`。改为**先空手扫一遍找 `var(`**，
找不到原对象直接返回（零分配）；找到了才走现有构建路径。

### ③ 折叠去 Object.entries

`matchRules` 的 plain/active/hover/pseudo 四处折叠循环改 `for-in`，
去掉每次 cache miss 的 key 数组与元组分配。语义等价（键序无关，
折叠后按 spec+order 排序）。

### ④ 链缓存跨卸载保留（075 方向②）

`releaseChain()` 引用归零时不再立刻删 `chainIds`/`matchCache`，改为
"retire"：键进 `retiredChains` 队列（配 `retiredSet` 去重，防止反复
开关页把同一键塞多次），上限 **512** 条（估算 ~0.5 MB 上限，注释里给量级）。
超限时从队首修剪：**重被引用的键（`chainRefs` 又有值）跳过**，真正死了的
才连 `chainIds` 带缓存一起删。`register()` / `setViewport()` 的整体失效
照旧清 `matchCache`，同时重置 retired 队列（保留的条目已随之失效，留着
只会让修剪做无用功）。

效果：重开同一页 → 相同链签名直接命中保留的 MatchResult，CSS 近零；
缓存上限封顶，内存有界。

### 被否掉的备选

- **`Object.create(parentCustom)` 原型链代替拷贝**：查表变 O(深度)，
  深树 + var() 密集时反而慢，且 `for-in` 语义会沿链枚举（现状多处
  `for (const k in custom)` 的调用点要全部审一遍），否。
- **customId 用 WeakMap 去重**：id 只做身份比较，共享后多发号不出错，
  收益量不出来，不做。
- **合并继承 spread 为手写循环**：merge 段实测 <1 ms，不值得动。

## 4. 风险

- **共享表被写穿**（最坏情形：一个元素的自定义属性悄悄污染所有共享者）：
  防线 = 消费点只读核查（已做）+ 专项测试断言"子带 `--x` 时父表不变"、
  "共享元素各自 var() 解析结果正确"。`css.test.ts` 的 var() 既有用例
  原样全过是第二道网。
- **LRU 让陈旧缓存复活**：`register()`/`setViewport()` 的 matchEpoch++
  + `matchCache.clear()` 语义不变，retired 队列同步重置；修剪时跳过
  活键，不会删掉正在用的条目。
- **leak probe 误报**：基线取自首轮之后、同键复用 → 尺寸恒定，断言
  原样通过（已核对测试源码）；若仍意外失败，按宪法 V 显式说明并修
  断言口径，不静默放宽。

## 5. 验证路径

```bash
# 1. 单测 + 类型
pnpm test && pnpm run typecheck

# 2. bench 同机 A/B（stash 对照）
cd examples/bench && pnpm run build
../../packages/flutter_fjs/native/build-native/fjsrun --pump 8000 dist/app/bundle.js

# 3. 模拟器 A/B：保留 076 打点 → reload 后首开 vant-form ×3 取 min，
#    back 再开 ×3 量重开命中；数字对照 075 时的同打点基线
```
