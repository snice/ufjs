# Spec: iconfont 支持——`@font-face` 自定义字体在 App 端加载渲染

- **ID**: 071-iconfont-font-face
- **状态**: done
- **日期**: 2026-09-19

## 1. 要解决什么

vant 的全部图标（NavBar 返回箭头、Tabbar 图标、Cell 右箭头、Checkbox 对勾、
Rate 星星、Field 清除按钮、Grid 图标……）在 App 端是空白，web 端正常。
069/070 对拍一直把它登记为「iconfont 非目标」，但它是 vant 页面与 web 最显眼
的差异。同样的问题会出现在任何用 iconfont（阿里 iconfont、Font Awesome 等
`@font-face` + `::before { content: "\e..." }` 写法）的页面上。

现状逐层核对（2026-09-19，代码位置）：

1. **`@font-face` 整块丢弃**：`fjs-runtime/src/css/parser.ts:260` 把
   `@media` 以外的 at-rule 一律 `warnOnce` 跳过，字体从未到达 App。
2. **`font` 简写不展开**：vant 写的是 `.van-icon { font: normal normal normal
   14px/1 var(--van-icon-font-family, "vant-icon") }`。样式引擎把 `font` 原样
   下发（设备上实测 `"font":"normal normal normal 14px/1 \"vant-icon\""`），
   Dart 不认识 `font` 键，字体族、行高都丢了。
3. **`font-family` 值不解析**：`flutter_fjs/lib/src/render/style.dart:415`
   把 CSS 值原样当 Flutter family 名——带引号的 `"vant-icon"`、逗号分隔的
   字体栈（`-apple-system-font, helvetica neue, arial, sans-serif`）都解析
   不到，静默退回系统字体。
4. **私有区字形被主动置空**：`fjs-runtime/src/vue/renderer.ts:151`
   `isPrivateUseOnly` 把全在 PUA 的 `content` 清成 `''`（当初是为了不在
   没有字体时画方块/字面量）。
5. **字体格式**：vant 内联的是 `data:font/woff2;base64,…`。Flutter 的
   `loadFontFromList` / `FontLoader` 官方只支持 TTF/OTF（WOFF/WOFF2 需要
   先解压重建表），直接喂进去不保证可用。

## 2. 不做什么（Non-goals）

- **小程序端**：Skyline 的字体加载（`wx.loadFontFace`）另立项。
- **`font-display` / FOUT 控制**：字体异步加载期间先画空（或回退字体），
  加载完自动重排；不提供 `document.fonts` / `FontFace` JS API，不提供加载
  完成事件。
- **`unicode-range`、可变字体轴（`font-variation-settings`）、`local()` 源**：
  解析时 warnOnce 跳过该项。
- **`@font-face` 之外的 at-rule**（`@keyframes`、`@supports`、`@import`）维持现状。
- **系统通用族名映射**（`serif` / `sans-serif` / `system-ui`）不扩展，沿用
  现有 `monospace` 一条。

## 3. 用户可见的行为

页面代码不变，vant 标准写法两端都出图标：

```vue
<van-nav-bar title="标题" left-text="返回" left-arrow />   <!-- 左箭头出现 -->
<van-cell title="单元格" is-link />                        <!-- 右箭头出现 -->
<van-icon name="chat-o" size="24" color="#1989fa" />       <!-- 图标本身 -->
<van-rate v-model="rate" />                                 <!-- 星星 -->
```

应用自带的 iconfont 同样可用（相对路径字体文件在构建期转成 TTF 内联进样式）：

```css
@font-face {
  font-family: "my-icons";
  src: url("./fonts/my-icons.woff2") format("woff2"),
       url("./fonts/my-icons.ttf") format("truetype");
}
.icon-home::before { font-family: "my-icons"; content: "\e601"; }
```

- 字体栈按 CSS 语义解析：去引号、逗号分隔，第一个取主族，其余作为回退。
- `font` 简写展开为 `font-style` / `font-weight` / `font-size` /
  `line-height` / `font-family`（`var()` 先解析再展开）。
- 字体加载失败（格式不支持、地址不可达）：`warnOnce` 说明哪一个 family、哪个
  src 失败（宪法 V），该字体的 PUA 字形保持现状的「空装饰盒」降级。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `@font-face` | 构建期把 WOFF/WOFF2 转成 TTF；运行时解析 `@font-face`，经宿主调用加载进 Flutter 字体表（按 family 注册） | 浏览器原生 |
| 字体源 | `data:` URL；相对路径（构建期读入、转 TTF、内联为 data URL）；远程 `http(s)` 不支持（warnOnce 跳过该 src，继续尝试下一个） | 浏览器原生 |
| `font` 简写 / `font-family` 栈 | 样式引擎展开；Dart 去引号、主族 + fallback 列表 | 浏览器原生 |
| PUA 字形 | 元素的字体族命中已声明的 `@font-face` 时正常渲染；否则维持空装饰盒 | 浏览器原生（缺字体时空盒） |
| 已知差异 | 加载前后的首帧：App 先空后出图标（web 取决于 `font-display`）；`unicode-range` / 可变字体 / 远程字体源不支持；产物中字体为 TTF（体积约为 WOFF2 的 2–3 倍） | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 三张表都不涉及：新增一个宿主方法名 `fjs.font.load(family, dataUrl)`，走现有 `invokeHost` 通道（同 `fjs.canvas.loadImage`
      的注册方式），fire-and-forget，不回派事件。方法名登记进
      `docs/ui-api.md`。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`、`cd packages/flutter_fjs && flutter test`
   全绿。
2. 单测覆盖：
   - 解析器：`@font-face` 被提取为 {family, src 列表, weight, style}；
     `unicode-range` / `local()` 告警；其他 at-rule 仍告警跳过。
   - 样式引擎：`font` 简写展开（含 `var()` 回退值与 `size/line-height`）。
   - Dart：`font-family` 栈解析（引号、逗号、回退）；`fjs.font.load` 对
     `data:` TTF 加载后，PUA 字形按该字体排版（字宽等于字体里的 advance，
     而非回退字体）。
   - 构建：CSS 里的 `data:font/woff2` 被转成 TTF（产物断言）；相对路径字体
     被读入并内联为 TTF data URL。
3. iOS 模拟器 ↔ web 对拍：vant-nav（NavBar 返回箭头、Tabbar 三个图标）、
   vant-basic（Cell 右箭头、Grid 图标）、vant-form（Checkbox 对勾、Rate 星星）
   图标出现且位置/大小与 web 一致。
4. 故意写一个不存在的字体 src：App debug 日志出现指名 family 与 src 的告警，
   页面不崩溃、PUA 字形为空盒。
5. `docs/css-compat.md` 更新 `@font-face`、`font` 简写、`font-family` 三行，
   伪元素行删掉「iconfont 字形不渲染」的限制说明。

## 7. 待澄清

无。已拍板（2026-09-19）：

1. **WOFF/WOFF2 在构建期转成 TTF**：CLI 的 CSS 处理钩子里转码（新增一个
   WOFF2 解码依赖），App 运行时只接触 TTF。
2. **远程 `http(s)` 字体源 v1 不支持**：warnOnce 后跳过该 src、继续尝试
   `src` 列表的下一项；只支持 `data:` 与相对路径。
3. **`font` 简写在 JS 样式引擎完整展开**（字体族、字号、行高、字重、字形）；
   此前 App 端整条忽略，这是对齐 web 的行为变化，登记进 `docs/css-compat.md`。
