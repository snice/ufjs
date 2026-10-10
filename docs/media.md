# 音频与震动

> specs/215。两个平台能力，两种归属：**震动是内置**（只依赖 Flutter SDK），
> **音频是模块包 `@ufjs/audio`**（它的 Flutter 半边需要 audioplayers，三方
> pub 依赖不进内核，宪法 IX）。三个目标端同一份页面源码。

```ts
// 震动：内置，从 'fjs' 来
import { vibrateShort, vibrateLong } from 'fjs';
vibrateShort('light');          // 'light' | 'medium' | 'heavy'（默认 heavy）
vibrateLong();

// 音频：模块包
import { createAudio } from '@ufjs/audio';
const bgm = createAudio();
bgm.loop = true;
bgm.autoplay = true;
bgm.src = '/audio/bgm.mp3';     // 与 <image> 同一套 src 规则
bgm.onEnded = () => {};

const shot = createAudio();
shot.src = '/audio/shot.mp3';
shot.currentTime = 0;           // wx 的重放习惯：seek 到头
shot.play();
```

装法：`npm i @ufjs/audio`（或 workspace 依赖）。autolink 自动把它 pub 侧的
`fjs_audio` 写进宿主并在 `runApp` 前调 `FjsAudio.register(engine)`——应用
不用配置任何东西。

## API 面（v1）

`createAudio(): FjsAudio`——属性 `src`（可写，赋值即加载；重赋值换源）、
`loop`、`autoplay`（**在 `src` 赋值前设置**；赋值顺序无关，wx 代码的惯例是
先 loop/autoplay 后 src）、`volume`（0–1）、`currentTime`（可读可写）、
`duration`（只读）；方法 `play() / pause() / stop()`（停并回零）/ `destroy()`；
回调 `onPlay / onPause / onStop / onEnded / onError(message)`。

明确**不做**（wx `InnerAudioContext` 有而 v1 没有的）：`obeyMuteSwitch`、
`playbackRate`、`buffered`、`onTimeUpdate/onWaiting/onSeeking/onSeeked/
onCanplay`、`startTime`、`referrerPolicy`。要加先立 spec。

`onPlay/onPause/onStop` 是**发起确认**（调用被接受即触发），不是播放器真实
状态的回执——三端一致地乐观；只有 `ended` / `error` 是从宿主回派的（那是 JS
自己推不出来的两件事）。

## src 规则（与 `<image>` 完全同源）

| 写法 | dev（`fjs dev`） | release | web |
|---|---|---|---|
| `http(s)://…` | 流式播放，不预载 | 流式 | 浏览器自己 |
| `/x`、`asset://x` | dev server 取字节**预载** | `assets/fjs/public/x` 取字节预载 | 相对站点根 |
| 裸相对 `x` | 按根路径处理并 warn（同 `<image>`） | 同左 | 浏览器语义 |

本地路径预载成字节是刻意的：游戏音效一秒打几次，每次 `play()` 重新走
网络/解码会把一个 RTT 塞进开火循环；预载之后 `play()` 只碰内存。

## 三端实现与已知差异

| | Flutter | Web | 微信小程序 |
|---|---|---|---|
| 震动 | `fjs.vibrate` → `HapticFeedback`（light/medium/heavyImpact，long → `vibrate()`），flutter_fjs 内置 | `navigator.vibrate`：light 15 / medium 30 / heavy 50 / long 400 ms | wx 桥转发真 `wx.vibrateShort({type}) / wx.vibrateLong` |
| 播放 | `@ufjs/audio` 的 Dart 半边 → audioplayers `AudioPlayer`（一个 context 一个播放器） | `HTMLAudioElement` | 模块入口转发真 `wx.createInnerAudioContext` |
| `duration/currentTime` 读值 | 宿主缓存的最近位置（流更新驱动，亚秒级陈旧；duration v1 恒 0） | 元素实时值 | wx 实时值 |
| autoplay 策略 | 无限制 | 浏览器手势门槛：首个 `play()` 可能被拒（console.warn 一次），用户手势后再调即可 | 无限制（wx 内建） |
| 不支持的环境 | audioplayers 没有实现的平台（如 ohos）：首个使用 debugPrint 一次 + `onError` | iOS Safari / 桌面无 `navigator.vibrate`：warn 一次后 no-op | —（wx 最全） |

## 为什么 audio 不是内置

内核（`fjs-runtime` + `flutter_fjs`）只依赖 SDK 与既有核心依赖；Flutter SDK
没有自定义音频文件的播放 API（`SystemSound` 只有系统提示音），播放要靠
audioplayers 这个三方 pub 包——按宪法 IX，这类能力整包搬出去：JS 入口
（`packages/fjs-audio/index.ts`）、Dart host 模块
（`packages/fjs-audio/flutter/lib/fjs_audio.dart`）、依赖（模块 pubspec 里的
audioplayers）。vibrate 只碰 `HapticFeedback`（SDK），所以留在
`fjs-runtime/src/vibrate.ts` + `flutter_fjs/lib/src/haptics.dart`。

模块入口**不 import** `@ufjs/runtime`（宪法同款纪律，`@ufjs/webview` /
`@ufjs/iconmind` 先行），事件注册走运行时发布的
`__fjsRegisterSystemHandler` 全局——mp 构建不因此多带一个字节的内核。

## 实现索引

| 层 | 文件 |
|---|---|
| JS 面（模块） | `packages/fjs-audio/index.ts`（native/web/wx 三 guts） |
| 震动（内置） | `fjs-runtime/src/vibrate.ts`、`flutter_fjs/lib/src/haptics.dart`（`fjs.vibrate`） |
| Dart 半边（模块） | `packages/fjs-audio/flutter/lib/fjs_audio.dart`（`fjs.audio.*`，reload 失效走 `engine.addListener`） |
| 事件号 | `FJS_EVENT_AUDIO = 45`（`fjs.h` / `ffi.dart` 中央分配，由模块派发），载荷 `{"t":"ended"}` / `{"t":"error","err":…}` |
| wx 适配范例 | `examples/hello-fjs/src/plane-war/wx-adapter.ts`（`wx.createInnerAudioContext` 包 `@ufjs/audio`，`wx.vibrateShort` 包内置 API） |
