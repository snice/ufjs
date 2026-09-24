# Spec: web 鼠标拖动滚动尊重 touchmove 的 preventDefault

- **ID**: 127-web-drag-pan-respects-touch
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

demo web 端（桌面浏览器）vant-nav 页打开 Popup + Picker，鼠标拖动选择器列：
选择器在转，**底层页面也跟着滚**（实测拖 120px，页面 scrollTop 472 → 592）。

**根因**：web 的 `scroll-view` 在桌面上自己实现鼠标拖动滚动
（`web/components/gestures.ts` `dragPanBindings`），只在路径上有元素声明
`touch-action` 时让路。vant 的 Popup 不 teleport，就在页面 scroll-view 里；
PickerColumn 靠 touchmove 里 `preventDefault()`（经 `@vant/touch-emulator`
把鼠标转成 touch）阻止滚动——手机浏览器上这会让原生滚动不发生，但
dragPan 看不到它。

## 2. 不做什么

- 不改 App 端（Popup 经 overlay host 不在页面滚动容器内；触摸由 Flutter 竞技场处理）。
- 不改滚轮行为（实测滚轮在选择器上不带动页面）。
- 不改 vant、不改 demo 页面。

## 3. 用户可见的行为

页面零改动。桌面浏览器里鼠标拖动时，若这次拖动产生的 `touchmove`
（真实或模拟器派发的）被页面 `preventDefault()`，scroll-view 不滚动，
已拖出的位移撤回，与手机浏览器上"touchmove 被阻止则不滚"一致。
没有 touch 监听、或监听里不阻止的，照旧鼠标拖动滚动。

## 4. 两端约定

| | Flutter | Web |
|---|---|---|
| 行为 | 不变：touch 与滚动由竞技场裁决 | dragPan 在捕获阶段看 touchmove，派发结束后 `defaultPrevented` 则放弃本次拖动 |
| 已知差异 | 无新增 | — |

## 5. 契约变更

- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter @ufjs/runtime test` 通过；新增测试：拖动过程中一个被
   `preventDefault` 的 touchmove（目标元素上 `stopPropagation`）→ scroller 的
   scrollTop 回到拖动前且后续移动不再滚动；未被阻止的 touchmove 不影响拖动。
2. 浏览器 localhost:5175/#/vant-nav：Popup Picker 上鼠标拖动，页面 scrollTop 不变，
   选择器正常转动；Popup 外空白处拖动页面仍可滚动（弹窗关闭时）。

## 7. 待澄清

无。
