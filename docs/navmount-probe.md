# navMount 拆账打点（临时，量完即撤）

> 第四层，给 [vant-mount-perf.md](vant-mount-perf.md) 当操作手册。
> **不要把这些打点提交进生产代码。** 仓库里现在没有 `[probe]`——2026-09 拆
> 那 240ms 时加过，量完已从 C++ / JS / Dart 全部还原。

`[nav] mounted` 打在 `engine.dart` `_mountWhenReady()`：墙钟 =
chunk 拉取 + `dispatchEvent(navMount)`。后者在 C++ 里是 **`JS_Call` +
立刻 `fjs_vm_pump`**。pump 才会跑 Vue `nextTick`、CSS `flushNow`、以及
`fjs.ui.rect` 触发的同步 layout。

只看 `[nav] mounted` 一行分不出 240ms 在哪。要拆开，三层都打，缺一层就会
把 layout 误判成 GC。

## 0. 怎么跑、怎么看日志

```bash
cd demo && pnpm exec fjs run ios          # 连 iPhone 模拟器，debug
# chunk 预热后点目标页；日志在 flutter 终端：
#   flutter: [js:info] [probe] ...
#   flutter: [probe] reflow ...          # Dart debugPrint，不带 [js:info]
```

改了 `native/src/vm.cpp` 必须重编**模拟器**静态库，否则 App 还是旧引擎：

```bash
ROOT=packages/flutter_fjs
OUT=$ROOT/build/apple/ios-simulator
cmake -S $ROOT/native -B $OUT \
  -DCMAKE_BUILD_TYPE=Release -DFJS_APPLE_STATIC=ON -DFJS_BUILD_TESTS=OFF \
  -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0
cmake --build $OUT --target fjs_core quickjs --config Release -j"$(sysctl -n hw.ncpu)"
libtool -static -no_warning_for_no_symbols \
  -o $OUT/libfjs.a $OUT/libfjs_core.a $OUT/libquickjs.a
cp $OUT/libfjs.a $ROOT/ios/fjs.xcframework/ios-arm64_x86_64-simulator/libfjs.a
```

量完：`git checkout -- native/src/vm.cpp`，再跑一遍上面的 cmake/libtool/cp，
把 `libfjs.a` 也还原。JS / Dart 打点 `git checkout` 对应文件即可。

## 1. C++：JS_Call vs pump vs 单次 job

文件：`packages/flutter_fjs/native/src/vm.cpp`。
`fjs::now_ms` 已经是毫秒（微秒时钟 / 1000）。`FJS_LOG_INFO = 1` 会进
`[js:info]`。

**`fjs_vm_dispatch_event`：把 `JS_Call` 和随后的 `pump` 拆开。**

```cpp
const double call_t0 = fjs::now_ms(vm);
JSValue ret = JS_Call(vm->ctx, fn, JS_UNDEFINED, 3, argv);
const double call_dt = fjs::now_ms(vm) - call_t0;
/* ... 原有 FreeValue / 异常处理 ... */
const double pump_t0 = fjs::now_ms(vm);
fjs_vm_pump(vm, (int64_t)fjs::now_ms(vm));
const double pump_dt = fjs::now_ms(vm) - pump_t0;
if (call_dt + pump_dt >= 8.0) {
    char buf[128];
    int n = snprintf(buf, sizeof(buf),
                     "[probe] dispatch call=%.0fms pump=%.0fms",
                     call_dt, pump_dt);
    if (n > 0) log_line(vm, FJS_LOG_INFO, buf, n);
}
```

**`fjs_vm_pump`：给每个 `JS_ExecutePendingJob` 计时，慢的打出来。**

在 job 循环里：

```cpp
const double job_t0 = fjs::now_ms(vm);
int r = JS_ExecutePendingJob(vm->rt, &ctx1);
const double job_dt = fjs::now_ms(vm) - job_t0;
if (job_dt >= 8.0) {
    char buf[96];
    int n = snprintf(buf, sizeof(buf), "[probe] job #%d %.0fms", i, job_dt);
    if (n > 0) log_line(vm, FJS_LOG_INFO, buf, n);
}
```

循环结束后：

```cpp
/* pump 开头记下 pump_t0 / job_n / timer_n */
if (pump_dt >= 8.0) {
    char buf[128];
    int n = snprintf(buf, sizeof(buf),
                     "[probe] pump %.0fms jobs=%d timers=%d",
                     pump_dt, job_n, timer_n);
    if (n > 0) log_line(vm, FJS_LOG_INFO, buf, n);
}
```

