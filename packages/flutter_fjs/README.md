# flutter_fjs

JS/TS runtime for Flutter. Embeds [QuickJS-ng](https://github.com/quickjs-ng/quickjs)
in native code, calls between JS and C++ directly (JSI-style, no method channel),
runs source or precompiled QuickJS bytecode bundles, and renders HTML-like JS
tags as real Flutter widgets.

This is the Flutter half of [ufjs](https://github.com/snice/ufjs).
The JS half lives on npm as [`@ufjs/cli`](https://www.npmjs.com/package/@ufjs/cli)
(build toolchain) and [`@ufjs/runtime`](https://www.npmjs.com/package/@ufjs/runtime)
(element API, Vue 3 custom renderer).

## Prebuilt natives

The engine ships compiled, so consumer builds need no NDK, no CMake and no
native compile step:

| Platform | Artifact |
| --- | --- |
| Android | `android/src/main/jniLibs/{armeabi-v7a,arm64-v8a,x86_64}/libfjs.so` |
| iOS / macOS | `ios/fjs.xcframework`, `macos/fjs.xcframework` (device, simulator, macOS) |

Minimums: Android API 21, iOS 12.0, macOS 10.14.

## Usage

Normally you do not write the host by hand — the CLI generates it, wired for
both dev and release:

```bash
npx @ufjs/cli create my-app
cd my-app && npm run run:android
```

What follows is what that generated host does, for embedding the engine in an
existing Flutter app.

```yaml
dependencies:
  flutter_fjs: ^0.1.4
```

### Running a bundle

The engine does not read assets itself: you hand it bytes. `runSource` takes JS
text, `runBundle` takes a `.fjsbundle` (QuickJS bytecode, version-locked to the
embedded engine).

```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final engine = FjsEngine();
  engine.onLog = (level, message) =>
      debugPrint('[js:${FjsLogLevel.of(level).name}] $message');

  final bundle = await rootBundle.load('assets/fjs/bundle.fjsbundle');
  engine.runBundle(bundle.buffer.asUint8List());

  runApp(MaterialApp(home: Scaffold(body: FjsView(engine: engine))));
}
```

### FjsView vs FjsApp

Both render the JS UI tree; the difference is what owns navigation.

| | Use when |
| --- | --- |
| `FjsView` | The app has one screen, or your own Flutter `Navigator` drives routing and you place a view per screen. |
| `FjsApp` | The JS side uses `fjs/router`. |

`FjsApp` is a `Navigator` whose page stack mirrors the JS router's, so
`router.push('/detail')` becomes a real Flutter page push — platform transition,
iOS back-swipe and Android system back all come with it, and popping tells JS to
unmount the page. It renders each route with its own `FjsView` internally.

```dart
FjsApp(
  engine: engine,
  placeholder: const Center(child: CircularProgressIndicator()),
)
```

`placeholder` shows while a pushed route's chunk is still loading.

### Split builds

`fjs build --pages` emits a shared prelude plus one chunk per route. Register the
prelude once and give the engine a way to fetch chunks on demand:

```dart
final shared = await rootBundle.load('assets/fjs/shared.fjsbundle');
engine.addPrelude(shared.buffer.asUint8List());

engine.chunkLoader = (chunk) async {
  try {
    final data = await rootBundle.load('assets/fjs/pages/$chunk.fjsbundle');
    return data.buffer.asUint8List();
  } catch (_) {
    return null; // reported to JS as a mount with no page
  }
};
```

### Dev server

`fjs dev` serves the bundle over HTTP with hot reload. Point the engine at it
instead of loading assets:

```dart
await engine.connectDev('127.0.0.1', 38900);
```

`10.0.2.2` from an Android emulator; the machine's LAN address from a physical
device. `fjs run` passes the right one through a `FJS_DEV` dart-define.

### Calling Dart from JS

```dart
engine.host.register('device', (args) => {
      'platform': Platform.operatingSystem,
      'locale': Platform.localeName,
    });
```

JS side: `invokeHost('device', {})`. See
[docs/jsi-and-native-modules.md](https://github.com/snice/ufjs/blob/main/docs/jsi-and-native-modules.md).

## Rebuilding the natives

The C++/QuickJS-ng sources are not part of the published package — nothing in a
consumer build compiles them. They live in `native/` in the
[repository](https://github.com/snice/ufjs), together with the scripts
that regenerate the binaries above:

```bash
cd packages/flutter_fjs
tool/build-android.sh   # needs ANDROID_NDK_HOME
tool/build-apple.sh     # macOS + Xcode
```

## License

MIT. Bundles QuickJS-ng (MIT) — see [NOTICE](NOTICE) and
`native/quickjs/LICENSE`.
