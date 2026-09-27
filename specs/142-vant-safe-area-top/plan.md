# Plan: 142-vant-safe-area-top

## 1. 复现与定位（已做完，记录结论）

复现环境：iOS 模拟器（iPhone 17 / iOS 26.5）+ demo 自身的 `fjs run ios`，
操作走 agent-device（无障碍树点按 + 截图）。

- **showNotify**：弹出后通知条从 y=0 开始，"10:33" 状态栏文字直接压在绿色
  通知条上。Notify 根是 `.van-popup.van-notify`（`position: fixed; top: 0`，
  vant `notify/Notify.mjs` 经 Popup 渲染），命令式调用 hoist 进 app 级浮层
  宿主，宿主不让 safe-area（docs/overlay-host.md §5）。
- **showImagePreview close**：close 图标（`i` → fjs `text` 标签）定位在
  `top: var(--van-image-preview-close-top)` ≈ 27pt，处于状态栏区域。探针：
  - 点图标中心 (374, 27)：无任何反应；
  - 同一预览点图片 (200, 300)：走 `closeOnClickImage` 正常关闭；
  - 点遮罩 (374, 65/70/80)：走 `closeOnClickOverlay` 正常关闭；
  - 顶部探针页（页面上临时放一个 `position: fixed; top: 0` 的按钮）同样
    点不动 —— 顶部 ~62pt 横条内的点击不达应用，与哪个宿主无关。
    62pt = iPhone 17 状态栏高度。**该现象不在本 spec 修复**，登记到
    docs/overlay-host.md 已知差异。
  - 冷启动后不开 Notify 直接开预览，close 依旧点不动 —— 排除
    "Notify 残留元素挡住顶部"。

## 2. 改哪些层

只改 demo 的 vant 适配层 `demo/vite/vant.ts`（该文件的职责就是"每个项目
自带它所用组件库的 App 端适配补丁"，web 构建不经过 `fjs.app` hook）：

1. **Notify**（`vant/es/notify/Notify.mjs`）：Popup 的 default slot 包一层
   `<safe-area edges="top">`。通知条着色区域含状态栏（沉浸式），文案/图标
   下移到状态栏以下。
2. **ImagePreview**（`vant/es/image-preview/ImagePreview.mjs`）：
   `renderClose` 在 `closeIconPosition === 'top-right'` 时把 Icon 包进
   `<safe-area edges="top">`（wrapper 承担 `position: absolute; top: 0;
   right: 0; z-index: 1`，Icon 改 `position: static` 保留尺寸/配色类），
   点击事件挂在 wrapper 上（命中区更大，Icon 的 tap 会 bubble 上来）。
   其它位置（bottom-left 等）原样返回，不包。

两端原语已有：App = `_SafeAreaNodeAdapter`（Flutter `SafeArea`），
web = base-css 的 `safe-area { padding-top: env(safe-area-inset-top) }`。
无 op 协议 / natives / Dart 改动。

## 3. 顺序

1. `demo/vite/vant.ts` 加 2 组补丁（锚字符串对 vant 4.10.2 源码逐一核对）。
2. `fjs run ios` 热重载验收（模拟器操作 + 截图）。
3. typecheck / pnpm test / build:web。
4. docs：overlay-host.md 已知差异表加一行（状态栏区域点击不达 + 顶部锚定
   组件的适配模式）；fjs-go.md 开头补一句"调试单个项目优先 `fjs run`"，
   避免再被引到 fjs-go。

## 4. 宪法自查

- I 两端同源：App 端补丁是既有的 vant 适配层模式；web 桌面端行为不变。
- II 边界即契约：不涉及。
- V 静默失效是 bug：补丁锚字符串失配时 vite 插件已有 warnOnce 机制
  （`[vant] app patch did not apply`），沿用。
- VII JS 能包就不要下 Dart：全在 JS 侧适配层。
