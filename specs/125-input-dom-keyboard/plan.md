# Plan: input 认 DOM 的 type / inputmode / enterkeyhint

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter：`packages/flutter_fjs/lib/src/widgets/input.dart`；Web：`packages/fjs-runtime/src/web/components/form.ts`（`FjsInput` 不再覆盖页面写的 `type` / `enterkeyhint`）。vant 在 web 上是原生 DOM，不用改 |
| II 边界即契约 | 否 | props 经已有 setProps 原样到达，键名 `type` / `inputmode` / `enterkeyhint`（renderer 的 camelize 对无连字符名不变） |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | 键盘由系统提供 |
| V 静默失效是 bug | 是 | 未知 `type`/`inputmode` 值按 `text` 处理，与浏览器一致（浏览器同样静默回落），不告警 |
| VI 注释记录权衡 | 是 | input.dart 注释写优先级与 vant `mapInputType` 的来由 |
| VII JS 能包就不要下 Dart | 必须下 Dart | 键盘类型、遮挡是平台输入控件的属性 |
| VIII 变更落到文档 | 是 | `docs/ui-api.md` input 行 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/input.dart` | `_keyboardType`：`keyboard` > `inputmode` > `type`；`obscureText`：`secure` 或 `type==password`，遮挡时关 `enableSuggestions` / `autocorrect`；`_textInputAction`：`confirmType` > `enterkeyhint` > `type==search` |
| Web 适配层 | `packages/fjs-runtime/src/web/components/form.ts` | 单行时 `type` 只在 `secure`/`keyboard` 给了时才覆盖，否则用 `attrs.type`；`enterkeyhint` 只在 textarea 确认键场景覆盖，否则透传 |
| 测试 | `packages/flutter_fjs/test/input_control_test.dart`、`packages/fjs-runtime/src/web/**` 现有 FjsInput 测试 | 新增用例 |
| 文档 | `docs/ui-api.md` | input 行 |

## 3. 方案

在 Dart 侧把 DOM 属性当 fjs prop 的别名读，不在 JS renderer 里改写成 `secure/keyboard`：
renderer 是框架无关层，按 DOM 名原样下发更贴近 element API 的"DOM 形状"约定
（`value`、`readonly`、`disabled` 已是这样处理的，specs/070/077）。

否掉：在 `vue/renderer.ts` 把 `type=password` 翻译成 `secure` —— 把属性语义塞进
renderer，React 等其他适配层得再做一遍。

## 4. 风险

- `type="number"` 的原生 `<input>` 在 web 会出现步进箭头；vant 自己转成 `text + decimal`，
  页面直接写 `type=number` 时 web 行为本来如此，不处理。

## 5. 验证路径

```bash
cd packages/flutter_fjs && flutter test test/input_control_test.dart && flutter test
pnpm run typecheck && pnpm --filter @ufjs/runtime test
```
