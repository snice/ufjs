# Tasks: fjs lint / fjs types

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 建 `packages/fjs-runtime/src/css/support.ts`：`DROPPED_PROPERTIES`、值级检查数据（display 值 / background url / vertical-align / transition 名单 / vw·vh·vmin·vmax）、`ANIMATABLE_ON_APP`、`DROPPED_SELECTORS` / `DROPPED_AT_RULES`；顶部注释写明与 css-compat.md 的镜像关系
- [x] T002 建 `packages/fjs-runtime/test/css-support.test.ts`：每类 ❌ 条目至少一条引擎行为断言（`parseSelector('#a')` 为 null、`~` 组合器为 null、`word-break` 声明不进规则、`parseMediaCondition('print')` 为 null 等）

## 实现

- [x] T010 `packages/fjs/src/commands/lint.ts`：文件收集（src 递归 + 位置参数）、`.vue` style 块/静态 style 属性提取、块扫描与声明定位、按支持表出 `[drop]`/`[warn]` 报告、`--strict` 退出码
- [x] T011 `packages/fjs/src/commands/types.ts`：四个 source 函数写出 / unchanged / skipped / `--check` stale 报告与退出码
- [x] T012 `packages/fjs/src/cli.ts` 接线 `lint` / `types` + usage 文本 + 顶部注释命令清单

## 测试

- [x] T030 `packages/fjs/test/lint.test.ts`：spec 第 6.1 条的十个样例各一条、行号正确、干净样例零发现、`--strict` 退出码、SFC 解析失败跳过不崩
- [x] T031 `packages/fjs/test/types.test.ts`：临时项目夹具写出 routes/components、空模块 skipped、二次运行 unchanged、`--check` 对改旧文件报 stale 退出码 1

## 文档

- [x] T040 `docs/toolchain.md`：两条命令的章节（对齐现有命令条目风格）
- [x] T041 `docs/css-compat.md`：开头加「机器可读支持表」指引 + 第 7 节流程追加「同步 support.ts」一步
- [x] T042 `docs/roadmap.md`：中期计划两条移入已完成（新增小节，照 080–083 的写法）

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 demo 实跑 `fjs lint` / `fjs types` / `fjs types --check`，对照 spec 第 6 节逐条核对
