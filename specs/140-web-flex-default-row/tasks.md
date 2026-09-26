# Tasks: web 端「display:flex 不写方向」默认横排，与引擎一致

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 不涉及 op 协议 / natives / 事件类型（plan §1 II），确认无需改动

## 实现

- [x] T010 新增 `expandFlexDefault(css)` 并接入 `rewriteFjsCss` —— `packages/fjs-runtime/src/web/css-compat.ts`
- [x] T011 从 web 入口导出 `expandFlexDefault` —— `packages/fjs-runtime/src/web/index.ts`
- [x] T012 base-css：顺序声明、方向挪进 `@layer fjs-base`、`@layer fjs-flex` inline 兜底 —— `packages/fjs-runtime/src/web/base-css.ts`

## 两端对齐

- [x] T020 Vite 插件：`.css` 导入过 `expandFlexDefault`；非 css lang 的 SFC 块不做 flex 改写 —— `packages/fjs/src/vite.ts`
- [x] T021 esbuild web 构建：`.css` onLoad 过 `expandFlexDefault` —— `packages/fjs/src/bundler/vue-plugin.ts`
- [x] T022 示例页补显式方向 —— `examples/hello-fjs/src/pages/example/style/responsive.vue`
- [x] T023 两端对拍：demo-web `/#/nutui-basic`、`/#/nutui-button` 与 specs/139 iOS 结果一致（Cell 横排、图标可见）

## 测试

- [x] T030 改写器单测（普通/同块有方向/flex-flow/inline-flex/@media/@keyframes 跳过/注释/幂等/@charset）—— `packages/fjs-runtime/test/web-css-compat.test.ts`
- [x] T031 base-css 分层断言 —— `packages/fjs-runtime/test/web-css-compat.test.ts`
- [x] T032 Vite 插件 `.css` 与 SFC 块分支、scoped 下 @layer 规则带作用域 —— `packages/fjs/test/vite-flex-default.test.ts`

## 文档

- [x] T040 更新 `docs/css-compat.md`（`flex-direction` / `align-items` 行：web 同规则）
- [x] T041 更新 `docs/web.md` 已知差异（@layer 机制、scss 块、inline 兜底、浏览器版本）
- [x] T042 `docs/roadmap.md` 无对应条目则不改（核对）

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对
