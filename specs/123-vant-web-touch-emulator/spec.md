# Spec: web 端 vant 桌面鼠标可用（touch-emulator）

- **ID**: 123-vant-web-touch-emulator
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

demo 的 web 端（`vite` 5175）在桌面浏览器里，vant-nav 的 Search 输入后点右侧
清除图标，输入框不清空（只失焦）。原因不在 fjs：vant Field 的清除只监听
`touchstart`（`useEventListener("touchstart", onClear, { target: clearIcon })`），
鼠标点击不产生 touch 事件。手机模拟下派发 `touchstart` 可正常清空。
同一原因还影响 Slider / Swipe / Picker 的鼠标拖动。

## 2. 不做什么（Non-goals）

- 不在 fjs-runtime 的 web 适配层做全局鼠标→touch 转换（影响所有页面，改动面大）。
- App 端不变（触摸本来就是 touch 事件）。

## 3. 用户可见的行为

demo 新增 `src/plugins/vant-touch.web.ts`，引入 `@vant/touch-emulator`：
桌面浏览器里鼠标点清除即清空，vant 的拖动交互可用鼠标操作。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 清除 / 拖动 | 原生 touch，已可用（清除见 specs/122） | 桌面鼠标经 emulator 转 touch；真触摸设备 emulator 自行跳过 |
| 已知差异 | — | 仅 demo 接入；其他项目用 vant 需自行加同样的 `.web.ts` 插件（docs/vue3.md） |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

新增依赖：`demo` 的 `@vant/touch-emulator`（vant 官方、零依赖、MIT）。理由：
vant 文档对桌面端的推荐做法，自己实现等于重写它。

## 6. 验收标准

1. `pnpm --filter demo run typecheck` 通过
2. demo web：vant-nav Search 输入后鼠标点清除 → 输入框与回显都变空

## 7. 待澄清

- 无（方案已由用户选定：demo 接 touch-emulator）。
