# Spec: input 认 DOM 的 type / inputmode / enterkeyhint（键盘类型与密码）

- **ID**: 125-input-dom-keyboard
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

vant-form 页（`demo/src/pages/vant-form.vue`）在 App 端：

- `type="password"` 的密码框明文显示；
- `type="digit"`（年龄）弹出的是全键盘，不是数字键盘；
- `type="number"`、`type="tel"` 同理，键盘不匹配。

**根因**：vant Field 按 DOM 写法给 `<input>` 设 `type` / `inputmode` /
`enterkeyhint`（`mapInputType`：`number` → `type=text inputmode=decimal`，
`digit` → `type=tel inputmode=numeric`），而 Dart 的 `FjsInput` 只认 fjs 自己
的 `secure` / `keyboard` / `confirmType`，DOM 这三个属性全部被忽略。

Web 端 vant 的 `<input>` 是原生 DOM，本来就对。但页面模板里直接写的
`<input type="password">` 在 web 上走 `FjsInput` 组件（`web/components/form.ts`），
它用 `secure/keyboard` 算出的 `type` 覆盖了页面写的 `type` —— 同样明文。

## 2. 不做什么（Non-goals）

- 不做 vant 的数字过滤（`formatNumber` 在 JS 里已做）；只管键盘和遮挡。
- 不做 `autocomplete`（密码管理器 / 自动填充）。
- 不改小程序端（`fjs build --mp` 的 input 映射另立项；vant 不跑在小程序上）。
- 不改 `secure` / `keyboard` / `confirm-type` 的现有语义，只加 DOM 别名。

## 3. 用户可见的行为

页面零改动：

```vue
<van-field v-model="password" type="password" label="密码" />
<van-field v-model="age" type="digit" label="年龄" />
<van-field v-model="price" type="number" label="价格" />
<van-field v-model="phone" type="tel" label="手机号" />
<input type="password" />
<input type="email" enterkeyhint="send" />
```

App 与 Web 一致：

| 页面写法 | 键盘 / 显示 |
|---|---|
| `type="password"` | 圆点遮挡，关闭联想与自动纠错 |
| `type="tel"` | 电话键盘 |
| `type="email"` | 邮箱键盘 |
| `type="url"` | URL 键盘 |
| `type="number"` | 数字键盘 |
| `type="search"` | 文本键盘，回车键显示"搜索" |
| `inputmode="numeric"`（vant `digit`） | 纯数字键盘 |
| `inputmode="decimal"`（vant `number`） | 带小数点的数字键盘 |
| `inputmode="tel"/"email"/"url"/"search"/"text"` | 同名键盘 |
| `enterkeyhint="done"/"go"/"next"/"search"/"send"` | 回车键文案，按下派 `@confirm`/`@submit`，与 `confirm-type` 同值同义；`enter` 等同 `return` |

**优先级**（与浏览器一致，fjs 自有 prop 最高）：
- 键盘：`keyboard` > `inputmode` > `type`；
- 遮挡：`secure` 或 `type="password"` 任一为真即遮挡；
- 回车键：`confirm-type` > `enterkeyhint` > `type="search"`。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `FjsInput` 读 `type` / `inputmode` / `enterkeyhint` 映射到 `keyboardType` / `obscureText` / `textInputAction` | vant：原生 DOM，已正确；`FjsInput` 组件：没写 `secure`/`keyboard` 时让页面的 `type` 透传，不再覆盖成 `text` |
| 事件载荷 | 不变 | 不变 |
| 已知差异 | 键盘具体长相由系统决定（iOS `numeric` 无小数点、`decimal` 有），与浏览器同 | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及（props 本来就原样到达 Dart）

## 6. 验收标准

1. `cd packages/flutter_fjs && flutter test` 通过，新增测试覆盖：`type=password` →
   `obscureText`；`inputmode=numeric` → `TextInputType.number`；
   `inputmode=decimal` → `numberWithOptions(decimal: true)`；`type=tel` → phone；
   `keyboard` 优先于 `inputmode`；`enterkeyhint=done` → `TextInputAction.done`。
2. `pnpm run typecheck`、`pnpm --filter @ufjs/runtime test` 通过；web `FjsInput`
   新增测试：`<input type="password">` 渲染出 `type="password"`。
3. 真机 / 模拟器 demo vant-form：密码框遮挡，年龄弹数字键盘。
4. `docs/ui-api.md` 的 `input` 行补 `type` / `inputmode` / `enterkeyhint`。

## 7. 待澄清

无。
