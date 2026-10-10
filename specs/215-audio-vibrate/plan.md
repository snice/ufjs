# Plan: ufjs 内置音频与震动能力

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | createAudio/vibrate 在 JS runtime 一个类里分叉：有原生宿主走 invokeHost，浏览器走 HTMLAudioElement / navigator.vibrate；mp 端 'fjs' 桥转发真 wx。验收两端实跑 |
| II 边界即契约 | 是 | 只花一个事件号 44（fjs.h + ffi.dart + audio.ts 三处同步）；不新增 C ABI，走 fetch 范式（invokeHost 发起 + JS 自分配句柄 + dispatchEvent 回结果） |
| III 同步单线程零序列化 | 是 | 命令（play/stop/seek…）是同步 fire-and-forget invokeHost；只有 ended/error 从 Dart 回派，等待发生在 Dart 事件循环上 |
| IV 外观照 WeUI | 否 | 非视觉能力 |
| V 静默失效是 bug | 是 | 三类降级全部显式：无宿主（fjsrun）→ warnOnce 后 API 空转不抛栈；ohos 无 audioplayers / iOS 无 navigator.vibrate → warnOnce；src 加载失败 → onError |
| VI 注释记录权衡 | 是 | audio.ts / audio.dart 顶部注释记录"为什么 BytesSource 预载 / 为什么不是 AudioPool / 为什么不是完整 wx 面" |
| VII JS 能包就不要下 Dart | 是 | 浏览器端全部 JS（Audio 元素 + navigator.vibrate，零宿主调用）；只有"真机出声/震动"这个平台能力下 Dart——QuickJS 没有，Flutter SDK 也没有内置音频播放，这是 VII 说的"平台控件"类 |
| VIII 变更落到文档 | 是 | 新增 docs/media.md；docs/README.md、AGENTS.md 文档地图、hello-fjs README、docs/roadmap.md 同步 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| C++ 引擎 | `native/include/fjs.h` | `FJS_EVENT_AUDIO = 44`（仅枚举，无新 ABI） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/ffi.dart` | FjsEvent.audio = 44 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/audio.dart` | 新：`fjs.audio.create/cmd/dispose`、`fjs.vibrate` 模块 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | `_setupAudioModule()` 接线（devUri/devGeneration/assetBundle 同 canvas 模块） |
| Dart 宿主 | `packages/flutter_fjs/pubspec.yaml` | + `audioplayers`（理由见 §3） |
| JS runtime | `packages/fjs-runtime/src/audio/audio.ts` | 新：`FjsAudio` 类 + `createAudio()`（native/web 双路 + 事件分发） |
| JS runtime | `packages/fjs-runtime/src/audio/vibrate.ts` | 新：`vibrateShort/vibrateLong` |
| JS runtime | `packages/fjs-runtime/src/index.ts` | 导出 `createAudio/FjsAudio/vibrateShort/vibrateLong` |
| JS runtime | `packages/fjs-runtime/src/wx/fjs-bridge.ts` | mp 'fjs' 切片：转发真 wx |
| 示例 | `examples/hello-fjs/src/plane-war/wx-adapter.ts` | no-op 桩 → 真实现（wx 形状包 ufjs API） |
| 素材 | `examples/hello-fjs/public/plane-war/audio/` | 新：bgm/bullet/boom.mp3（原项目 copy） |
| 测试 | `packages/fjs-runtime/test/audio.test.ts` | web 路径、native 命令编码、降级 warn |
| 文档 | `docs/media.md`、`docs/README.md`、`AGENTS.md`、`examples/hello-fjs/README.md`、`docs/roadmap.md` | 增补 |

## 3. 方案

