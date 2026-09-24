# Plan: 注册新作用域的样式表不再清空样式缓存

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 纯性能；web 走浏览器 CSS |
| II 边界即契约 | 否 | — |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 走快路径的条件逐条写成代码 + 注释；任一不满足退回整体失效（宁慢不错） |
| VI 注释记录权衡 | 是 | 快路径为什么成立、为什么不做按作用域精确失效 |
| VII JS 能包就不要下 Dart | 否 | 只改 JS |
| VIII 变更落到文档 | 是 | `docs/vant-mount-perf.md`（实测 + 分包/dev 差异的解释）、`docs/performance.md`（一句） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime · CSS | `packages/fjs-runtime/src/css/style.ts` | `seenScopes`（`addScope` 与 `importSnapshot` 写入）；`register()` 末尾判定快路径：跳过 epoch++ / 清缓存 / 标脏 |
| 测试 | `packages/fjs-runtime/test/css-scoped-register.test.ts`（新） | 见 spec §6.1 |
| 文档 | `docs/vant-mount-perf.md`、`docs/performance.md` | |

## 3. 方案

`register(scope, css, hash)` 照常解析、入桶、更新开关；在 `matchEpoch++` 之前判定，
全部满足才直接返回：

1. `scope !== null`（全局表可能命中任何元素）；
2. 这个作用域**从未出现过**：没有元素 `addScope` 过它，也不在任何导入过的快照链签名里
   （`seenScopes`，只增不减——保守）；
3. 表里没有 `:root` 规则（改 `rootCustom`，影响所有计算样式）、没有 `@keyframes`
   （按名全局登记，任何元素的 `animation` 都可能引用）；
4. 注册前后 `hasMedia / hasStructural / hasSiblingRules / hasPseudo` 都没变（它们决定签名
   格式与匹配结果的形状，变了则所有缓存键都不再可比）。

成立理由：scoped 规则命中要求元素自身（`:deep` 时自身或祖先）带该作用域；链签名包含
自身与祖先的作用域，所以没有任何缓存条目、任何存活元素的答案会因这张表改变。规则的
`order` 单调递增，将来带该作用域的元素匹配时它自然参与级联。

**否掉的备选**：
- *按作用域精确失效*（作用域已用过时只清相关条目、只标带它的子树）：只有 dev 热更新
  重复注册走得到；`:deep` 让「相关」要沿祖先判断，实现与验证成本不值。
- *分包时把所有页面的 scoped 表提前注册进 prelude*：打破按页加载的体积收益，且解析
  所有页面的 CSS 挪到启动。

## 4. 风险

- 快路径条件漏项 → 旧答案残留且不报错。单测对每个「必须整体失效」的情形各写一条；
  对拍用逐节点解析后的样式。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
# 离线复现：临时入口，先挂 vant-basic/vant-more，注册新作用域表，再挂 vant-form
```
