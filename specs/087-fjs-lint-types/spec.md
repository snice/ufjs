# Spec: fjs lint / fjs types

- **ID**: 087-fjs-lint-types
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

roadmap 中期计划的两条 CLI 命令提前实现。

**`fjs lint`**：fjs 的 CSS 引擎不是浏览器。页面写了引擎不支持的东西
（`#id` 选择器、`word-break`、`vw` 单位、`display: grid`、`@import`……），
今天是**运行期才** `warnOnce`——而且只 warn 被访问到的页面、每条消息整个
进程只一次，Web 端真 CSS 还会把一部分声明浏览器原生丢掉、App 端整条跳过，
两边安静程度还不一样。支持矩阵只活在 `docs/css-compat.md` 的散文里，
没有机器可读的形态，工具链没有任何一处能在写代码的时候指出
「这条规则 App 上不会生效」。

**`fjs types`**：`fjs-routes.d.ts` / `fjs-assets.d.ts` /
`fjs-modules.d.ts` / `fjs-components.d.ts` 四个生成文件的生成器都已存在
（`project/pages.ts` / `assets.ts` / `modules.ts`），但只在 dev server、
构建、Vite 插件里**顺带**写。刚 checkout 的项目在第一次跑 dev/build 之前
编辑器没有补全；CI 想确认生成文件没过期也没有入口。

## 2. 不做什么（Non-goals）

- **不改 CSS 引擎的运行时行为**。引擎侧不加「未知属性告警」：支持表
  还不足以做权威裁决（HTML 别名标签接受的属性更宽），每页每键的运行期
  开销也不值。lint 是静态工具，报错位置在命令行不在设备上。
- **不扫 `:style` 对象字面量**。`:style="{ filter: x }"` 的值是任意
  表达式，静态判别必然误报（同 `asset-check.ts` 只看字面量的理由）。
  静态 `style="…"` 属性与 `<style>` 块、`.css` 文件是纯文本，纳入。
- **不挂进 build / dev**。vant 这类组件库的 CSS 量大，默认全量扫描会
  把每个现存项目的构建输出变吵。独立命令 + `--strict` 交给 CI 与
  pre-commit 自己选。后续要不要挂、按什么配置挂，另起 spec。
- **小程序端（wxss）不在检查范围**。`fjs build --mp` 的样式约束是另一
  张表，lint 只对 fjs CSS 引擎的契约负责。
- **不生成 runtime 自带的组件类型**。核心标签的 `GlobalComponents`
  增补是 `@ufjs/runtime` 自带的手写 `vue-global.d.ts`，跟着包走；
  项目命令不能也不需要重生成它。防漂移用测试钉住（见第 6 节）。
- 不修任何 lint 发现的问题，只报告。

## 3. 用户可见的行为

```
$ fjs lint                      # 扫 src/**/*.vue 的 <style> 块与静态 style 属性、src/**/*.css
src/pages/index.vue:12:3   [drop]    #header { … }          id 选择器不支持，整条规则不会生效
src/pages/index.vue:20:11  [drop]    word-break: break-all  属性不支持；截断用 max-lines + overflow: ellipsis
src/pages/demo.vue:31:5    [drop]    @import './x.css'      at-rule 不支持，整块跳过
src/pages/demo.vue:40:3    [warn]    background-image: url(…)  位图背景不渲染（只支持 gradient；用 <image>）
src/pages/demo.vue:44:3    [warn]    transition: filter 1s  filter 不在 App 端可过渡属性里，App 上瞬时
src/pages/demo.vue:52:9    [warn]    @keyframes pulse { background-color: … }  App 端该帧不动（只有 transform/opacity/svg 描边填充族真动）
2 drop / 4 warn in 14 files        # 有 drop 时退出码 1，只有 warn 退出码 0

$ fjs lint --strict             # 任何一条（含 warn）都退出码 1 —— CI 用
$ fjs lint src/pages/demo.vue   # 也可以只扫指定文件/目录
```

```
$ fjs types                     # 立即写出/刷新四个生成 d.ts（同 dev/build 的写入规则：变了才写）
wrote src/fjs-routes.d.ts
unchanged src/fjs-assets.d.ts
skipped src/fjs-modules.d.ts          # 项目没有本地模块时照旧不生成
wrote src/fjs-components.d.ts

$ fjs types --check             # 只读。有「会变化」的文件时列出并退出码 1，供 CI 守护
src/fjs-routes.d.ts is stale (run `fjs types`)
```

## 4. 两端约定（宪法 I）

不涉及运行时两端行为。本 spec 的「同源」是**规则同源**：lint 的判定表
放在 `fjs-runtime/src/css/support.ts`，与 CSS 引擎同包共读（CLI 已有直
接 import runtime 源码的先例：`vue-plugin.ts` 引 `tags.js`）。表与引擎、
与 `docs/css-compat.md` 的一致性由 fjs-runtime 侧测试钉住（表的每类
❌ 条目至少一条引擎行为断言），不靠人肉。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `fjs lint` 对含 `#id` 选择器、`word-break`、`vw` 单位、`display: grid`、
   `@import`、`background-image: url(...)`、`:nth-child`、`:not()`、
   `~` 组合器、`transition: filter` 的样例各报一条，文件与行号正确；
   干净样例零输出退出码 0。
2. `fjs lint` 在 demo 项目实跑：已知干净（或仅存量已知项），不崩溃；
   输出条数与 `--strict` 退出码语义一致。
3. `fjs types` 在 demo 实跑后 `git status` 里四个 d.ts 与 dev server
   启动后的产物一致；再次运行全部 `unchanged`。
4. `fjs types --check` 对手工改旧的 `fjs-routes.d.ts` 报 stale 并退出码 1。
5. fjs-runtime 新增测试：支持表 ❌ 条目与引擎行为对齐
   （`parseSelector('#a')` 为 null、`word-break` 声明进不了规则等）；
   `tags.json` ∪ `component-tags.json` 的每一项在 `vue-global.d.ts`
   的 `GlobalComponents` 里有对应条目。
6. `pnpm --filter @ufjs/cli test`、`pnpm test` 全绿；`pnpm run typecheck` 通过。

## 7. 待澄清

- 无。实现中拍板的默认（扫描范围不含 `:style` 对象字面量、lint 不挂
  build、退出码语义）都写在第 2、3 节，要改随时改。
