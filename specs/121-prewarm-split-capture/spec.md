# Spec: 分包构建的样式快照按分包产物抓取

- **ID**: 121-prewarm-split-capture
- **状态**: done (真机复核待用户)
- **日期**: 2026-09-24

## 1. 要解决什么

用户真机实测（2026-09-24，Android，分包构建）：vant-basic 第一次打开 93 ms，
第二次 39 ms——specs/119 的预热没起作用。logcat：

```
[fjs css] style snapshot skipped: sheets registered in a different order; styles are computed at runtime instead
```

（`warnOnce` 去重，只有第一个被拒的页面打了这行，后面的页面同样被拒但静默。）

原因：分包构建的快照是在一份**临时单包**上抓的。单包里 `main.ts` 先
`import 'fjs/pages'`（所有页面的 scoped 表先注册），后 `import 'fjs/plugins'`
（vant 样式后注册）；真机分包是 shared.js（含 vant 样式）先注册，页面 chunk 打开时
才注册自己的表。两边注册顺序不同，同优先级规则的层叠结果可能不同，校验拒绝是对的——
错在抓取环境与真机不一致。离线基准也是单包，所以 119 验收没发现。

## 2. 不做什么（Non-goals）

- 不放宽快照校验（顺序、全局表、`@media`、开关）：它们守的是正确性。
- 不做运行时落盘。

## 3. 用户可见的行为

页面代码零改动。分包构建（`--pages`、`fjs run --profile/--release`）的快照改为在
**分包产物本身**上抓：每个页面一个全新 VM，按真机顺序执行 shared.js → 入口
bundle.js → 该页 chunk，再挂载该页。真机首开即命中快照。

三种构建的样式表注册顺序统一到 `main.ts` 的 import 顺序（也就是 web 的顺序），页面
自己的表在页面第一次打开时注册（用户 2026-09-24 要求在本 spec 一并处理）：

- 单包 / `fjs dev`：页面模块改为首次打开时才执行（`definePageLoader` + `require()`），
  不再随 `fjs/pages` 在 `fjs/plugins` 之前全部执行；
- 分包 shared.js：先按 `main.ts` 的 import 顺序导入一遍，Shell 不再排到 vant 之后。

demo 实测三处差异：单包「页面表 → Shell → vant」、分包「vant → Shell → 页面表」，
统一后均为「Shell → vant → 页面表」。

快照被拒时的告警带上页面路径，每个页面各打一行（不再被 `warnOnce` 吞掉）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 分包快照在真机被接受 | 不涉及（浏览器 CSS） |
| 已知差异 | 无 | |

小程序：不涉及。

## 5. 契约变更（宪法 II）

- [x] 都不涉及（快照格式不变，版本号不变）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；capture 的单测覆盖「多文件 + 只抓指定路由 +
   chunk 加载钩子」。
2. 离线核对：`demo` 的 `build:pages` 产物里，每页快照按真机顺序（shared → index →
   该页 chunk）注册后 `snapshotMismatch` 为 null。
3. 被拒的告警含页面路径，两个页面被拒打两行。
4. 单包与分包同一页快照里的样式表相对顺序相同；页面表在其依赖的库样式之后。
5. 真机复核交用户：首开 `[nav] mounted` 与再开接近，logcat 无 `style snapshot ... skipped`。

## 7. 待澄清

- 无。
