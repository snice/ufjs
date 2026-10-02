# Tasks: 177-enable-vapor-default

- [x] T1 sfcCompilesAsVapor 判定 + template-only 编译
- [x] T2 CLI esbuild 插件与 isVaporSfcFile 接入；告警调整
- [x] T3 vite 插件接入
- [x] T4 单测
- [x] T5 vapor-app 去掉 vapor 属性：check、web、iOS；demo 构建不变
- [x] T6 文档

## 结果
- 判定统一在 `sfcCompilesAsVapor`（sfc-tags.ts），CLI esbuild 插件、`isVaporSfcFile`、vite 插件共用；只有 `<template>` 的 SFC 追加一个空的 `<script setup vapor>` 后编译
- 实测中发现并修复：`usesVapor`（--pages 共享 chunk 是否带 `fjs/vapor`）原来只扫 `vapor` 属性——去掉属性后 Flutter dev 构建报 `Could not resolve "fjs/vapor"`；现在 `enableVapor` 应用直接算作使用 vapor
- vapor-app 去掉全部 7 个文件的 `vapor` 属性：Flutter check 通过；web 构建无告警；vite dev 下四个页面正常；release `--pages` 构建正常；iOS 模拟器首页 / 动画页正常、日志 0 错误
- demo（未开 enableVapor）构建正常（判定在关闭时与改动前等价）
- 单测：插件编译（setup / 纯模板 → vapor，Options API → VDOM + 告警）、判定表、usesVapor
