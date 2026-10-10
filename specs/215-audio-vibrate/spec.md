# Spec: ufjs 内置音频与震动能力（createAudio / vibrate）+ 打飞机 wx 适配

- **ID**: 215-audio-vibrate
- **状态**: done（App 端真机实跑为移交的手工项，见 tasks.md 末尾）
- **日期**: 2026-10-10
- **来源**: specs/214 的两个挂账降级项——`wx.createInnerAudioContext`（音频静音）
  与 `wx.vibrateShort`（震动 no-op）。214 spec 第 7 节明确"后续音频能力另立
  spec"，本 spec 就是那一个。

## 1. 要解决什么

ufjs 目前没有任何音频与震动能力：JS 侧（fjs-runtime）没有 API，Dart 宿主没有
对应模块。任何想在 App / Web 上发声、震动的页面（游戏、表单提示、通知）都做
不了，只能像 214 那样在适配层写 no-op 桩并 console.info 降级。

具体到打飞机页：背景音乐不响、子弹/爆炸音效不响、敌机被击落和玩家死亡没有
震动反馈。微信原版这两样都在，移植后体验明显缺一块。

## 2. 不做什么（Non-goals）

- **不做完整 wx `InnerAudioContext` 面**：`obeyMuteSwitch`、`onTimeUpdate`、
  `onWaiting/onSeeking/onSeeked/onCanplay`、`buffered`、`playbackRate`、
  `referrerPolicy` 等不在 v1。以游戏与一般提示音需要为准（见 §3 的面）。
- **不做音频录制、混音池、多实例 Pool**（audioplayers 的 `AudioPool` 那类）。
  一个 context 一个播放器，够用且边界清楚。
- **不改 op 协议、不加 C ABI**（宪法 II：invokeHost + dispatchEvent 范式够用）。
- **mp 端不新造能力**：微信本来就是 createAudio 能力最全的一端，wx 目标的
  'fjs' 桥把调用转发给真 `wx.createInnerAudioContext` / `wx.vibrateShort` 即可。
- 不做 `<audio>` 标签（DOM 有、fjs 标签集暂不加；命令式 API 先行）。

## 3. 用户可见的行为

### 3.1 ufjs 自有 API（`import { createAudio, vibrateShort, vibrateLong } from 'fjs'`）

```ts
const bgm = createAudio();
bgm.loop = true;
bgm.autoplay = true;
bgm.src = '/audio/bgm.mp3';          // 与 <image> 同一套 src 规则（§4）
bgm.onEnded = () => console.log('looped');

const sfx = createAudio();
sfx.src = '/audio/bullet.mp3';
sfx.currentTime = 0;                 // seek 到头再播 = wx 的重放习惯
sfx.play();
sfx.stop();  sfx.destroy();

vibrateShort('light');               // 'light' | 'medium' | 'heavy'（默认 heavy）
vibrateLong();
```

`FjsAudio` 的 v1 面：`src`（可写，赋值即加载）、`loop`、`autoplay`、
`volume`（0–1）、`currentTime`（可读可写）、`duration`（只读，未知为 0）、
`play()/pause()/stop()/destroy()`，回调 `onPlay/onPause/onStop/onEnded/
onError(message)`。

### 3.2 打飞机页（wx-adapter）

`wx.createInnerAudioContext()` 返回包着 `createAudio()` 的 wx 形状对象，
`wx.vibrateShort({type:'light'})` 直通 `vibrateShort('light')`。效果：进页面
bgm 循环响起；开火有子弹音；敌机爆炸有爆炸音 + 轻震；玩家撞机中震。三个音频
文件从原微信项目拷入 `public/plane-war/audio/`（bgm/bullet/boom.mp3）。

## 4. 两端约定（宪法 I）

src 解析与 `<image>` 完全同规则：`http(s)://` 原样；`/x`（含 `asset://x` 旧
写法）dev 下解析到 dev server、release 下落到 `assets/fjs/public/x`；裸相对
路径按根路径处理并 warn（与 `<image>` 的既有 warn 一致）。web 端由
`resolveImageSrc` 同款逻辑 + 浏览器原生解析兜底。

