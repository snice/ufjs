# Plan: 168-vapor-empty-script-setup

对应 spec：`./spec.md`。

## 1. 宪法核对

- I 两端同源：纯编译期，两端共用 `sfcParseOptions` / `compileVaporSfc`。
- II 契约：op 协议、natives、事件类型均不涉及。
- VII：不下 Dart。

## 2. 改动

| 层 | 文件 | 改什么 |
|---|---|---|
| 编译器 | `packages/fjs-runtime/src/vapor/sfc-tags.ts` | `sfcParseOptions()` 返回值加 `ignoreEmpty: false`，注释说明原因 |
| 测试 | `packages/fjs-runtime/test/vapor-sfc-compiler.test.ts`（新） | 空 `<script setup vapor>` 经 `compileVaporSfc` 成功 |
| 测试 | `packages/fjs/test/vue-plugin-vapor.test.ts` | 空 script 的 SFC：`isVaporSfcFile` 为真、esbuild 插件走 vapor 分支 |

`compileVaporSfc`、CLI onLoad、`isVaporSfcFile` 都经 `sfcParseOptions`，
一处改动覆盖全部 parse 点，不需要改 auto-vapor 的属性注入。

## 3. 风险

空 `<style>` / `<script>` 块会进 descriptor：`compileStyle('')` 产出空串，
`compileScript` 对空 script 正常；node_modules 里带空 `<script>` 的 SFC
不再被 auto-vapor（`!descriptor.script`），可接受的边角。
