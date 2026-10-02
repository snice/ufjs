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

## 补充：true / false 对比测试（2026-10-02）
同一份 vapor-app 源码（无任何 `vapor` 属性）分别以 `enableVapor: true / false` 运行：
- web（vite dev，逐页脚本）：首页计数 / v-if / v-for、about 与返回、表单（输入、开关、多选、提交、list-view 加行）、
  动画页（v-if / v-show / out-in / KeepAlive / TransitionGroup / circular swiper / Teleport 遮罩）两种模式结果一致；无报错
- iOS 模拟器：两种模式页面一致；KeepAlive 切回保留计数、遮罩盖住整屏、点击关闭；日志 0 错误
- 已知差异（非本次引入）：Flutter 的 VDOM `<TransitionGroup>` 是透传（删行无动画），vapor 版有动画；
  VDOM web 开发期 `[Vue warn] reserved HTML elements as component id` 噪音（web/index.ts 已注明）；
  VDOM 的 swiper 克隆页没有 `aria-hidden`
- 体积：web 175.0 KB（gz 65.5）vs 282.0 KB（gz 104.0）；Flutter release shared.js 226.3 KB vs 249.6 KB（true vs false）
- 发现并修复 specs/176 的问题：TransitionGroup 新增条目先做 move（读布局）后挂 enter 类，导致浏览器先按「可见」算了样式，
  enter 被一个反向过渡的 transitionend 提前结束（约 40ms 而非 300ms）；改为先挂 enter 类再做 move（Vue 的顺序），
  web 的结束判断改为按属性数计数 transitionend（runtime-dom 的做法）；加回归测试（无修复时失败）
- dev 下切换 enableVapor 需要重启 dev server（开关按文件缓存）
