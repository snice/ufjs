# Spec: `width: fit-content`（App 端）

- **ID**: 138-css-fit-content
- **状态**: done
- **日期**: 2026-09-25
- **来源**: specs/137 对拍——App 端 vant 文字 Toast 铺满整行，web 收缩到文字宽度

## 1. 要解决什么

`width: fit-content` 在 App 端**静默失效**，按 `auto` 处理：

- JS 引擎 `normalizeValue` 把 `fit-content` 原样作字符串下发（`-webkit-fit-content`
  被后一条覆盖，同样走到这里）；
- Dart `parseLengthValue` 不认这个关键字 → `widthLength == null`，等同没写；
- 没有任何 `warnOnce`（违反宪法 V），`css-support.ts` 也没登记。

vant 里有两处依赖它，现象都是"本该收缩的盒子被撑满"：

| 规则 | 期望（web） | App 现状 |
|---|---|---|
| `.van-toast--text { width: fit-content; min-width: 96px }` + `.van-popup--center { left: 0; right: 0; margin: 0 auto }` | 黑色圆角条宽 = 文字宽 + padding，水平居中 | 铺满 `left: 0 → right: 0` 整行 |
| `.van-popup--center { width: fit-content; max-width: calc(100vw - 32px) }` | 居中弹层按内容收缩 | 被撑满；Dialog 因为 `.van-dialog { width: 320px }` 覆盖了才看不出来，自定义内容的居中 Popup（`<van-popup>` 默认 position center）会中招 |

`position: absolute/fixed` 的 `margin: auto` + 对边 + 尺寸居中已经支持（css-compat
§定位，vant 对话框）——缺的只是"尺寸按内容收缩"这一环。

## 2. 不做什么（Non-goals）

- `height: fit-content`（块方向的 fit-content 就是 auto 高度，App 端本来就是内容高；
  仅需确认不告警、不误改）。
- `fit-content(<length>)` 函数形式（grid 轨道用法，fjs 无 grid）。
- `min-content` / `max-content` 关键字（Q2：`warnOnce` + 登记）。
- row flex 子项上的 `width: fit-content`（flex-basis 语义，Q1：`warnOnce` 按 auto）。
- 不改 op 协议 / natives / 事件表：值是字符串，已有 `width` 通道。
- 小程序端（Skyline 原生 CSS，不经 fjs 布局）。

## 3. 用户可见的行为

页面 / 组件库照写标准 CSS，两端一致：

```css
/* 居中弹层按内容收缩（vant .van-popup--center + .van-toast--text 的形状） */
.toast {
  position: fixed; top: 50%; left: 0; right: 0; margin: 0 auto;
  width: fit-content; min-width: 96px; max-width: 70%;
  padding: 8px 12px;
}
```

- 盒宽 = clamp(min-width, 内容的 shrink-to-fit 宽度, min(max-width, 可用宽))，
  可用宽 = 包含块宽减去 left/right 与水平 margin 的非 auto 部分；
- `margin: 0 auto` + `left: 0; right: 0` 时在包含块里水平居中；
- 内容超过可用宽时换行（文字按可用宽折行），不溢出；
- vant 文字 Toast（`showToast('来自 showToast')`）App 端显示为居中的窄条，与 web 同宽
  （同字体下 ±1px 以内）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | Dart 解析 `fit-content` 为"收缩到内容"尺寸模式；定位盒（abs/fixed）走 shrink-to-fit + 现有 auto-margin 居中；在流内的范围见 Q1 | 浏览器原生 |
| 事件载荷 | 不涉及 | — |
| 已知差异 | 不支持的宽度关键字（`min-content` / `max-content` 若不做、`fit-content()` 函数）`warnOnce` 并按 auto 处理，登记 css-compat | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（`width` 已是字符串/数字通道，只是 Dart 多认一个关键字）

## 6. 验收标准

1. `cd packages/flutter_fjs && flutter test` 通过，新增 widget 测试：
   - fixed/absolute 盒 `left:0; right:0; margin:0 auto; width: fit-content` + 短文字：
     盒宽 = 文字宽 + padding，且水平居中；
   - 同上 + `min-width: 96px` 且文字很短：盒宽 96；
   - 同上 + 长文字 + `max-width: 70%`：盒宽 = 70% 包含块，文字折行；
   - flex column 子项 `width: fit-content`：不被 stretch，宽 = 内容宽。
2. `pnpm --filter @ufjs/runtime test` 通过：不支持的宽度关键字触发 `warnOnce`
   （`css-support.test.ts` 表↔引擎断言同步）。
3. `pnpm test`、`pnpm run typecheck` 通过。
4. demo `vant-feedback` 页在 Android 模拟器上点 showToast：Toast 为居中窄条；
   与 `pnpm --filter demo run dev:web`（375 宽）同页截图对拍宽度一致。
5. 居中 `<van-popup>`（默认 position，内容一行短文字）两端同为收缩宽度：
   demo 加一个对拍按钮，Android 与 web 截图一致。
6. 文档：`docs/css-compat.md` 盒模型表加 `fit-content` 一行；
   `docs/vant-adaptation.md` 删掉 specs/137 登记的"文字 Toast 铺满整行"差异。

## 7. 待澄清

- [x] **Q1 范围** → **定位盒 + 在流内**：absolute / fixed 盒 shrink-to-fit + auto margin
  居中；flex column 子项（fjs 默认 view）`width: fit-content` 不被 cross-axis stretch、
  收缩到内容（保留 auto margin 居中）；row 子项的 fit-content 仍 `warnOnce` 按 auto。
- [x] **Q2 `min-content` / `max-content`** → **只做 `fit-content`**，另两个 `warnOnce`
  + 登记 css-compat。
