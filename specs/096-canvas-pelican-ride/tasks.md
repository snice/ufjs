# Tasks: hello-fjs 画布示例「鹈鹕骑行」

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 三张表零改动 —— 本 spec 不涉及（plan §1 II 已核），无需任务

## 实现

- [x] T010 新建 `examples/hello-fjs/src/pages/example/canvas/pelican.vue`：
      `<route>` 块（title 鹈鹕骑行 / group 画布演示 / desc）+ Panel 布局
      （照 `webgl.vue`）+ canvas `@resize`/`@tap`/`touch-action: none`

- [x] T011 同文件：手绘分层（背景视差 → 自行车 → 鹈鹕 + 蹬腿/叼鱼），
      只用 `docs/canvas-compat.md` ✅ API；`onResize` 首绘 + 起 rAF 循环
      （`shown` 守卫），`onBeforeUnmount` 里 `cancelAnimationFrame`

- [x] T012 同文件：动画时钟用 rAF `now` 差值累积（封顶 100ms），
      `@tap` 切 `speed`；注释按 plan VI 记录三处权衡

## 两端对齐

- [x] T020 Web 侧验证：`pnpm --filter hello-fjs run dev:web` —— 目录
      「画布演示」出条目；页面动画在跑（隔 400ms 两帧 97% 像素差异）；
      点画布 ×1 → ×2.5 即时生效；返回目录页无报错
- [ ] T021 App 侧对拍：`fjs dev` + `fjs run android`（或 iOS），同路由
      同构图同交互 —— **真机手工项，未做**

## 测试

- [x] T030 无新增单测（纯展示页）；以 typecheck/build 当门禁

## 文档

- [x] T040 不改文档（VIII 不触发，plan §2 已核）

## 验收

- [x] T050 `pnpm --filter hello-fjs run typecheck` 通过
- [x] T051 `pnpm --filter hello-fjs run build` 通过，产物路由表含
      鹈鹕骑行条目（`dist/app/shared.js` routes 表 + `pages/example-canvas-pelican.js`）
- [x] T052 `pnpm --filter hello-fjs run build:mp` 通过，新页在
      `canvas` 分包（`dist/mp/miniprogram/canvas/pages/example-canvas-pelican/`，
      package.json subpackages 零改动）
- [x] T053 spec.md 第 6 节逐条核对：1/2/3/5 通过；第 4 条（真机对拍）
      归 T021 手工项
