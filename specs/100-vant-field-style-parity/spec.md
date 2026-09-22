# Spec: vant Field 样式对齐——label 默认样式与 ::placeholder

- **ID**: 100-vant-field-style-parity
- **状态**: done
- **日期**: 2026-09-22

## 1. 要解决什么

demo 的 `vant-form` 页，Field 输入行和 vant 官方（vant.pro / 真浏览器）对比有可见偏差，
iOS 模拟器与本地 web 两端都错，但错的位置不完全一样：

1. **label 和输入文字不在同一条水平线上**（用户报告的主诉）。实测：
   - web：`.van-field__label` 内层原生 `<label>` 被 base-css 的 `label { margin: 4px }`
     顶出 4px，姓名/密码比占位文字低 4px；
   - Flutter：`vue/renderer.ts` HTML 兼容表给 `<label>` 注入同样的 `margin: 4`，
     label 低 4px，占位文字行盒又比 label 行盒矮 4px（20 vs 24），合计错位约 6px；
   - 行高被撑到 52px（10 + 32 + 10），vant 真值是 44px（10 + 24 + 10）。
2. **label 文字颜色**：两端都渲染成兼容表默认的 `#666666`，vant 要求
   `.van-field__label` 的 `var(--van-field-label-color)` = `#323233`。
   同源问题还有 `font-size: 14` 默认值：它挡住继承，vant large cell 的
   label 字号（16px）在内层 `<label>` 上永远不会生效。
3. **placeholder 颜色只有 web 对**：vant 的
   `.van-field__control::placeholder { color: var(--van-field-placeholder-text-color) }`
   （= `--van-gray-5` = `#c8c9cc`）在 web 是原生 CSS，直接生效；Flutter 侧
   CSS 引擎只支持 `::before` / `::after`，`::placeholder` 规则整条被丢弃，
   输入框回落到 `input.dart` 的默认 hint 色 `#999999`——iOS 上占位文字比
   web/vant 明显偏深。

这三条都是「同一份 vant 源码，两端/两端与参照渲染不一致」，属于宪法 I 的
静默偏差：页面代码没法用任何 CSS 绕开（label 的 margin/color 来自 fjs 自己的
默认层，vant 又不会去给内层 `<label>` 写规则）。

## 2. 不做什么（Non-goals）

- 不改 vant 组件本身、不给 demo 页面加覆盖样式——问题在 runtime 的默认层与
  CSS 引擎，打补丁到页面上等于把 bug 固化。
- 不给 `label` 默认样式做「只在 fjs 自己的用法里生效」的条件判断：fjs 的
  `label` 标签和库渲染的原生 `<label>` 在镜像树里是同一个标签，没有可靠的
  区分依据；正确方向是默认值向浏览器 UA 行为收敛（margin 0、颜色/字号继承）。
- 不支持 `::-webkit-input-placeholder` 变体（Flutter 不是浏览器，只需要标准
  `::placeholder`；web 端由原生 CSS 处理）。
- `::placeholder` 上叠状态伪类（如 `:disabled::placeholder`）按引擎既有选择器
  能力自然生效，本 spec 不单独验证；vant 当前样式表没用到这种组合。
- 不动 `placeholder-style` 属性已有的四键契约（color / font-size /
  font-weight / line-height），两端解析器不变。
- 不处理小程序端的 `::placeholder`（见第 4 节已知差异）。

## 3. 用户可见的行为

改完后 `demo/src/pages/vant-form.vue` 一行不改，效果变成：

```vue
<!-- 页面代码保持原样 -->
<van-cell-group inset>
  <van-field v-model="name" label="姓名" placeholder="请输入" clearable />
</van-cell-group>
```

- Field 行高回到 44px（与 vant.pro 相同）；label「姓名」与占位文字「请输入」
  在同一水平中线上，label 贴 cell 内容左缘（x = cell 左 + padding）。
- label 文字 `#323233`，占位文字 `#c8c9cc`——iOS 与 web 逐像素一致。
- `<label>` 不再自带 margin/颜色/字号：页面/库写的 CSS（含通过继承生效的
  `color`、`font-size`）按标准 CSS 语义生效；hello-fjs 的 form 页
  （`<label class="row">` 自己写了 `margin: 0` 和 `color`）外观不变。
- 输入框没有任何 `::placeholder` 规则时，占位文字仍是 `#999999`
  （fjs 自己输入框的默认，web 的 `.fjs-input::placeholder` 同值）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| label 默认样式 | 无 margin/color/font-size 默认；`label` 仍是容器（列向） | base-css `label` 只留 `display:flex` / `flex-direction:column` / `cursor:pointer` |
| `::placeholder` | CSS 引擎解析规则，算出四键并落成元素的 `placeholderStyle` prop，`input.dart` 的 `_hintStyle` 消费 | 原生 CSS 直接生效（不变） |
| 占位默认色 | 规则缺失时 `#999999` | `.fjs-input::placeholder` 兜底 `#999999`，vant 规则优先 |
| 已知差异 | 小程序端：`::placeholder` 不在 Skyline/wxss 能力内，保持构建期丢弃（`fjs/src/mp/css.ts` 已按自己的过滤处理伪类；伪元素行为要在任务里核对一次） | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——**不涉及**：`placeholderStyle`
      走已有的 setProps 通道，Flutter 侧 `input.dart` 已经认识这个 prop
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（新增的是 CSS 引擎内部的伪元素种类 + 两个默认样式源的删减）

## 6. 验收标准

1. `pnpm run typecheck` 通过；`pnpm test` 通过（`css-support.test.ts` 中
   `parseSelector('input::placeholder')` 为 null 的旧断言按新行为更新）。
2. 单测：`parseSelector('.van-field__control::placeholder')` 解析出
   `pseudo: 'placeholder'`；混选规则
   `.a, .a::placeholder { … }` 拆成普通规则 + placeholder 规则；样式引擎为
   input 算出 `placeholderStyle` prop（规则消失时 prop 被清掉）。
3. 单测：`resolveHtmlTag('label')` 不再携带 `margin` / `color` / `fontSize`
   默认值；web `BASE_CSS` 的 `label` 规则同断言。
4. iOS 模拟器 `fjs run ios` 打开 demo → vant-form：
   - 单个 Field cell 高 44px（两行 label 文字行盒顶距 = 44，不再是 52）；
   - label 文字与占位文字的行盒垂直中心相差 ≤ 1px；
   - label 像素色 ≈ `#323233`，placeholder 像素色 ≈ `#c8c9cc`。
5. 同一时刻 web 端（`pnpm --filter demo run dev:web`，viewport 393px）
   量到相同数值：cell 高 44、label/占位中心对齐、两色一致。
6. `examples/hello-fjs` 的 form / radio 页（`<label class="row">`）两端
   打开无肉眼回归。
7. 文档同步：`docs/css-compat.md`（伪元素支持表 + label 默认值段落）、
   `docs/web.md`（placeholder 默认色段落）。

## 7. 待澄清

- 无。
