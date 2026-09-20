# Tasks: CSS 计算段分配瘦身 + 链缓存跨卸载保留

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 无——三张契约表零变更（spec 第 5 节已勾"都不涉及"）。

## 实现

- [x] T010 `packages/fjs-runtime/src/css/style.ts`：compute miss 的 custom
      表按来源数分派（0 → undefined、1 → 直接引用、≥2 → 写拷贝），
      消费点只读前提写成注释。
- [x] T011 `packages/fjs-runtime/src/css/style.ts`：`resolveVars` 预扫描
      快路径——无 `var(` 原对象返回。
- [x] T012 `packages/fjs-runtime/src/css/style.ts`：`matchRules` 四处折叠
      `Object.entries` → `for-in`。
- [x] T013 `packages/fjs-runtime/src/css/style.ts`：链缓存 retire 队列
      （retiredSet 去重 + 512 上限 + 修剪跳过活键），`register()` /
      `setViewport()` 同步重置队列。

## 两端对齐

- [x] T020 Web 侧无对应实现（浏览器原生 CSS），对拍口径不变；既有
      `css.test.ts`（var()/继承/级联）原样全过即对拍通过。

## 测试

- [x] T030 新增 `packages/fjs-runtime/test/css-compute-diet.test.ts`：
      custom 共享/写拷贝不写穿、resolveVars 快路径、LRU 保留/上限逐出/
      活键跳过/register 失效。
- [x] T031 `pnpm test` 全绿（含 `zz_leak_probe.test.ts` 原样通过）。
- [x] T032 `pnpm run typecheck` 通过。
- [x] T033 `examples/bench` 同机 A/B 不回退。

## 文档

- [x] T040 `docs/vant-mount-perf.md`：A/B 数字落账（首开 attributed 段、
      重开 flush、逐轮爬升现象的变化）。
- [x] T041 `docs/performance.md`：热点清单更新（计算段分配、重开成本
      状态）。
- [x] T042 `specs/076-css-compute-diet/spec.md` 状态改 `done`。

## 验收

- [x] T050 spec 第 6 节逐条核对，真实输出贴进会话。
- [x] T051 模拟器 A/B：custom 段 ≤ 5 ms、attributed 总段 ≤ 15 ms、
      重开 flush ≤ 5 ms（同打点同方法，min-of-3）。
