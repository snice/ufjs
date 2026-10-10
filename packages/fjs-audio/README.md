# @ufjs/audio

`createAudio()` for [fjs](https://github.com/snice/ufjs)：一个命令式音频上下文，
三个目标端同一份页面源码。

```ts
import { createAudio } from '@ufjs/audio';

const bgm = createAudio();
bgm.loop = true;
bgm.autoplay = true;
bgm.src = '/audio/bgm.mp3';
bgm.play();
```

| 端 | 播放背后 |
|---|---|
| App（Flutter） | 本模块 pub 包 `fjs_audio` 的 host 模块 → audioplayers（本地路径预载成字节） |
| 浏览器 | `HTMLAudioElement` |
| 微信小程序 | 真 `wx.createInnerAudioContext`（转发，微信本来最全） |

vibrate **不在这个包里**——它只依赖 Flutter SDK 的 `HapticFeedback`，是内置
能力：`import { vibrateShort, vibrateLong } from 'fjs'`。

## 为什么是模块包而不是内置

fjs 内核（`@ufjs/runtime` + `flutter_fjs`）只依赖 SDK 与既有核心依赖；需要
三方 pub 包的能力一律做成模块包（宪法 IX）。音频的 Flutter 半边需要
audioplayers，所以它整个——JS 入口、Dart host 模块、pub 依赖——都搬进了
这里。装上即 autolink：`fjs.flutter.register` 会把
`FjsAudio.register(engine)` 写进宿主。

本包入口**不 import** `@ufjs/runtime`（`@ufjs/webview` / `@ufjs/iconmind`
的同款纪律），事件注册走运行时发布的 `__fjsRegisterSystemHandler` 全局，
mp 构建不因此多带一个字节的内核。

API 面与两端差异见 [docs/media.md](../../docs/media.md)。
