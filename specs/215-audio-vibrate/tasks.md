# Tasks: ufjs 内置音频与震动能力

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `native/include/fjs.h`：`FJS_EVENT_AUDIO = 45`（44 已被 specs/206
  的 statuschange 占用；顺带在 fjs.h 里注明 44 为何不在此表）
- [x] T002 `lib/src/ffi.dart`：`FjsEvent.audio = 45`

## 实现

- [x] T010 `fjs-runtime/src/audio/audio.ts`：FjsAudio + createAudio（native/web 双路 + 事件分发 + 降级 warnOnce；src 重赋值重入 create）
- [x] T011 `fjs-runtime/src/audio/vibrate.ts`：vibrateShort/vibrateLong（native/web/降级）
- [x] T012 `fjs-runtime/src/index.ts` 导出四个名字
- [x] T013 `lib/src/audio.dart`：fjs.audio.* 模块（本地路径 BytesSource 预载/远程 UrlSource 流式）+ fjs.vibrate（HapticFeedback）
- [x] T014 engine.dart 接线（`_setupAudioModules` + VM 重建 `clearAudioEntries`）+ pubspec.yaml 加 audioplayers
- [x] T015 mp 端：`fjs-runtime/src/wx/fjs-bridge.ts` 转发真 wx

## 两端对齐

- [x] T020 wx-adapter：createInnerAudioContext/vibrateShort 接真实现，删 no-op 桩；离开页面停声、重进重启 bgm、首触摸补启被 autoplay 策略拦掉的 bgm
- [x] T021 拷贝 audio/bgm.mp3、bullet.mp3、boom.mp3 → public/plane-war/audio/
- [x] T022 Web 端实跑（IAB + `fjs dev --web`）：进入页面 bgm 循环（currentTime 持续推进）、游戏渲染正常、击落计分（score 3，音效/震动调用路径全走）、触摸无异常；离开页面 bgm 回零停住。App 端真机/模拟器实跑为剩余手工项（见下）

## 测试

- [x] T030 `fjs-runtime/test/audio-native.test.ts` + `audio-web.test.ts`：19 例（native 命令编码/事件回派/降级 warn-once、web 双路/autoplay 策略/震动时长映射）
- [x] T031 Dart：`flutter_fjs/test/audio_module_test.dart` 4 例（错误路径事件 45、陈旧句柄丢弃、get 缓存、fjs.vibrate→HapticFeedback 映射）。happy path 不做单测：rootBundle 与 HttpClient 在测试绑定下都不可真跑，伪造即测 mock—— audible 路径归两端手工验收

## 文档

- [x] T040 新增 `docs/media.md`；`docs/README.md`（第 0 层 + 按任务找）与 `AGENTS.md` 文档地图收录
- [x] T041 hello-fjs README 降级项改实际行为；`docs/roadmap.md` 214 降级行划掉 + 215 小节

## 验收

- [x] T050 `pnpm run typecheck` 全 workspace 通过；`pnpm test` 全绿（fjs-runtime 1030 / fjs 511 / webview 36 / webgl 30 / liquidglass 6）
- [x] T051 `pnpm --filter hello-fjs run typecheck` + `build:pages` + `build:mp`（56 页）通过
- [x] T052 `flutter analyze` 新增代码零告警（存量 test 文件 info 不动）；`flutter test test/audio_module_test.dart` 4/4；spec §6 逐条核对完成

## 模块拆分（同日第二条需求：audio 成包 @ufjs/audio，vibrate 留内置）

- [x] S001 `packages/fjs-audio`：index.ts（native/web/wx 三 guts，自包含不
  import 内核，事件走 `__fjsRegisterSystemHandler` 全局）+ package.json（fjs
  module 清单 + flutter autolink 块）+ flutter/fjs_audio.dart + pubspec（audioplayers）
- [x] S002 runtime：`src/audio/` 移除，vibrate → `src/vibrate.ts`；element.ts
  发布 `__fjsRegisterSystemHandler` 全局 + index 导出 registerSystemHandler/installEventDispatcher；
  fjs-bridge 只留 vibrate
- [x] S003 flutter_fjs：`lib/src/audio.dart` → `lib/src/haptics.dart`（fjs.vibrate），
  pubspec 去 audioplayers；fjs.h/ffi.dart 事件号 45 注释改"中央分配、模块派发"
- [x] S004 测试：audio 三件迁入 fjs-audio（native/web/wx，含 wx shim 递归
  guard 回归）；runtime 新增 vibrate-native/vibrate-web；flutter_fjs 换
  haptics_module_test
- [x] S005 hello-fjs：依赖 @ufjs/audio + wx-adapter 改导入 + `fjs host sync`
  autolink（pubspec fjs_audio 路径依赖 + FjsAudio.register）验证；build:pages
  与 build:mp 重过；web 实跑重验（修掉 wx shim 劫持 gut 的无限递归后 bgm
  推进、score 增长）
- [x] S006 规则落地：宪法 IX（三方 pub 依赖不进内核）+ AGENTS.md §4 第 8 条
  （host API 依赖三方 pub → 不内置）与第 9 条（模块 JS 入口不 import 内核）+
  仓库地图加 fjs-audio 行；media.md/roadmap/spec 变更记录同步

## 剩余手工项（环境不具备，移交需求方）

- App 端实跑：`fjs run ios` / fjs-go 连 `fjs dev`，听 bgm/音效、感受震动（`audioplayers` 已入 pubspec，首次构建会 pod install / gradle 拉包）。
- 真机 Chrome（Android）验证 `navigator.vibrate` 震动（桌面 WebKit 无此 API，console 会有一次 warn，属预期）。
