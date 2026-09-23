# Tasks: hello-fjs 共享元素动画示例

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 实现

- [x] T010 `src/hero.ts`：`Rect` / `rectOf`（`$el` 兜底 + 视口矩形）、
      `rememberSource` / `sourceOf` 跨页面槽位登记、`heroHidden(id)` 共享
      隐藏开关、`FLY_MS` 时长常量
- [x] T011 `src/components/HeroFly.vue`：初始 style = from 几何 +
      transition 简写；rAF 里先强测距再切 to；`duration+32ms` 后发 `done`；
      头注释记录「为什么不是 transform+scale」
- [x] T012 `src/pages/example/animation/shared-element.vue`：`<route>`
      分组「动画演示」；场景 1（飞行盒 + ✕，状态机闸连点；白幕按 spec §2 移除）；场景 2（登记槽位 + push 详情）
- [x] T013 `src/pages/example/animation/shared-element-detail.vue`：
      `<route>{"transition":"fjs-fade"}`；挂载测自己大图 → 飞入；✕ 飞回 +
      `router.back()`；无来源槽位直达降级；unmount 兜底复位共享开关

## 两端对齐

- [x] T020 Web 端走通场景 1、2 + 直达降级 + 浏览器后退
- [x] T021 Flutter 端（模拟器）走通场景 1、2，核对登记的已知差异
      （飞行盒不参与路由淡出）

## 测试

- [x] T030 以 spec 第 6 节手工路径为准：连点 / 直达 / 浏览器后退 /
      Android 返回键四条降级全部走过

## 文档

- [x] T040 无 docs 变更（宪法 VIII 自查：能力文档已存在，示例自描述）

## 验收

- [x] T050 `pnpm --filter hello-fjs run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对
