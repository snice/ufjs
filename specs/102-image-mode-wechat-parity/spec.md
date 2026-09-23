# Spec: image mode 对齐微信小程序——位置类 mode 的「不缩放」与 heightFix 的宽优先

- **ID**: 102-image-mode-wechat-parity
- **状态**: done
- **日期**: 2026-09-23
- **来源**: 用户要求「对比小程序测试下不同 mode，需要对应小程序效果」，
  先对比 web 与小程序（微信开发者工具已开）。

## 1. 要解决什么

`examples/hello-fjs/src/pages/comp/basic/image.vue` 在 web 与微信小程序
（`dist/mp`，`app.config.ts` renderer=webview）上逐 mode 对拍：小程序端用
miniprogram-automator 逐个点 mode 按钮截 simulator（390×762，scale 0.9），
web 端同 viewport 截图，把图片框归一到 160×96 比平均灰度差（MAD，同一渲染的
底噪 = 11–24，来自解码器与缩放算法差异）。14 个 mode 只有 4 个对得上，
两组不一致：

### A. 9 个位置类 mode 语义完全不同

`top` / `bottom` / `center` / `left` / `right` / `top left` / `top right` /
`bottom left` / `bottom right`：

- **微信**：**不缩放**，1:1 原始像素按位置开窗裁剪（官方文档逐条写
  「不缩放，仅显示顶部区域」这类措辞）。
- **我们（web 与 Flutter 同源）**：`object-fit: cover` + `object-position` /
  `BoxFit.cover` + `Alignment`（spec 010 定的），即等比缩放后再对齐裁。

实测把源图模拟成 fill / cover / natural(1:1) / contain 四种假设去拟合小程序实拍：

| mode | fill | cover | **natural 1:1** | contain |
|---|---|---|---|---|
| 小程序 top | 57.1 | 56.2 | **24.1** | 56.9 |
| 小程序 bottom | 74.3 | 74.5 | **12.1** | 76.3 |
| 小程序 center | 70.4 | 70.7 | **17.4** | 72.4 |
| （web top 对照） | 40.6 | **21.5** | 54.3 | 43.7 |

小程序端压倒性匹配 natural（1:1），web 端压倒性匹配 cover；身份对比
`web[mode]` vs `mp[mode]` MAD 47–71，是底噪的 2–5 倍。旁证：小程序
`top` vs `bottom` MAD = 75.7（1:1 窗口位移 229px），web 只有 35.6
（缩放后只挪 16px）。

这属于宪法 I 的静默偏差：同一份页面两端渲染不同，页面代码无法绕开
（mode 是组件契约），而且 `docs/ui-api.md` 的 mode 表把 cover 写成了语义，
文档把错误固化了。

### B. heightFix 在「样式同时声明 width 和 height」时不同

同一张600×400 图、同一 CSS：

| 实例 | CSS | 小程序 | web / Flutter |
|---|---|---|---|
| `.mode-image` | `width: 280px; height: 170px` | **281×187.8**（宽按声明、高按比例推导 = **等同 widthFix**，与 widthFix 实拍 MAD 0.4） | **257×170**（高按声明、宽按比例推导） |
| `.local-portrait` | `height: 64px`（无 width） | 32×64 | 32×64 ✓ 一致 |

即微信的规则是「**声明了 width 就以宽为准**（heightFix 退化成 widthFix），
否则以 height 为准」；spec 010 把 heightFix 写死成「一律以高为准」。
页面上 width 和 height 同时写死是最常见的写法，这一条是可见的两端不一致。

## 2. 不做什么（Non-goals）

- **不改小程序端**：微信原生 `<image>` 就是参照物。
- **不动已对齐的四个**：`scaleToFill` / `aspectFit` / `aspectFill` /
  `widthFix`（MAD 11–24 底噪），以及 `mode` 压过 `fit` 的优先级。
- **不处理宽高都未声明的 fix 退化**与「`widthFix` 却没写 `width`」的既有
  warn 路径（未实测，保持现状）。
- **不处理 image 默认盒差异**：web `.fjs-image { max-width: 100% }`
  小程序没有对应默认，未声明尺寸时两端默认盒本来就不在一条线上，
  记进第 4 节已知差异，本 spec 不修。
- 不引入 op 协议（`ops.ts` / `ui_ops.dart`）、natives 表、事件类型变更。
- 不改 `examples/hello-fjs` 页面代码——它已经是回归场。
- 不新增 npm / pub 依赖。

## 3. 用户可见的行为

改完后页面代码一行不改，效果变成：

```vue
<!-- 位置类 mode：1:1 开窗，不缩放（对齐微信） -->
<image :src="src" mode="top" class="mode-image" />
<!-- .mode-image { width: 280px; height: 170px } -->
<!-- 改前：整图等比缩到 280 宽、贴顶裁底（cover） -->
<!-- 改后：原图 600×400 里的 280×170 窗口，顶部对齐，其余裁掉 -->

<!-- heightFix：宽度声明了就以宽为准（对齐微信） -->
<image :src="src" mode="heightFix" class="mode-image" />
<!-- 改前 257×170（高按 170），改后 280×186.7（宽按 280、高按比例） -->

<!-- 只声明 height 时行为不变 -->
<image :src="portrait" mode="heightFix" style="height: 64px" />
<!-- 仍然 32×64 -->
```

