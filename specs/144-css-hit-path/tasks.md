# Tasks: 样式引擎命中路径瘦身

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

三张表都不动（`DefineStyle` 字节格式不变）。唯一的"格式"是 JS 自产自销的构建期快照。

- [x] T001 记录改前基线：`bench:mount` prewarm 五页数字 + `_css-prof` 分项 + `style prewarm` 快照体积，写进 tasks 备注：`demo/bench/_css-prof.ts`（临时）
  - 基线（本机，两轮）：cold sync / css — basic 11.0 / 4.6 · feedback 8.0 / 2.4 · form 20.6 / 8.9–9.0 · more 8.5 / 3.0 · nav 12.7 / 5.0–5.3；miss 1 / 0 / 1 / 1 / 20
  - 剖析 vant-form：applyStyle 4.37、compute 3.67（computeMiss 42）、JSON.stringify 0.38 ms / 20264 字符；basic applyStyle 3.60；more 2.13
  - 快照：bench 5 页 270 KB
- [x] T002 `STYLE_SNAPSHOT_VERSION` 2 → 3，`StyleSnapshot.computes` 行类型加第 10 列 `inlineKey`：`packages/fjs-runtime/src/css/style.ts`

## 实现

- [x] T010 (a) `styleId()` 的 DefineStyle 改走 `this.str(json, true)`，写明为什么不缓存字节：`packages/fjs-runtime/src/ui/ops.ts`
- [x] T011 (b) `ElementState.inlineKey`：按需计算，四个 inline 写入口改动时清空：`packages/fjs-runtime/src/css/style.ts`
  - 实现细节：没有在写入口逐个清空，而是按 (inline, inlineCustom) 两个对象的身份校验缓存（所有写入口都是换新对象、不原地改，已核对），效果相同且不会漏
- [x] T012 (b) `MatchResult.byInline` + `compute()` 查 / 写 inline 记忆（上限 128），注释列出键的输入清单：`packages/fjs-runtime/src/css/style.ts`
- [x] T013 (b) `exportSnapshot()` 导出 inline 元素及其子树，`importSnapshot()` 回放到 `byInline`：`packages/fjs-runtime/src/css/style.ts`

## 两端对齐

- [x] T020 Web 侧：确认不涉及（web 不经过样式引擎与 op 协议），在 plan 已写明；跑 `pnpm --filter demo run build:web` 确认 web 构建不受影响（原写的 hello-fjs `build:pages` 是 app 分包构建，改用 demo `build:web`，通过）
- [x] T021 两端对拍：真机 vant-basic / form / nav / watermark、nutui-basic 逐页截图与改前对比，外观一致

## 测试

- [x] T030 DefineStyle 字节一致：ASCII、CJK、emoji、超长样式与改前 `utf8Encode` 路径逐字节相等：`packages/fjs-runtime/test/ops-define-style.test.ts`
- [x] T031 inline 记忆：命中与重算结果逐项相等（inline `--x`、em、calc、`:active` / `:hover`、伪元素）；inline 变化后不误命中；上限清空：`packages/fjs-runtime/test/css-inline-memo.test.ts`
- [x] T032 快照 v3：inline 元素及其子树导出后导入命中；v2 快照被拒并给出原因：`packages/fjs-runtime/test/css-inline-memo.test.ts`

## 文档

- [x] T040 补"命中路径瘦身（specs/144）"一节：剖析表、两处改动、前后对比、快照体积变化：`docs/vant-mount-perf.md`
- [x] T041 `docs/roadmap.md` 打勾一条

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `pnpm --filter @ufjs/cli run build`；编 native 后 `flutter test`（确认不是 `No tests ran`）
- [x] T053 spec.md 第 6 节逐条核对：bench vant-form css ≤ 5 ms、五页 miss 不变；真机 `[nav] mounted` 下降与截图一致；删除临时剖析脚本 `demo/bench/_css-prof.ts`、`demo/bench/_utf8-prof.ts`
  - 1 ✅ typecheck / `pnpm test`（runtime 807，现有期望值未改）· 2 ✅ 新增 12 条（字节一致、inline 命中 = 重算、快照 v3）
  - 3 ✅ bench vant-form css 8.9 → 4.4 ms，miss 1/0/1/1/20 不变 · 4 ✅ `flutter test` 536 通过
  - 5 ✅ 真机五页挂载 231 → 198 ms（单次采样），外观一致（用户目测）· 6 ✅ 文档
  - 临时脚本已删
