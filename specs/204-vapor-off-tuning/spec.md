# Spec: enableVapor:false 基线复验与 NutUI 调教

- **ID**: 204-vapor-off-tuning
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

用户把 `demo/src/main.ts` 的 `enableVapor` 改为 `false`——demo 从「全站 Vapor
编译（specs/177）」回到 VDOM 为主（仅 `<script setup vapor>` 页经
specs/165 包装器跑 Vapor）。要求**以这个配置的运行结果为准调教**。

## 2. 不做什么（Non-goals）

- 不把 vapor 模式的遗留问题（specs/203 §8 的 9 项）修完——只修
  `enableVapor:false` 基线下可归因、可在 demo 层修的。
- 不动三张运行时契约表（宪法 II）；CSS 引擎是否该支持 `inline-flex`
  属引擎决策，本 spec 只在 demo 层显式化约束。

## 3. 用户可见的行为

- `nutui: form` 在 VDOM 模式下整页渲染（此前 fjs 文本全灭）。
- `nut-switch` 36×21、checkbox/radio 图标 18px、`nut-input-number`
  150×30 横排——两端一致（`demo/src/styles/nutui-fix.css`）。
- `nutui: nav` 的 Swiper 有内容（不再塌 0 高）。
- `vant: scroll` 的 List 能加载数据（一次性加载到 finished，无滚动分页）。

## 4. 两端约定（宪法 I）

`nutui-fix.css` 无平台后缀、main.ts 引入，两端同一份；显式约束的数值照抄
NutUI 默认主题（对照各组件 index.css）。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter demo run typecheck` / `pnpm test` 通过。
2. web：9 个 nutui/vant 页面逐页渲染、无 `[object Object]` 注释节点。
3. App：form 页 Switch/Checkbox/Radio/InputNumber 形状正常；nav 页
   Swiper 渲染；scroll 页 List 出条目。

## 7. 过程发现

1. **`<script setup>` 的模板编译器把裸标签先按 setup 绑定解析**：
   `nutui/form.vue` 曾有 `const text = ref('')`，整页 `<text>` 被编译成
   `resolveDynamicComponent(text)` → ref 传入 createVNode → 渲染成
   `<!--[object Object]-->` 注释，页面所有 fjs 文本消失（无任何报错，
   宪法 V 的另一形态）。vapor 编译器没有这个 shadowing，所以 vapor 模式
   没暴露。binding 命名避开 `text` / `view` / `button` 等标签名。
2. **`display: inline-flex` / `display: var(--x, inline-flex)` 两端都不
   支持**（web 端按 specs/180 的 shrink-parity 与 App 对齐）→ NutUI 的
   Switch / InputNumber / Checkbox / Radio 根回落块级。`nutui-fix.css`
   显式补尺寸与 flex 方向；checkbox/radio 图标另因 App 端 em 不参与
   svg 尺寸计算（`font-size` + `width: 1em` 失效）需给 px。
3. **NutUI 图标的尺寸链整条断了**：icons-vue 组件把 width/height 声明为
   props 并转成内联 style，而 Checkbox/Radio 的 `iconSize`、InputNumber 的
   `buttonSize` 默认都是空串 → `pxCheck('')` 返回 `'px'`（非法值）→ 内联
   尺寸整条丢弃，两端都只剩 CSS `width: 1em`；App 端 em 不参与 svg 布局、
   svg 按 bounded width 铺满（巨大圆/溢出）。修法用库自己的 API：页面显式
   传 `icon-size="18px"` / `button-size="18px"`（web 端视觉不变）。教训：
   CSS 类选择器救不了 svg（`svg` 不是 fjs 已知标签，标签选择器不匹配；
   类选择器写了 px 也不产生 svg 画布需要的紧约束）——组件 props > CSS。
4. **Swiper 首帧测量为 0**：内层高度是 JS 量出来的（挂载帧子元素 rect 还
   是 0，specs/150 同款首帧问题；vant Tabs 有 rAF 重试而 Swiper 没有）→
   内层 inline height 0、整块不可见。修法用库的 `width`/`height` props
   （props 优先于测量，两端一致）；`vite/nutui.ts` 另给 `innerWidth` 读数
   390×844 兜底（dom-env 故意给 0，vant 从不依赖非零值）。
5. **vant List 的加载循环挂在滚动父级上**：App 端滚动父级探测不可靠
   （有时 undefined，有时探到零高祖先），`useRect` 高度 0，check() 在
   `!scrollParentRect.height` 处静默 return，load 永不触发。补丁：零高
   场景视为恒在边缘，走与几何路径相同的分支（loading + emit load，guard
   与 check 头部一致防重入）——列表一次性加载到 finished，无滚动分页
   （fjs scroll-view 的 scroll 事件到不了 List）。第一版补丁只 set
   loading 没 emit、且有 `scroller == null` 前提（实际探测有时非 null），
   均已修正；调试靠页面标题挂 `{{ items.length }}` 计数 + flutter 日志。
6. **Steps 圆点行横向溢出 2px** 触发 Flutter 溢出告警横幅——fix.css 给
   `.nut-steps { overflow: hidden }` 两端裁掉。
7. VDOM 模式下 nutui/nav 的 Tabs 标题正常（specs/203 §8 #6 的「标题丢失」
   是 vapor 互操作层问题，VDOM 基线不复现）；Switch/InputNumber/
   Checkbox/Radio 经本轮调教后两端形状一致。App 端遗留缺口收窄为：
   nut-noticebar 跑马灯文字、nut-image 网络图、vant List 无滚动分页
   （一次性加载，可用）。
