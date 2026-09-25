# Tasks: vant 命令式弹层 App 端可用

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不涉及 op 协议 / natives / 事件类型（游离根只用 Create / Insert / Remove）——无文件改动

## 实现

- [x] T010 加 `createDetachedRoot()` / `releaseDetachedRoot()` 与 `detachedRoots` 记账 —— `packages/fjs-runtime/src/vue/renderer.ts`
- [x] T011 `hostForLevel` 先判"祖先是游离根 → app 宿主"，排在 `pageRootOf` 回退之前 —— `packages/fjs-runtime/src/vue/renderer.ts`
- [x] T012 `setConnectedResolver` 把 app 宿主根算作已连接（body 语义）—— `packages/fjs-runtime/src/vue/renderer.ts`
- [x] T013 从 `fjs/vue` 导出两个函数 —— `packages/fjs-runtime/src/vue/index.ts`
- [x] T014 shim `createApp` 抛错文案指向 `fjs/vue` 的 createApp + 游离根 —— `packages/fjs-runtime/src/vue/vue-shim.ts`
- [x] T015 `mount-component.mjs` 两个补丁（import 改 `fjs/vue`；挂载/卸载改游离根）—— `demo/vite/vant.ts`
- [x] T017 （plan §6 新增）`belongsToNoPage` 取代游离根判定；insert 移动路径走 `hostForLevel`；`releaseDetachedRoot` 清 hoist 出去的后代 —— `packages/fjs-runtime/src/vue/renderer.ts`
- [x] T018 （plan §6 新增）引入 notify / image-preview 样式 —— `demo/src/plugins/vant.ts`
- [x] T019 （plan §6.4/6.5 新增）`font-size: 0` 夹到不可见正值；嵌套 touch 节点按引用计数保留手指 —— `packages/flutter_fjs/lib/src/widgets/text.dart`、`packages/flutter_fjs/lib/src/render/touch.dart`，测试 `test/font_size_zero_test.dart`、`test/touch_event_test.dart`
- [x] T016 探针页改真实调用：showToast / showConfirmDialog / showNotify / showImagePreview —— `demo/src/pages/vant-feedback.vue`

## 两端对齐

- [x] T020 Web 侧：确认补丁只挂在 `fjs.app` hook，web 构建 vant 原样（`pnpm --filter demo run build:web` 无补丁痕迹）—— `demo/vite/vant.ts`
- [x] T021 两端对拍：vant-feedback 四个调用在 Android 模拟器与浏览器上各跑一遍（差异：文字 Toast 宽度，plan §6.6）

## 测试

- [x] T030 JS 单测：游离根 mount 第二个 app → Teleport 进 app 根；fixed 元素 hoist 进 app 根且不进页面宿主；release 后记账清空 + Remove；app 根内元素 `isConnected` 为 true —— `packages/fjs-runtime/test/vue_overlay_level.test.ts`
- [x] T031 `flutter test` 回归（Dart 零改动）—— `packages/flutter_fjs`

## 文档

- [x] T040 命令式 Toast/Dialog 从"App 端不可用"改为"可用 + 机制" —— `docs/vant-adaptation.md`、`docs/vue3.md`、`docs/third-party-components.md`
- [x] T041 游离根 / 无页面 fixed 元素一条 —— `docs/overlay-host.md`
- [x] T042 `docs/roadmap.md` 若有对应条目则打勾

## 验收

- [x] T050 `pnpm run typecheck` + `pnpm --filter demo run typecheck`
- [x] T051 `pnpm test` + `flutter test`
- [x] T052 spec.md 第 6 节逐条核对
  - 1 ✅ runtime 777 通过（新增游离根 / connected 两条）
  - 2 ✅ flutter 530 通过——与 spec 预期不同，Dart 有改动（plan §6.4/6.5 两个既有缺陷）
  - 3 ✅ `pnpm test`、workspace / demo typecheck exit 0
  - 4 ✅ dev server 无 "[vant] app patch did not apply"
  - 5 ✅ Android：Toast / Loading Toast / Dialog 确认+取消 / Notify / ImagePreview 滑动+关闭；
    Dialog 与预览打开时物理返回被拦，关闭预览后物理返回离开页面
    （Toast、Dialog 用过之后单例处于隐藏状态时返回是否放行，这一轮因模拟器被并发操作没有测成）
  - 6 ✅ web（vite 5199，375 宽）四个调用正常；差异：文字 Toast 宽度（plan §6.6，已登记）
  - 7 ✅ 文档四处 + roadmap

## 追加：forbidClick 锁点击（用户对拍发现，2026-09-25）

现象：`showLoadingToast({ forbidClick: true })` 期间，web 上 Toast 外部点不动，App 上
点击透传到页面。原因：vant `toast/lock-click.mjs` 给 `document.body` 加
`van-toast--unclickable` 类，靠 `.van-toast--unclickable * { pointer-events: none }`
锁住整页；App 端 dom-env 的 `body.classList` 吞掉写入，锁不存在。

- [x] T060 `lock-click.mjs` 补丁：锁定时在游离根里挂一个全屏 fixed、带空点击处理的透明
  拦截层（经 hoist 进 app 级宿主，盖住所有页面），解锁时卸载 —— `demo/vite/vant.ts`
- [x] T061 设备验证：loading Toast 期间点页面按钮不响应，Toast 关闭后恢复；普通 showToast
  不锁（与 web 一致）；web 行为不变（补丁只挂 `fjs.app` hook）
  - Android：loading Toast 期间点 showNotify 无反应；关闭后点即弹出；普通 Toast 期间点即弹出
- [x] T062 文档：`docs/vant-adaptation.md` 补丁清单 +1 条

