# Spec: 微信小游戏「打飞机」原样移植到 hello-fjs（Web + App）

- **ID**: 214-minigame-plane-war
- **状态**: done
- **日期**: 2026-10-09
- **来源**: `/Users/zhe/WeChatProjects/minigame-1`（微信官方示例小游戏，874 行 JS
  + 24 张图 + 3 个音频，canvas 2D 游戏循环）

## 1. 要解决什么

微信小游戏只能在微信里跑。这份打飞机游戏想在 App（Flutter）和浏览器里玩——
放进 hello-fjs 的示例页组，作为「小游戏移植」的范式样例。

移植方式由需求方明确指定：**尽量不改游戏代码，原样 copy，加载一层 wx 适配层
直接跑**。也就是说 Sprite/Animation/Player/Enemy/Main 这些类保持微信上的写法
（`wx.createImage()`、`wx.onTouchStart`、`GameGlobal`、裸 `canvas` 全局），
适配层负责把这些 WeChat 全局补出来。

## 2. 不做什么（Non-goals）

- **不改 `minigame-1` 的任何游戏代码**——不重命名、不拆类、不改逻辑；允许的
  只有适配层与页面。
- **音频静音**：ufjs 没有 Audio 能力（fjs-runtime 与 Dart 宿主均无），
  `wx.createInnerAudioContext()` 在适配层返回 no-op 桩。bgm/子弹/爆炸音效
  本期不响，挂账给未来的音频能力 spec。
- **震动降级**：`wx.vibrateShort` 为 no-op。
- ~~不做性能调优（对象池、每敌机 19 帧爆炸图的重复加载等保持原样——微信上
  `wx.createImage` 就是这个用法，移植以行为一致为先）。~~ 性能仍以行为一致
  为先，但生命周期按验收反馈改为同微信：离开页面即销毁（rAF 垫片按表取消
  游戏帧 + gameAlive 闸门挡竞态逃逸），重进全新一局——不再作为降级项。
- 不做开放数据域、排行榜、登录等微信平台能力。

## 3. 用户可见的行为

hello-fjs 示例页「交互游戏」组多一页「飞机大战（微信移植）」：

```vue
<!-- 全屏 canvas，路由块 "tabBar": false, "scroll": false（同 tetris/watermelon） -->
```

- 进入页面：星空背景滚动，玩家飞机在底部，自动开火，敌机按帧生成；
- 手指按住飞机附近拖动：飞机跟手（接触判定 + 30px 容差，与原版一致）；
- 子弹命中敌机 +1 分，玩家撞机爆炸（19 帧帧动画）、游戏结束；
- 结束画面：游戏结束图 + 得分 + 「重新开始」按钮（点击区域重开）；
- 生命周期同微信：离开页面（返回、被新页面覆盖）游戏随页面销毁；重新进入
  是全新一局；
- App（fjs-go / 宿主）与浏览器同一份游戏代码、同一份适配层。

## 4. 两端约定（宪法 I）

本 spec 不新增运行时能力，页面行为全部走既有 canvas 契约
（[docs/canvas-compat.md](../../docs/canvas-compat.md)）：

| | Flutter | Web |
|---|---|---|
| 绘制 | `drawImage` 3/5/9 参、`fillText`、变换、`globalAlpha`——✅ | 同左（浏览器原生 2D） |
| 图片 | `loadCanvasImage` 句柄，未解码不画、解码后下一帧出现 | `HTMLImageElement` |
| 触摸 | `offsetX/offsetY` 相对画布 | 同左 |
| 循环 | `requestAnimationFrame`（宿主帧回调） | 浏览器 rAF |
| 已知差异 | `measureText` 亚像素不同（本游戏不量字）；音频两端都没有 | — |

适配层把触摸统一转成 `offsetX/offsetY` 进 `clientX/clientY`，所以游戏码里
`e.touches[0].clientX` 两端拿到的是画布内坐标，与摆放位置无关。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

demo 代码内的一处非契约修改：`examples/hello-fjs/src/adapters/leafer/platform.ts`
的 wx 平台判定从「存在 `wx`」收紧为「存在 `wx` **且** 有
`createOffscreenCanvas`」——真 wx 运行时必有它，而游戏适配层的 wx 没有。
不加这条，访问过打飞机页（keep-alive 存活）之后，leafer 页会把游戏 shim
当成微信运行时而走到 miniapp 分支。

## 6. 验收标准

1. 浏览器实跑（`fjs dev --web`）：进入页面画布出现背景/飞机/分数；敌机自动
   生成、子弹自动发射；几秒后 `GameGlobal.databus.score > 0`（游戏循环真实
   在跑的直接证据）；拖动飞机跟手；撞机后出结束画面、点「重新开始」能重开。
2. App 实跑：模拟器或真机（fjs-go 连 `fjs dev`，或 `fjs run`）同样四步；
   若环境不具备，至少 `fjs build`（app 目标）通过 + `fjsrun` 冒烟 +
   明确写明剩余的手工验证步骤。
3. `pnpm --filter hello-fjs run typecheck`、`pnpm --filter hello-fjs run
   build:pages` 通过（`.js` 游戏码不进 tsc，经 `@ts-expect-error` 的动态
   import 引入）。
4. 回归：访问过打飞机之后再打开「消消乐 LeaferJS」，绘制与圆角矩形正常
   （wx 判定收紧生效）。
5. leafer、tetris、watermelon 等既有游戏页行为不回归（build 后抽查打开）。

## 7. 待澄清

- [x] 无（"不改游戏码、适配层直接跑" 已由需求方拍板；音频缺失按静音降级，
  后续音频能力另立 spec）。
