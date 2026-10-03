# Spec: release 的 shared chunk 保留被动态读取的名字

- **ID**: 200-shared-dynamic-names
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

demo（`enableVapor: true`）在 profile / release 构建下，两个 vant 页面问题同时出现，debug 下却正常：

1. `vant: more` 的 `van-text-ellipsis` 不截断、没有「展开」；
2. `vant: nav` 的 `van-number-keyboard` 点键盘外面关不掉。

根因：release 的 shared chunk 只导出各页面 / 入口**静态 import** 的名字（specs/169 的收窄）。
`demo/src/plugins/vant/dom-env.ts` 是 vant 的 DOM 垫片，只通过
`globalThis.__FJS_SHARED['fjs/vue']` 动态读 `styleEngine`、`onGlobalPointerDown`、`measureTextBlock`
——没有静态 import，收窄时扫不到，这三个名字被剔出 `fjs/vue` 的导出表
（实测 `fjs build --pages --release` 的 shared.js：`fjs/vue` 只剩 `registerStyles`）。于是
`resolvedStyle()` 恒为 `{}`（TextEllipsis 量不出行高 / 宽）、`onGlobalPointerDown` 为 undefined
（点击外部的订阅不建立）。dev 构建保留整个命名空间，所以 debug 没事。

## 2. 不做什么（Non-goals）

- 不改 dom-env.ts（改静态 import 会让 web 构建去解析 Flutter 的 `fjs/vue` 导出）。
- 不放宽 release 的收窄（仍只导出用到的名字）。
- 不为任意第三方的动态读取开口子：只保留 runtime 自己约定给 DOM 垫片用的这几个。

## 3. 用户可见的行为

release / profile（烘焙）构建下，`__FJS_SHARED['fjs/vue']` 一定带有 `styleEngine`、
`onGlobalPointerDown`、`measureTextBlock`，与 debug 一致；vant 的 TextEllipsis 截断、
NumberKeyboard 点外部关闭恢复。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 修在 `packages/fjs/src/bundler/build.ts`（Flutter 分包构建的 shared 入口）| web 构建不走 `__FJS_SHARED`，不受影响 |
| 已知差异 | 无 | 无 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. 新用例：`collectSharedImports` 的结果里，即使没有任何静态 import，`fjs/vue` 也带 `styleEngine /
   onGlobalPointerDown / measureTextBlock`；`fjs/vue` 已是 `'*'` 时保持 `'*'`；不在 shared 列表里的
   specifier 不被凭空加入。去掉修复必挂。
2. 对 demo 跑 `fjs build --pages --release`，shared.js 里 `fjs/vue` 的导出对象含这三个名字。
3. `pnpm test`、`pnpm run typecheck` 通过。
4. 真机 / 模拟器用烘焙构建（`fjs run ios --profile`，无 `--`）：vant: more 的 TextEllipsis 两行截断带
   「展开」；vant: nav 弹出键盘后点外面关闭。（模拟器不支持 profile AOT，则用 `--release`
   不可行时以 2 + 单测为准并如实说明。）

## 7. 待澄清

无
