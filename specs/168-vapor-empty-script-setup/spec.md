# Spec: 空 `<script setup vapor>` 的 SFC 能正常按 vapor 编译

- **ID**: 168-vapor-empty-script-setup
- **状态**: done
- **日期**: 2026-10-01

## 1. 要解决什么

纯展示页面的 `<script setup vapor>` 块经常是空的：

```vue
<script setup vapor>
</script>
<template><text class="named">named</text></template>
```

现象：

- `compileVaporSfc`（`fjs-runtime/src/vapor/sfc-compiler.ts`）返回
  `{ errors: [{ text: 'Duplicate attribute.' }] }`；script 里随便写一句
  （`const a = 1`）就能正常编译。
- CLI（`fjs/src/bundler/vue-plugin.ts` 的 esbuild onLoad、`isVaporSfcFile`）
  用同一种 parse 判定 vapor，会把这个文件当成 **VDOM** SFC：
  非 enableVapor 下静默走错编译器，enableVapor 下报「没有 vapor 属性」警告、
  页面渲染为空。

根因：`@vue/compiler-sfc@3.5` 的 `parse` 默认 `ignoreEmpty: true`，
内容为空（只有空白）的 `<script>` 块被直接丢掉 → `descriptor.scriptSetup`
为空 → `isVaporDescriptor` 判否。`compileVaporSfc` 随后走 auto-vapor 分支
再往 `<script setup` 后插一个 ` vapor`，得到 `<script setup vapor vapor>`
→ 重复属性。

## 2. 不做什么（Non-goals）

- 不改 VDOM SFC 的编译产物形状，不动 op 协议 / natives / 运行时。
- 不改 auto-vapor（fjs.vapor.libs）的判定规则本身。

## 3. 用户可见的行为

上面那份 SFC 在 `compileVaporSfc` 与 CLI（esbuild 插件、vite 插件）里都
被识别为 vapor，编译出带 `__vapor = true` 的组件，模板照常渲染。

## 4. 两端约定（宪法 I）

编译期修复，Flutter / Web 共用同一个 `compileVaporSfc` 与同一个
`sfcParseOptions`，两端行为一致，无已知差异。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `packages/fjs-runtime/test` 新增用例：空 `<script setup vapor>` 经
   `compileVaporSfc` 无 errors，产物含 `__vapor = true` 与模板文本。
2. `packages/fjs/test/vue-plugin-vapor.test.ts` 新增用例：同一份 SFC 经
   `isVaporSfcFile` 判为 vapor、经 esbuild 插件编译走 vapor 分支。
3. `pnpm --filter @ufjs/runtime test` 与 `pnpm --filter @ufjs/cli test` 通过。
4. `pnpm run typecheck` 通过。

## 7. 待澄清

无。修法：`sfcParseOptions()` 统一带 `ignoreEmpty: false`（vapor 判定、
vapor 编译、CLI 的 VDOM parse 用同一份选项，避免两处 parse 结论不一致）；
副作用是空的 `<style>` / `<script>` 块会出现在 descriptor 里——
compileScript / compileStyle 对空内容都能正常处理。