**JS 形状**（`audio.ts`）：一个类两副内脏，照 `loadCanvasImage` 的分叉方式——
`hasNativeHost` 时 JS 句柄单调递增，`src` 赋值触发 `invokeHost('fjs.audio.create',
handle, src, configJson)`（configJson 携带 src 赋值前已设置的 loop/autoplay/
volume，赋值顺序无关，wx 习惯是先 loop 后 src）；后续 `play/pause/stop/seek/
loop/volume` 走 `invokeHost('fjs.audio.cmd', handle, cmd, valueJson)`；
`destroy()` 走 `fjs.audio.dispose`。`registerSystemHandler(44)` 收
`{"t":"ended"}` / `{"t":"error","err":…}`。web 内脏是 `HTMLAudioElement`：
属性直映射，`autoplay` 在 src 赋值后补 `play()`（浏览器 autoplay 策略差异下
不依赖浏览器 autoplay 语义）。

**否掉的备选**：
- *wx 同名 API 直接装全局*——runtime 只在游戏适配层需要 wx 名字，core 不该
  认 wx 的命名（适配层一行映射的事）。
- *完整 InnerAudioContext 面*——YAGNI，见 spec §2。
- *audioplayers `AudioPool`*——池化是给同源高频 sfx 的延迟优化，一个
  `AudioPlayer` 每 context 已经够（子弹音 16KB，ExoPlayer/AVAudioPlayer 重放
  无可感知延迟）；池化 API 没有 seek/currentTime，反而要为 wx 面再做一层。

**Dart 侧**（`audio.dart`，照 canvas/host_module.dart 的形状）：模块回调只拿
HostRegistry + dispatch + devUri/devGeneration/assetBundle，不持有 engine，
可独立单测。src 解析复用 `fjsResolveImageSource` 的三分支逻辑（本地路径在
create 时读成字节 → `BytesSource` 预载：子弹音每次 play 不重新走网络/解码，
加载失败在 create 即派 error 而不是拖到 play；显式 `http(s)://` 远程地址保持
`UrlSource` 流式，不替用户预下载大文件）。震动直接 `HapticFeedback`，无依赖。

**依赖理由（audioplayers ≥6.4 <7）**：Flutter SDK 没有自定义音频文件的播放
API（`SystemSound` 只有系统提示音）；自己写 AVFoundation/ExoPlayer/(ohos)
通道是三份平台代码的长期维护；audioplayers 是事实标准插件（纯 Dart 面 +
官方平台实现，MIT）。它不支持的 ohos 按宪法 V 在首次使用时显式 warn。加了它
以后 `fjsrun`/纯 CLI 路径不受影响（不 import 就不实例化）。

**wx-adapter**：`createInnerAudioContext()` 返回包着 `createAudio()` 的对象，
面收窄为游戏用的子集（loop/autoplay/src/currentTime/play/stop/destroy +
音量透传），`src` 过 `rewritePath`（`audio/bgm.mp3` → `/plane-war/audio/
bgm.mp3`）；`vibrateShort({type})` 直通 `vibrateShort(type ?? 'heavy')`。删掉
audioWarned/vibrateWarned 两个降级桩。

## 4. 风险

- **三处事件号不同步** → 节点收不到 ended/error。对拍：web 与 App 各放一遍
  bgm 循环（ended 会真实触发一次）。
- **赋值顺序**（wx 代码先 loop/autoplay 后 src）：native 侧 configJson 随
  create 走，漏了就静默不循环——用游戏 bgm 实测。
- **audioplayers BytesSource 平台差异**：万一某平台不支持，错误经 onError
  冒出（不是静默）；spec §4 已登记已知差异。
- **离开页面 bgm 不停**：wx-adapter 的 destroy 路径必须接到页面 unmount
  （214 已有 disposeGame 钩子），对拍离开页面听声。
- **mp 端**：'fjs' 切片是新导出，漏了会在 mp 构建里 import 报错——`fjs build
  --mp` 冒烟。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
pnpm --filter hello-fjs run typecheck && pnpm --filter hello-fjs run build:pages
cd packages/flutter_fjs && flutter analyze && flutter test test/audio_module_test.dart
# 手工：fjs dev --web 打开 /example/game/plane-war —— bgm/音效/震动；
#       离开页面声音即停；fjs run ios 同一轮。
```