| | Flutter | Web |
|---|---|---|
| 播放 | audioplayers `AudioPlayer`（host 模块 `fjs.audio.*`） | `HTMLAudioElement` |
| src 解析 | `fjsResolveImageSource` 同款三分支；本地路径（dev URL / release 资产）在 create 时读成字节 `BytesSource`，显式远程 URL 用 `UrlSource` 流式 | 浏览器自己解析 |
| 震动 | `HapticFeedback`（light/medium/heavyImpact，long→`vibrate()`），host 模块 `fjs.vibrate` | `navigator.vibrate(ms)`：light 15 / medium 30 / heavy 50 / long 400 |
| 已知差异 | `duration/currentTime` 读到的是宿主侧缓存的最近位置；ohos 平台 audioplayers 无实现，warn 一次后静音（缺的通道显式说，宪法 V） | iOS Safari 没有 `navigator.vibrate`，warn 一次后不震；`onCanplay` 一类 v1 不提供 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）——不改：复用 invokeHost
- [x] 事件类型（`fjs.h` + `ffi.dart` + `fjs-runtime/src/audio/audio.ts`）：
  新增 `FJS_EVENT_AUDIO = 44`（43 已被 GLOBAL_POINTER_DOWN 占用）。音频不是
  节点、不进 `element.ts` 的 `EventType`（fetch 14 / async 32 同理，是系统
  事件），载荷 `{"t":"ended"|"error","err"?}`。
- 第三处：`fjs-runtime/src/wx/fjs-bridge.ts` 的 'fjs' 切片加同名导出
  （mp 端转发真 wx）。

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck`、`pnpm test` 通过（含新增
   audio/vibrate 的 vitest）。
2. Web 实跑（`fjs dev --web`）：打飞机页进页面 bgm 循环；开火/爆炸有音效；
   击落敌机、玩家死亡页面有震动反馈（Chrome/Android）；离开页面声音停止
   （destroy 路径真实生效）。
3. App 实跑：`fjs build` 通过；模拟器/真机上 bgm、音效、震动（`fjs run ios`
   或 fjs-go 连 dev）。环境不具备时至少：`cd packages/flutter_fjs &&
   flutter analyze` 干净 + 新增 Dart 单测通过，并写明剩余手工项。
4. `wx-adapter` 不再出现 no-op 桩与降级 console.info；hello-fjs README 的
   "已知降级：音频静音、震动 no-op" 一节改为实际行为。
5. 回归：打飞机之外的页面（demo、hello-fjs 其他页）不引 audioplayers 相关
   警告；`fjsrun`（无宿主模块的 CLI 跑法）下 createAudio 首次使用 warn 一次
   而不是抛栈。

## 7. 待澄清

- [x] 无。API 形状照 214 挂账的最小面 + wx 适配所需设计；依赖
  （audioplayers）的理由在 plan 里。

## 8. 变更记录

- 2026-10-10（同日第二条需求）：**audio 从内置改为模块包 `@ufjs/audio`**，
  vibrate 保持内置。理由与规则：host API 依赖三方 pub 就不进内核（audio 需要
  audioplayers；vibrate 只要 SDK 的 HapticFeedback）——立为宪法 IX，
  AGENTS.md §4 第 8/9 条同步。包结构见 `packages/fjs-audio/`（JS 入口
  native/web/wx 三 guts、Dart host 模块 `fjs_audio`、pubspec 的
  audioplayers），事件号 45 仍在 fjs.h/ffi.dart 中央分配、由模块派发。
  模块 JS 入口不 import 内核（宪法既有纪律），事件注册走运行时新发布的
  `__fjsRegisterSystemHandler` 全局。
- 同日补记（模块拆分落地后）：audio 全部迁入 `packages/fjs-audio`（JS 入口
  native/web/wx 三 guts；Dart host 模块 `fjs_audio` 走 `engine.addListener`
  做 reload 失效；hello-fjs 宿主经 `fjs host sync` autolink 验证）。拆分时
  踩到一个真陷阱并已修+回归：页面级 wx shim（打飞机适配层的
  `wx.createInnerAudioContext` 实现就是 `createAudio()`）会劫持 gut 探测造成
  无限递归——gut 顺序定为 native → Audio → wx（mp 无 Audio 全局，wx 恰好只
  在 mp 命中），测试 `audio-web.test.ts` 的 recursion guard 钉死。web 端
  重验：bgm 推进、score 增长、音频经 `@ufjs/audio` 全链路工作。hello-fjs 的
  autolink 由 `fjs host sync` / `fjs run` 生成（`fjs modules` 只打印）。
