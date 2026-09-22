# Spec: dev 调试的 Vue SFC source map

- **ID**: 094-devtools-vue-sourcemap
- **状态**: done（2026-09-22 `@ufjs/cli` typecheck + vitest 344 项全绿。
  Chrome 里点 `<script setup>` 行号是手工项，不挡合并）
- **日期**: 2026-09-22

## 1. 要解决什么

`fjs debug` 的 Sources 面板里只有编译后的 `bundle.js` / page chunk / 单元
产物。断点能下，但行号对不上 `.vue`：`<script setup>` 和 template 都已经
被编成 render 函数。088 把这件事留成了后续 spec（PrimJS 的
`scriptParsed.sourceMapURL` 当时就是空的）。

## 2. 不做什么（Non-goals）

- **release / 字节码**。`fjs build` 不写 `.map`，注释也不进产物。
- **小程序端、Worker**。和 088 一样不在调试器范围里。
- **web 构建**。浏览器 DevTools + Vite 自己有 map，这条链路只服务 app 的
  dev 源码模式。
- **引擎解释 map**。断点坐标换算仍由 Chrome DevTools 前端做。不改 PrimJS。
- **`<style>` 断点**。样式不是可执行语句，map 不覆盖 style 块。
- **template 行一一对应**。有映射就停，没有独立语句的模板行不停，不作为
  门禁（和 Vite 一样）。
- **`shared.js`**。units 模式下它几乎全是依赖，不为它出 map。组件在各自的
  单元文件里。

## 3. 用户可见的行为

页面代码零改动。`fjs dev`（或 `fjs run`）+ `fjs debug` 之后：

- Sources 里能打开 `src/pages/index.vue` 这类原文（内容嵌在 map 里，
  DevTools 不用再去读磁盘）；
- Vue 里 import 的项目 `.ts` / `.js`（`src/stores/counter.ts`）同样出现在
  `src/` 下，可执行行能下断点。map 是 data URL，Chrome 按脚本 URL 解析
  `sources`，所以这些路径写成相对脚本目录，而不是堆在 `units/<id>/` 下面。
  `fjs-shared-stub` 不进 map，避免 import 看起来落在
  `__fjsRequireUnit` 占位上。`shared.js` 里的 npm 依赖（pinia、vue、vant）
  仍然没有 map；
- 在 `<script setup>` 的可执行行点行号，手机会停在那一行，Call Stack
  显示原文行号；
- 编译产物仍在，文件名是 `bundle.js`、`pages/<chunk>.js`、
  `units/<id>.js`、`shared.js`、`units.js`，和原文路径错开，避免
  DevTools 把两边当成同一个脚本。

## 4. 两端约定（宪法 I）

调试器是开发者工具，不是页面能力。web 端用浏览器自带 DevTools（Vite 的
map），app 端走这条链路。页面源码零改动。差异登记在 `docs/web.md`。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议：不涉及
- [ ] natives 表：不涉及
- [ ] 事件类型：不涉及
- [x] dev 脚本的 eval 文件名：单元从源路径改为 `units/<id>.js`，
      shared / units 整包不再共用 `prelude.js`。`__fjsRequireUnit` 的 id
      不变。

## 6. 验收标准

1. 插件单测：`<script setup>` 里一行可执行代码，map 解出来落在 `.vue`
   的那一行；template 的 render 映射落在 template 块，而不是第 1 行。
2. 构建单测：`sourcemap: true` 的 page / 单元产物带 `fjs-map:` 注释，
   `.map` 的 `sourcesContent` 是 SFC 原文；不传该标志时没有 `.map`。
   `shared.js` 没有 map。
3. 中继单测：`scriptParsed` 的 `fjs-map:` 被改写成可解码的 data URL；
   路径不是 `.js.map` 时不读文件，原 URL 原样转发。
4. `pnpm --filter @ufjs/cli run typecheck` 与 `pnpm --filter @ufjs/cli test` 通过。
5. 手动（不挡合并）：`fjs dev` + `fjs debug`，在 `<script setup>` 点行号能停住。

## 7. 待澄清

无。方案沿用已确认的 plan：external map + `fjs-map:` 注释 + 中继内联
data URL。
