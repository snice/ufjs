# Tasks: vapor web 包体——样式注入拆成叶子模块

对应 plan：`./plan.md`。

## 契约层

- [x] T001 确认不涉及 op 协议 / natives / 事件类型

## 实现

- [x] T010 新建 `fjs-runtime/src/web/inject-style.ts`；`web/index.ts` 改 re-export
- [x] T011 `fjs/src/bundler/vue-plugin.ts`：生成代码导 `fjs/web-style`；`webAliases` 加 specifier
- [x] T012 `fjs/src/vite.ts`：alias 加 `fjs/web-style`

## 两端对齐

- [x] T020 Flutter 不经 injectStyle，无对应改动

## 测试

- [x] T030 CLI 单测：web 构建生成代码从 `fjs/web-style` 导入

## 文档

- [x] T040 `docs/performance.md` 记录包体前后数字

## 验收

- [x] T050 `pnpm run typecheck`、`pnpm test`
- [x] T051 vapor-app analyze：组件模块消失、数字下降
- [x] T052 浏览器：vapor-app 生产包 + vite dev；hello-fjs 两种 web 构建
- [x] T053 spec 第 6 节逐条核对，状态改 done