读法：`call=` 是 `onNavMount` → Vue `app.mount`（同步 patch）。`pump=` 才是
微任务。`job #0` 通常是 `flushNow`（CSS + 编码 + applyFrame）。再出现一条
上百毫秒的 `job #N`，去对 Dart 的 `reflow` / `boundingRect`。

086 前 vant-form 实例：

```
[probe] dispatch call=39ms pump=210ms
[probe] job #0 49ms          ← CSS+帧
[probe] job #4 160ms         ← 一次 getBoundingClientRect
[nav] mounted ... in 249ms
```

## 2. JS：Vue mount / CSS flush / op 编码

这些走 Vite，**不用重编 native**。阈值以下别打印，免得首页也刷屏。

**`router/flutter.ts` `mount()`**（已有 `nowMs` 可从 `../host` 引进）：

```ts
const t0 = nowMs();
app.mount(root);
const vueMs = nowMs() - t0;
if (vueMs >= 5) {
  console.log(`[probe] vue.mount ${vueMs}ms path=${entry.location.path}`);
}
```

**`host.ts` `flushNow()`**：pre / encode / sink 三分。`toUint8Array` 之后
记得仍要 `writer.reset()`。

```ts
const t0 = nowMs();
for (let i = 0; i < preFlush.length; i++) preFlush[i]();
const preMs = nowMs() - t0;
/* empty → 若 preMs >= 8 打一行然后 return */
const t1 = nowMs();
const frame = writer.toUint8Array();
writer.reset();
const encMs = nowMs() - t1;
const t2 = nowMs();
sink(frame);
const sinkMs = nowMs() - t2;
if (preMs + encMs + sinkMs >= 8) {
  console.log(
    `[probe] flushNow ${preMs + encMs + sinkMs}ms pre=${preMs} encode=${encMs} sink=${sinkMs} bytes=${frame.length}`,
  );
}
```

**`css/style.ts` `flushPending()`**：循环前记下 `dirtyList.length` 和
`counters` 快照，循环后打差值（`recompute` / `computeMiss` / `matchMiss` /
`applied` / `rules.length`）。

086 前 vant-form：`vue.mount 39ms nodes=506`，`cssFlush 37ms dirty=360
matchMiss=275 rules=639`，`flushNow 48ms pre=37 encode=2 sink=8`。

## 3. Dart：applyFrame 和强制 reflow

**`engine.dart` `_onUiOpsTrampoline`**：`applyFrame` 包 `DateTime.now()`，
≥2ms 或帧 ≥8KB 打 `[probe] applyFrame ${ms}ms ${len}B`。

**`geometry.dart` `fjs.ui.rect`**：这才是 240ms 里那 160ms。对 `_reflow`
分段（`flushPending` / `buildScope` / `flushLayout`）：

```dart
final t0 = DateTime.now();
final signalled = tree.flushDirty();
flushPending?.call();
final t1 = DateTime.now();
binding.buildOwner?.buildScope(root);
/* ... LayoutBuilder scheduleLayoutCallback 循环 ... */
final t2 = DateTime.now();
binding.rootPipelineOwner.flushLayout();
debugPrint(
  '[probe] reflow notify=${t1.difference(t0).inMilliseconds}ms '
  'build=${t2.difference(t1).inMilliseconds}ms '
  'layout=${DateTime.now().difference(t2).inMilliseconds}ms '
  'dirty=${signalled.length}',
);
```

`boundingRectOf`（JS `ui/geometry.ts`）在 `flushNow()` + `fjs.ui.rect`
外包一层 `nowMs()`，≥2ms 打 `[probe] boundingRect id=…`。086 前 vant-form
只有 **一次** 量尺寸：`reflow notify=0 build=1 layout=158 dirty=573`。

可选：`_mountWhenReady` 把 chunk 与 dispatch 拆开打在 `[nav] mounted` 后缀，
确认预热后 `chunk=0`。

## 4. 对账

```
[nav] mounted
  ≈ dispatch call     → vue.mount
  + job #0            → cssFlush + encode + applyFrame（= flushNow）
  + 慢 job            → 通常是 fjs.ui.rect → _reflow.flushLayout
  + 其余 job          → 应接近 0
```

三笔对不上（例如 mounted=250、vue+css+applyFrame=90、没有慢 job）：去看
是不是忘了重编 `libfjs.a`，或 JS 打点没进本次 bundle。

086 已把 navMount 窗口内的 `_reflow` 拿掉。再拆账时，`job #4` 那类
160ms 不应再出现在 `[nav] mounted` 里；layout 会挪到下一 Flutter 帧。
