# Tasks: 093-devtools-tree-lazy-and-live

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

本 spec 不动三张契约表（UI op / natives / 事件类型）——CDP 方法形状
由中继单侧定义，运行时侧 `cmd()` 按 CDP 方法名寻址（与
`DOM.getDocument` 同模式）。

- [x] T001 `devtools-hooks.ts`：+`devtoolsStructuralVersion` 常量
      （方案 A；`versionCmd` 顺带返回两个版本号或新增
      `Dom.structuralVersion` 分支，plan 定）

## 实现 · 运行时

- [x] T010 `devtools.ts` `cmd()` +`DOM.requestChildNodes {id}` 分支：
      `provider.childIds(id)` 序列化直接子节点返回
- [x] T011 `devtools.ts` `cmd()` +`DOM.getFlattenedInnerHTML {id}`：
      子树转 HTML 字符串（标签/属性/文本转义）
- [x] T012 `devtools.ts` `cmd()` +`DOM.querySelector {id?, selector}`：
      复用 CSS 匹配（跳过 media/scope/`:active`/`:hover`，与
      `matchedRulesOf` 同口径），返回 elementId 或 null
- [x] T013 结构版本递增点：`element.ts` `insert()`/`remove()`、
      `vue/renderer.ts` `flutterRoot()`/`releaseRoot`（页根增删）

## 实现 · 中继

- [x] T020 `cdp-server.ts` `routeBridged`：`DOM.requestChildNodes`
      真实现（`toElem` → 桥 → `mapNode` → `{nodeId, nodes}`），
      不落兜底
- [x] T021 `cdp-server.ts`：`DOM.getFlattenedInnerHTML` 真实现，
      回 `{result, type:'string'}`（形状以真实前端 sdk 对拍为准）
- [x] T022 `cdp-server.ts`：`DOM.querySelector` 真实现，
      `{nodeId}` 或 `{nodeId:0}`；不落兜底
- [x] T023 `cdp-server.ts`：`domInvalidated()` +1s 冷却
      （`lastInvalidateAt`），debug-reload 与死节点自愈也走冷却
- [x] T024 `cdp-server.ts`：`DOM.getDocument` 应答后启动结构版本
      轮询（1–2s，`Dom.structuralVersion` 跨阈值 → `domInvalidated()`），
      WS 断开停止；纯属性变化不触发

## 测试

- [x] T030 `fjs-runtime/test/devtools.test.ts`：三 cmd 分发、HTML
      序列化、selector 命中/未命中/伪态过滤
- [x] T031 `fjs/test/debug-cdp.test.ts`：三方法形状（非空 children /
      含子标签 HTML / nodeId 命中与 0）、不落兜底
- [x] T032 `fjs/test/debug-cdp.test.ts`：结构版本变化 → 一次
      `documentUpdated`、冷却窗口内不重推、纯属性版本变化不触发
- [x] T034 文本/属性编辑：运行时 `Dom.drainContent` 入队且不抬结构版本；
      中继推 `characterDataModified` / `attributeModified`，不推
      `documentUpdated`
- [ ] T033 真实前端终验（无头 Chrome + SDK evaluate）：展开 shell
      ≥3 层、路由 push ≤2s 自动重拉、前端零异常、Styles 不永转
      —— 替代进展（2026-09-22）：`e2e/` 已跑通**协议级真实链路**
      11/11（真中继 + 真 PrimJS VM + 真运行时 bundle，`client.cjs`：
      void 应答 + setChildNodes 事件、静态树零推送、死节点自愈冷却、
      `__addPage` 结构变化 → documentUpdated ≤3.5s、重拉后 2 个页根）。
      真 Chrome UI 的手工终验仍留给本条（用户复测即该条验收）。

## 文档

- [x] T040 `docs/debugger.md`：中继行为清单补三方法 +
      `documentUpdated` 触发面（含冷却与「纯属性不推」）
- [x] T041 `website/guide/debugging.md`：删「快照式，运行中变化不会
      自动推送」的过时描述，改为「结构变化自动刷新，纯样式点节点自愈」
- [x] T042 `docs/roadmap.md`：093 打勾入账

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [ ] T052 spec.md 第 6 节逐条核对（含真实前端终验）
- [x] T053 `pnpm --filter @ufjs/cli run build` 重建 dist
