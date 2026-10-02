# Spec: enableVapor 决定 SFC 的默认编译方式

- **ID**: 177-enable-vapor-default
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

现在一个 SFC 编成 vapor 只看它自己有没有 `<script setup vapor>`。`enableVapor: true` 的应用里，
每个页面、组件都得手写 `vapor`；漏写的文件只告警一次，页面渲染为空（纯 vapor 应用没有 VDOM
渲染器）。同一份代码想在 vapor / VDOM 之间切换，要改遍所有文件。

## 2. 不做什么（Non-goals）

- 不改 `node_modules` 里的 SFC 规则（`fjs.vapor.libs` 的自动 vapor，specs/148，照旧）。
- 不改小程序编译（`--mp`）。
- Options API（只有普通 `<script>`、没有 `<script setup>`）的 SFC 不强转 vapor：照旧编成 VDOM。

## 3. 用户可见的行为

| | 没写 `vapor` 的项目 SFC | 写了 `vapor` 的 SFC |
|---|---|---|
| `enableVapor: true` | **vapor**（新） | vapor |
| `enableVapor: false` / 未设 | VDOM（不变） | vapor（不变：VDOM 应用里混用 vapor 组件，specs/161） |

- 「项目 SFC」= 不在 `node_modules` 下的 `.vue`。`<script setup>`（可同时有普通 `<script>`）和只有
  `<template>` 的 SFC 都按上表处理。
- `enableVapor: true` 下仍是 VDOM 的只剩 Options API 组件：告警一次，说明它要改成
  `<script setup>` 才能在纯 vapor 应用里渲染（原来的「没写 vapor」告警随之删掉）。
- `vapor` 属性在 `enableVapor: true` 下是多余的，留着也无害。
- web（vite dev / build）、Flutter（esbuild）两条构建路径行为相同；热更新同样按此判定。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 判定 | 同一个函数（CLI esbuild 插件） | 同一个函数（vite 插件与 esbuild 构建共用） |
| 已知差异 | 无 | 无 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增单测：判定函数四种组合 + node_modules + Options API；
   只有 `<template>` 的 SFC 能编成 vapor。
2. `examples/vapor-app` 去掉所有 `vapor` 属性后：Flutter check 通过、web 构建无告警且页面正常
   （浏览器打开首页 / about / 表单 / 动画页）、iOS 模拟器首页 → 动画页正常。
3. demo（未开 enableVapor）构建产物与改动前一致：VDOM 页面照旧，`vapor` 页面照旧走互操作。

## 7. 待澄清

- [x] `enableVapor: false` 时显式 `vapor` 的文件：仍编成 vapor（用户确认）。
