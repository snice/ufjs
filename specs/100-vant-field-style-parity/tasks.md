# Tasks: vant Field 样式对齐——label 默认样式与 ::placeholder

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 断言现状：`parseSelector('input::placeholder')` 为 null、
      `resolveHtmlTag('label')` 带 `margin/color/fontSize`——先写回归测试钉住"错的样子"，改完翻转

## 实现

- [x] T010 label 默认值：`vue/renderer.ts` HTML 兼容表 `label` 项删 `style`，
      注释改写为"向浏览器 UA 收敛、不再自带 margin/色/字号"
- [x] T011 label 默认值：`web/base-css.ts` `label` 规则删 `margin` /
      `font-size` / `color`，保留 `display:flex` + `flex-direction:column` +
      `cursor:pointer`，注释同步
- [x] T012 `css/support.ts`：`SUPPORTED_PSEUDO_ELEMENTS` 加 `placeholder`
- [x] T013 `css/parser.ts`：`pseudo` 联合类型、`parseSelector` 的
      `::placeholder` 尾缀、规则拆分 kind 列表三处加 `'placeholder'`
- [x] T014 `css/style.ts`：`PseudoStyles.placeholder`、匹配期收集
      `placeholderDecls`、计算与 `pseudoChanged` 比较纳入，装饰盒路径不受影响
- [x] T015 `vue/renderer.ts` styleEngine 回调：`pseudo.placeholder` →
      宿主元素 `placeholderStyle` prop（四键，缺省键不写）；无 placeholder
      样式时删 prop

## 两端对齐

- [x] T020 Web 侧验证：label 规则删减后 vant-form / hello-fjs form 页无回归；
      `::placeholder` 仍由原生 CSS 生效（不需要新代码）
- [x] T021 两端行为对拍：iOS 模拟器与 web 同时量 cell 高 44、label 与占位
      中心差 ≤1px、label `#323233`、placeholder `#c8c9cc`
- [x] T022 小程序核对：`fjs/src/mp/css.ts` 的 Skyline 过滤对 `::placeholder`
      仍是丢弃，不会把新解析出来的规则漏进 wxss

## 测试

- [x] T030 `css-support.test.ts`：`input::placeholder` 方言翻转为
      `pseudo: 'placeholder'`；混选规则拆分用例
- [x] T031 样式引擎用例：input 命中 `::placeholder` → 宿主收到
      `placeholderStyle` prop；规则移除 → prop 被删；before/after 装饰盒不误生成
- [x] T032 `html-tag-defaults.test.ts`：label 默认值不再含
      `margin/color/fontSize`；`BASE_CSS` label 规则同断言
- [x] T033 `pnpm test` 全绿

## 文档

- [x] T040 `docs/css-compat.md`：伪元素支持表加 `::placeholder` 行为与限制；
      "不再是 HTML 兼容标签"段落里 label 默认值描述更新
- [x] T041 `docs/web.md`：placeholder 默认色段落改成"无规则时 `#999999`，
      有 `::placeholder` 规则两端都按规则"
- [x] T042 `docs/roadmap.md` 如有对应条目则勾掉（无则跳过）

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对（含 iOS ↔ web 像素对拍）
