# Plan: fjs lint / fjs types

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 规则同源 | 支持表放 `fjs-runtime/src/css/support.ts`，引擎与 CLI 共读一份；表↔引擎一致性由 fjs-runtime 测试钉住（每类 ❌ 至少一条引擎行为断言）。运行时两端行为零改动 |
| II 边界即契约 | 否 | 三张表零改动 |
| III 同步单线程零序列化 | 否 | 纯 Node 侧工具，不碰 JSI |
| IV 外观照 WeUI | 否 | 无外观 |
| V 静默失效是 bug | 是（本 spec 就是它的工具化） | lint 把「运行期才 warnOnce」提前到写代码时；表里每条 ❌/warn 带去向说明（用什么替代） |
| VI 注释记录权衡 | 是 | `support.ts` 顶部注释写明「表是 css-compat.md 的机器可读镜像、两边怎么保持同步」；lint 命令注释写明为什么不扫 `:style` 对象、为什么不挂 build |
| VII JS 能包就不要下 Dart | 是 | 纯 JS/CLI 侧，零 Dart 改动——正是这条宪法的正面案例 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`（两条命令）、`docs/css-compat.md`（指向支持表）、`docs/roadmap.md`（中期两条移入已完成） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/css/support.ts`（新） | 机器可读支持表：`DROPPED_PROPERTIES`、`CONSTRAINED_VALUE_CHECKS` 相关数据、`DROPPED_SELECTORS`/`DROPPED_AT_RULES`、不可用单位集、App 端可动画属性集（transform/opacity/svg 族） |
| JS runtime | `packages/fjs-runtime/test/css-support.test.ts`（新） | 表↔引擎一致性断言 + tags.json↔vue-global.d.ts 防漂移 |
| CLI | `packages/fjs/src/commands/lint.ts`（新） | 扫描（.vue `<style>` 块 + 静态 `style` 属性 + `.css`）、定位、报告、`--strict`、文件/目录参数 |
| CLI | `packages/fjs/src/commands/types.ts`（新） | 调四个 `*TypesSource` + 写入/`--check` 比较 |
| CLI | `packages/fjs/src/cli.ts` | 接线两个命令 + usage 文本 |
| CLI | `packages/fjs/test/lint.test.ts`、`packages/fjs/test/types.test.ts`（新） | vitest |
| 文档 | `docs/toolchain.md`、`docs/css-compat.md`、`docs/roadmap.md` | 命令、支持表指引、roadmap 打勾 |

Web 适配层、C++、Dart 宿主：零改动。

## 3. 方案

### 支持表（`css/support.ts`）

纯数据 + 纯函数，不 import 引擎代码（避免循环依赖与运行期副作用），
导出：

- `DROPPED_PROPERTIES: Record<string, string>`——属性名 → 一句话去向
  （`word-break` → 「用 max-lines + overflow: ellipsis」）。初版条目即
  css-compat 的 ❌ 集：`word-break`、`text-overflow`、`filter`、
  `backdrop-filter`；值级 `display: grid` 走值检查不进这张表。
- `CONSTRAINED_PROPERTIES`：值级检查器数据——`display` 的非法值
  （`grid`/`inline-grid`）、`background(-image)` 的 `url(`、
  `vertical-align` 仅 `sub`/`super`/`inherit`、`transition(-property)`
  名单外的属性名（App 端不动画）、单位检查（`vw`/`vh`/`vmin`/`vmax`
  任意属性值里出现；`em`/`rem` 引擎已换算，不报）。
- `ANIMATABLE_ON_APP`：`transform` / `opacity` + svg 形状族
  （`fill`、`stroke`、`stroke-*`、`fill-*`、`display`、`visibility`），
  `@keyframes` 帧检查用；svg 族不豁免会误报 vant spinner。
- `DROPPED_SELECTORS`/`DROPPED_AT_RULES`：`#id`、`~`、`:nth-child(`、
  `:not(`、其余未列伪类；`@supports`、`@import`、`@charset`、
  `@namespace`。`@media` 的特性检查复用 `parseMediaCondition`
  （parser.ts 已导出，返回 null = 整块丢）——它内部会 `warnOnce`，
  lint 侧先以自身正则判型，只在「条件可解析但特性超集」时借助它，
  控制台重复告警可接受（lint 是一次性进程）。
- 定位（file:line:col）不靠 `parseStylesheet`（`CssRule` 不带源位置）：
  lint 自带一层轻量块扫描（注释剥离 + `matchBrace` 同款括号配对），
  在块内对声明做 `prop: value` 切分，对照支持表出报告。选择器级检查
  在同一层做。这是「复用引擎解析」与「拿到行号」冲突的取舍——解析器
  带位置是引擎侧改造，超出本 spec。

### `fjs lint`

`commands/lint.ts`：默认扫 `src/**/*.{vue,css}`（跳过 node_modules /
dist / `.fjs`）；位置参数可指定文件或目录。`.vue` 用
`@vue/compiler-sfc` 的 `parse` 取 `descriptor.styles` 与模板静态
`style` 属性（`asset-check.ts` 同款）。发现分两级：`[drop]`（引擎或
浏览器会整条/整块丢弃，退出码 1）、`[warn]`（部分场景不生效/两端分叉，
退出码 0；`--strict` 时 1）。报告对齐 `asset-check` 的输出风格。

### `fjs types`

`commands/types.ts`：四个 source 函数全部已导出
（`routeTypesSource` / `assetTypesSource` / `moduleTypesSource` /
`moduleComponentTypesSource`），命令只做「算 source → 与磁盘比较 →
写或报 stale」。写入规则沿用各 writer 的既有语义（空项目不生成）。
`--check` 永不写。

### 被否掉的备选

- **lint 复用 `parseStylesheet` 出报告**：`CssRule` 无源位置，行号是
  报告的最低可用性；给解析器加位置是引擎改造。否。
- **支持表放 CLI 侧**：离引擎太远，漂移无人看。表必须在 fjs-runtime，
  与 `tags.json` 同一哲学（`volar.cjs` 注释写明了为什么放 JSON）。
- **引擎运行时按表告警未知属性**：见 spec 第 2 节，表尚不权威 + 运行
  期开销。否。
- **`fjs types` 生成 runtime 的 `vue-global.d.ts`**：那是包作者侧的
  产物，跟包分发；项目命令重生成会跟装到的版本打架。防漂移改为测试。
- **lint 挂进 build/dev 默认跑**：现存项目（含 vant 五页）立刻变吵，
  改变所有人的构建输出。留给 CI 显式选择。

## 4. 风险

- **表与引擎漂移**：缓解 = 表放 fjs-runtime + 一致性测试；css-compat.md
  加一行指向表，改 CSS 支持时两个地方一起动（第 7 节流程表追加一步）。
- **误报训练用户忽略通道**：初版条目从严（只收 css-compat 明确 ❌ 与
  明确登记的 App 端不动画），`[warn]` 级给足上下文文案；demo 实跑校准。
- **`.vue` 解析失败**（SFC 语法错）：单文件跳过并报一行，不让整个
  lint 崩——typecheck/dev 会另外报真错。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli test          # 新增 lint/types 用例
pnpm test                             # runtime + cli 全量
pnpm run typecheck
cd demo && npx fjs lint; echo $?      # 退出码语义
cd demo && npx fjs types && npx fjs types --check; echo $?
```