- 位置类 mode 的盒子尺寸不变（仍按样式），变化的只有**盒内画的是原图的
  哪一部分、以什么缩放画**；盒子大于原图时按对齐露出原图 1:1，其余露出
  盒子背景色（和小程序一致，`object-fit: none` 已验证裁剪在盒内）。
- `widthFix` / `heightFix` 仍在原图 metadata 到达后才定另一边；到达前按
  样式声明的那一边撑出占位盒（和现状一致，父布局不抖）。
- `@load` / `@error` 载荷、`fit` 兼容、未知 mode 告警降级全部不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 位置类 mode | `BoxFit.none` + 既有 `Alignment` | `object-fit: none` + 既有 `object-position` |
| heightFix（width 已声明） | `SizedBox(w, w / ratio)`（走 widthFix 同一支） | 不覆盖 width，量到用宽后把 `height` 钉成 `w * h / w`（`align-self: flex-start` 先取消拉伸） |
| heightFix（width 未声明） | `SizedBox(h * ratio, h)`（现状） | 现状：宽度交浏览器按 `height × ratio` 推导 |
| 事件载荷 | `{"width":n,"height":n}` 不变 | 同左 |
| 已知差异 | ① 未声明尺寸的 image 默认盒两端不同（web `max-width:100%`、内容盒；小程序 320×240 UA 默认），本 spec 不修；② web 量的是**布局用宽**（含百分比/max-width 的结果），Flutter 读的是**声明宽**，两者在本 spec 验证的写法（显式 px）下相等 | |

小程序端（native）不改，是上表两侧共同的参照。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

mode 是组件 prop、解析在两端各自的渲染路径里（`image/mode.ts` ↔
`render/image_mode.dart`），协议与边界零变更。

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过，且 `image-mode.test.ts` 断言 9 个位置类 mode 解析成
   `objectFit: 'none'`、`web-image.test.ts` 断言 heightFix 不再写
   `width: auto`（改为钉高路径）。
3. `cd packages/flutter_fjs && flutter test` 通过：`image_test.dart` 断言
   位置类 mode 解析成 `BoxFit.none`，widget 尺寸断言「width 和 height 同时
   声明时 heightFix 得到 `280 × 186.67`」、「只声明 height 得到 `32 × 64`」。
4. 小程序对拍复验（脚本在 `/tmp/mp-auto/`，读 `/tmp/shots/{web,mp}`）：
   重跑 web 端14 张截图后——
   - 9 个位置类 mode 的 `web[mode]` vs `mp[mode]` MAD 全部落进 11–24 底噪带；
   - `heightFix` 的 web 盒子变成 281×188（与小程序 281×187.8 同）、且与
     `widthFix` 的 MAD ≤ 5；
   - 已对齐的四个 mode MAD 不劣化（仍在 ≤ 24）。
5. 页面操作验收：`pnpm --filter hello-fjs run dev:web` 打开
   `#/comp/basic/image`，逐个点 14 个 mode，与微信开发者工具里
   `dist/mp` 同页逐个对照，位置类 mode 的取景一致（`top` 显示原图顶部
   1:1 窗口而非缩放贴顶）、heightFix 盒子比 widthFix 之外的 mode 更高一截。

### 验收结果（2026-09-23，全部通过）

身份 MAD（`web[mode]` vs `mp[mode]`，同一渲染的底噪带 = 11–24）：

| | scaleToFill | aspectFit | aspectFill | widthFix | heightFix |
|---|---|---|---|---|---|
| 改前 | 12.9 | 11.4 | 18.6 | 23.7 | 19.1（盒子 257×170，与 mp 的 281×188 不同） |
| 改后 | 12.9 | 11.4 | 18.6 | 23.7 | **23.6（盒子 281×188，双端一致）** |

- 9 个位置类 mode：改前 47.1–70.7 → **改后 8.1–18.8**，全部进底噪带，
  而且每一行的最优匹配都落在同名 mode 上（改前全部错配到
  `scaleToFill` / `aspectFill`）；
- `web[heightFix]` vs `web[widthFix]` = **0**（同解，要求 ≤ 5）；
- `web[top]` vs `web[bottom]` = 72.3，与小程序的 75.7 同量级（改前只有
  35.6，正是「缩放后只挪 16px」的旧语义）；
- 对照图：`/tmp/shots/evidence-{top,bottom,center,heightFix,aspectFill}.png`
  （左 web / 右 mp）。

## 7. 待澄清

无（「需要对应小程序效果」已由用户拍板：以微信实拍为准，包括 heightFix
在宽高都声明时退化成 widthFix 这一取舍）。
