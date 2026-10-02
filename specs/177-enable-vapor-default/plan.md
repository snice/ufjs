# Plan: 177-enable-vapor-default

1. `vapor/sfc-tags.ts`（CLI 与 vite 共用的判定所在）：新增
   `sfcCompilesAsVapor(file, descriptor, { enableVapor, libs })`：
   显式 vapor → true；node_modules → `isAutoVapor`；项目文件且 enableVapor 且（有 `<script setup>`
   或没有任何 `<script>`）→ true；否则 false。
2. `vapor/sfc-compiler.ts`：只有 `<template>` 的 SFC 注入一个 `<script setup vapor>` 再编译。
3. CLI `bundler/vue-plugin.ts`：onLoad 与 `isVaporSfcFile` 用新判定（`isVaporSfcFile` 加 enableVapor 参数，
   缓存键带上它）；告警改成只针对 Options API。
4. `vite.ts`：resolveId / load / handleHotUpdate 把 enableVapor 传给 `isVaporSfcFile`。
5. 单测；vapor-app 去掉 `vapor` 属性实测；文档（vue3.md、toolchain.md）。
