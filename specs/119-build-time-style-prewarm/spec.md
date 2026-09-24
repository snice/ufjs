# Spec: 构建期样式预热（冷态 CSS）

- **ID**: 119-build-time-style-prewarm
- **状态**: ready
- **日期**: 2026-09-24

## 1. 要解决什么

specs/118 之后，一个页面**第一次打开**比**再次打开**多出的时间几乎全在 CSS 引擎：
缓存是空的，每个新元素签名都要走一遍规则匹配和样式计算。离线基准
（`pnpm --filter demo run bench:mount`，Linux 容器，约为模拟器 2 倍慢）拆账，
vant-form：

| | 冷 | 热 | 差 |
|---|---:|---:|---:|
| 规则匹配（match miss） | 12 ms | 0 | 12 |
| 样式计算（compute miss，不含匹配） | 40 | 15 | 25 |
| 计算之外（比较、编码） | 28 | 14 | 14 |
| CSS 合计 | 80 | 29 | 51 |

这些缓存的内容在构建期就能确定：同一套样式表、同一棵页面树，匹配和计算结果是
纯函数。现在每台设备、每次冷启动都在运行时重新算一遍。

在 118 的 `<defer>` 之下，这笔账分两段落地：navMount 里的首屏（vant-form 冷
CSS 21 ms）和转场后补挂的那一帧（冷 CSS 56 ms）。

## 2. 不做什么（Non-goals）

- 不做运行时落盘（第一次打开后写本地文件）——宿主 I/O，另议。
- 不预热「计算之外」那 14 ms（DefineStyle 编码、比较）：那是逐元素的写帧工作，
  不是缓存能省的。
- 不改 CSS 匹配 / 级联语义。预热只是提前填缓存；**结果必须与不预热逐字节相同**。
- 不覆盖 `fjs dev`：dev 每次改动都重建，抓取要把每个页面挂一遍，拖慢热更新。
  dev 下行为与现在相同（冷算）。
- 不覆盖动态路由（`/user/:id`）：构建期不知道参数。它们照常冷算。
- web / 小程序不涉及：两端用的是真 CSS，没有这个引擎。

## 3. 用户可见的行为

**页面代码零改动。** `fjs build`（含 `--pages` / `--release` / `--bytecode`）
和 `fjs run` 多一步：

```
built dist/app/bundle.js (812ms)
  style prewarm: 11 pages captured (vant-form 342 chains / 356 styles, 38 KB) …
```

- 构建期在 Node 里把 app bundle 跑起来，逐个静态路由挂载（与真机同样的 Shell、
  同样的 `<defer>` 补挂），把样式引擎的匹配 / 计算缓存导出成每页一份 JSON 快照，
  追加到该页的 chunk（分包）或 bundle（单包）末尾。
- 运行时路由挂载页面之前导入该页快照：之后的挂载就是「热」的。
- 快照是**可选的加速**：校验不过（样式表集合不同、`@media` 结果不同、引擎开关
  不同）就整份放弃，照常冷算，并在 debug 下打一行说明（宪法 V）。
- 某个页面挂载失败（页面在 setup 里就要网络 / 宿主能力）只跳过该页并告警，
  不让构建失败。
- 关闭：`package.json` 的 `"fjs": { "styleSnapshot": false }`。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 构建期抓快照、运行时导入，结果与冷算相同 | 不涉及（浏览器 CSS） |
| 事件载荷 | 无 | 无 |
| 已知差异 | 无——这是纯性能行为，渲染结果不变 | |

小程序：不涉及。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及

内部约定（非跨语言契约，但要两处同步）：`registerStyles(scope, css, hash)` 多一个
构建期算好的样式表哈希（`fjs/src/bundler/vue-plugin.ts` 生成 ↔
`fjs-runtime/src/vue/renderer.ts` 接收）；快照格式带版本号 `v`。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增单测：
   - 在引擎 A 里挂载、导出快照，导入全新引擎 B 后同一棵树挂载：**match / compute
     全命中**，每个元素的计算样式与 A 逐一相同；
   - 校验：多一个全局样式表 / 少一个参与匹配的表 / `@media` 结果不同 / 版本号不同
     → 拒绝导入，照常冷算且结果正确；
   - 导入后 `register()` 新表 → 缓存照常失效，不残留快照结果。
2. `pnpm --filter demo run build:pages` 输出每页快照的统计行；页面 chunk 末尾带快照。
3. **对拍**：`bench:mount`（加预热）的 op 流与不预热逐字节相同。
4. 离线基准（容器）vant-form **首开**（冷）：navMount 同步段的 CSS 与补挂段的
   CSS 各自降到不预热时的 ≤ 50%；match miss 冷态 ≈ 0。导入本身的耗时单列报出。
5. `build:pages` 的构建时间增量单列报出（demo，11 个页面）。
6. 模拟器复核交用户（容器无 Flutter）。

## 7. 待澄清

- [x] 方案：构建期预热（用户 2026-09-24 指定），直接走完。
- [x] dev 不开、动态路由不覆盖、关闭开关 `fjs.styleSnapshot: false`——按上文
      默认执行，如需调整再改。
