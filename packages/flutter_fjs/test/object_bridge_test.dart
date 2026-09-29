// Object ABI (specs/159/160) end to end: JS drives the AUTO-GENERATED
// adapter for a real pub package (mmkv) — `test/fixtures/mmkv_objects.g.dart`
// is the committed output of `fjs autoimport` against the real package's
// dump, registered here through fjsRegisterObjects.
//
// mmkv itself is FFI-based (the platform interface's Func table), so the
// tests inject a pure-Dart _FakeMmkvPlatform through the plugin's own seam
// (MMKVPluginPlatform.instance) before anything touches mmkv.dart: the Func
// closures implement the pointer-level ABI over Dart maps, using the same
// calloc/Utf8 helpers the plugin allocates with. Everything above that seam
// — the mmkv Dart code, the generated adapter, the object ABI, the bridge —
// is the real thing. (Real mmkv storage is mmap-backed; there is no native
// core under `flutter test`, which is the only faked layer.)
//
// The object ABI's Future / callback capabilities are NOT in real mmkv's
// API surface; they are covered at the end through a minimal probe module
// so the bridge machinery keeps its end-to-end tests.
import 'dart:async';
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:ffi/ffi.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'fixtures/mmkv_objects.g.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mmkv/mmkv.dart';
import 'package:mmkv_platform_interface/mmkv_platform_interface.dart';

String? _libPath() {
  var dir = Directory.current;
  for (var i = 0; i < 6; i++) {
    final candidate = File(
      '${dir.path}/packages/flutter_fjs/native/build-native/libfjs.dylib',
    );
    if (candidate.existsSync()) return candidate.path;
    final local = File('${dir.path}/native/build-native/libfjs.dylib');
    if (local.existsSync()) return local.path;
    dir = dir.parent;
  }
  return null;
}

/// Runs [src] and returns the last console.log line.
String _run(FjsEngine engine, List<String> logs, String src) {
  engine.runSource(src, filename: 'obj-test.js');
  return logs.isEmpty ? '' : logs.last;
}

/// Real async: the promise settles on the timer queue behind the pump.
Future<String> _waitForLine(List<String> logs, Pattern pattern) async {
  final deadline = DateTime.now().add(const Duration(seconds: 5));
  while (DateTime.now().isBefore(deadline)) {
    for (final line in logs) {
      if (line.contains(pattern)) return line;
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  fail('no log line matching $pattern');
}

/// The mmkv Func table over Dart maps. Handles are fabricated addresses
/// (Pointer.fromAddress); strings arriving as Pointer<Utf8> are real
/// plugin-allocated memory and read back with toDartString; strings
/// returned to the plugin are calloc'ed utf8 (on macOS the plugin does not
/// free decode results — see mmkv.dart's !_isDarwin() gate — so the bounded
/// leak matches the platform's own contract).
class _FakeMmkvPlatform extends MMKVPluginPlatform {
  final Map<int, Map<String, Object?>> stores = {};
  final Map<String, int> _idAddresses = {};
  int _nextHandle = 1;

  Map<String, Object?> storeOf(ffi.Pointer<ffi.Void> handle) =>
      stores.putIfAbsent(handle.address, () => {});

  void reset() => stores.clear();

  @override
  Future<String> initialize(String rootDir,
      {String? groupDir,
      int logLevel = 1,
      ffi.Pointer<ffi.NativeFunction<LogCallbackWrap>>? logHandler}) async {
    return rootDir;
  }

  @override
  ffi.Pointer<ffi.Void> Function(
          ffi.Pointer<Utf8>,
          int,
          ffi.Pointer<Utf8>,
          ffi.Pointer<Utf8>,
          int,
          int,
          int,
          int,
          int,
          int,
          int,
          int) getMMKVWithIDFunc() =>
      (mmapID, _, __, ___, ____, _____, ______, _______, ________,
          _________, __________, ___________) {
        final id = mmapID.toDartString();
        final handle = ffi.Pointer<ffi.Void>.fromAddress(_nextHandle++);
        // same mmapID -> the same store, the way mmkv's mmap persistence
        // would behave
        stores[handle.address] = <String, Object?>{
          ...?stores[_idAddresses[id]],
        };
        _idAddresses[id] = handle.address;
        return handle;
      };

  @override
  int Function(ffi.Pointer<ffi.Void>, ffi.Pointer<Utf8>,
          ffi.Pointer<ffi.Uint8>, int) encodeBytesFunc() =>
      (kv, keyPtr, bytes, length) {
        storeOf(kv)[keyPtr.toDartString()] =
            utf8.decode(bytes.asTypedList(length));
        return 1;
      };

  @override
  ffi.Pointer<ffi.Uint8> Function(ffi.Pointer<ffi.Void>, ffi.Pointer<Utf8>,
          ffi.Pointer<ffi.Uint64>) decodeBytesFunc() =>
      (kv, keyPtr, lengthPtr) {
        final value = storeOf(kv)[keyPtr.toDartString()];
        if (value is! String) return ffi.nullptr;
        final units = utf8.encode(value);
        final p = calloc<ffi.Uint8>(units.length);
        p.asTypedList(units.length).setAll(0, units);
        lengthPtr.value = units.length;
        return p;
      };

  @override
  int Function(ffi.Pointer<ffi.Void>, ffi.Pointer<Utf8>, int)
      encodeBoolFunc() =>
          (kv, keyPtr, value) {
            storeOf(kv)[keyPtr.toDartString()] = value != 0;
            return 1;
          };

  @override
  int Function(ffi.Pointer<ffi.Void>, ffi.Pointer<Utf8>, int)
      decodeBoolFunc() => (kv, keyPtr, defaultValue) {
            final v = storeOf(kv)[keyPtr.toDartString()];
            return v is bool ? (v ? 1 : 0) : defaultValue;
          };

  @override
  int Function(ffi.Pointer<ffi.Void>, ffi.Pointer<Utf8>)
      containsKeyFunc() =>
          (kv, keyPtr) =>
              storeOf(kv).containsKey(keyPtr.toDartString()) ? 1 : 0;

  @override
  void Function(ffi.Pointer<ffi.Void>, ffi.Pointer<Utf8>)
      removeValueForKeyFunc() => (kv, keyPtr) {
            storeOf(kv).remove(keyPtr.toDartString());
          };

  @override
  void Function(ffi.Pointer) freePtrFunc() => (p) => calloc.free(p);

  @override
  int Function(ffi.Pointer<ffi.Void>, int) countFunc() =>
      (kv, _) => storeOf(kv).length;

  @override
  int Function(
          ffi.Pointer<ffi.Void>,
          ffi.Pointer<ffi.Pointer<ffi.Pointer<Utf8>>>,
          ffi.Pointer<ffi.Pointer<ffi.Uint32>>,
          int) allKeysFunc() =>
      (kv, keyArrayPtr, sizeArrayPtr, _) {
        final keys = storeOf(kv).keys.toList();
        final keyArray = calloc<ffi.Pointer<Utf8>>(keys.length);
        final sizeArray = calloc<ffi.Uint32>(keys.length);
        for (var i = 0; i < keys.length; i++) {
          final units = utf8.encode(keys[i]);
          final p = calloc<ffi.Uint8>(units.length);
          p.asTypedList(units.length).setAll(0, units);
          keyArray[i] = p.cast();
          sizeArray[i] = units.length;
        }
        keyArrayPtr.value = keyArray;
        sizeArrayPtr.value = sizeArray;
        return keys.length;
      };
}

void main() {
  final lib = _libPath();
  if (lib == null || !Platform.isMacOS) {
    // no dev dylib (or not macOS): nothing to load the VM from
    return;
  }
  ffi.DynamicLibrary.open(lib);
  TestWidgetsFlutterBinding.ensureInitialized();

  final fakePlatform = _FakeMmkvPlatform();
  // must be in place before anything touches mmkv.dart: its Func table is
  // bound once, lazily, from this seam
  MMKVPluginPlatform.instance = fakePlatform;

  late FjsEngine engine;
  final logs = <String>[];

  setUp(() async {
    logs.clear();
    fakePlatform.reset();
    await MMKV.initialize(
        rootDir: Directory.systemTemp.path); // no real IO behind the fake
    engine = FjsEngine()..onLog = (level, message) => logs.add(message);
    fjsRegisterObjects(engine); // the generated adapter
    engine.objects.registerModule('probe', _ProbeModule());
  });

  tearDown(() => engine.dispose());

  test('the generated adapter constructs a real MMKV and kv round trips', () {
    final out = _run(
        engine,
        logs,
        "const kv = __fjs.fns.objectCall('construct', 'mmkv', 'MMKV', 'test');"
        "kv.encodeString('user', 'zt');"
        "console.log('got:', kv.decodeString('user'));");
    expect(out, 'got: zt');
  });

  test('fields are the real getters: count, allKeys (a real array)', () {
    final out = _run(
        engine,
        logs,
        "const kv = __fjs.fns.objectCall('construct', 'mmkv', 'MMKV', 'test');"
        "kv.encodeString('a', '1'); kv.encodeString('b', '2');"
        "console.log('count:', kv.count, 'keys:', kv.allKeys.length, "
        "'fn:', typeof kv.encodeString);");
    expect(out, 'count: 2 keys: 2 fn: function');
  });

  test('bools, containsKey, removeValue and the null answer follow mmkv', () {
    final out = _run(
        engine,
        logs,
        "const kv = __fjs.fns.objectCall('construct', 'mmkv', 'MMKV', 'test');"
        "kv.encodeBool('flag', true);"
        "console.log('had:', kv.containsKey('flag'), 'read:', kv.decodeBool('flag', false));"
        "kv.removeValue('flag');"
        "console.log('after:', kv.containsKey('flag'), 'missing:', kv.decodeString('gone'));");
    expect(out, 'after: false missing: null');
  });

  test('an unknown member surfaces the generated adapter error', () {
    final out = _run(
        engine,
        logs,
        "const kv = __fjs.fns.objectCall('construct', 'mmkv', 'MMKV', 'test');"
        "try { kv.noSuchMember(); } catch (e) { console.log('caught:', String(e)); }");
    expect(out, contains('no binding'));
  });

  test('an unregistered module name fails loudly, never hangs', () {
    final out = _run(engine, logs,
        "try { __fjs.fns.objectCall('construct', 'nope', 'X'); }"
        "catch (e) { console.log('err:', String(e)); }");
    expect(out, contains('not registered'));
  });

  test('the bridge forgets every handle on engine reset', () {
    _run(engine, logs,
        "globalThis.kv = __fjs.fns.objectCall('construct', 'mmkv', 'MMKV', 'test')");
    engine.reset();
    expect(() => engine.objects.instanceFor(1), throwsStateError);
  });

  test('bridge unit: unknown closures throw', () {
    expect(() => engine.objects.closureFor(99999), throwsStateError);
  });

  test('a Future member becomes a promise (probe: not in real mmkv)',
      () async {
    _run(
        engine,
        logs,
        "const p = __fjs.fns.objectCall('construct', 'probe', 'Probe');"
        "__fjs.fns.objectCall('invoke', p, 'waitFor', 30);"
        "const q = __fjs.fns.objectCall('invoke', p, 'waitFor', 30);"
        "q.then(v => console.log('awaited:', v));");
    expect(await _waitForLine(logs, 'awaited:'), contains('waited 30ms'));
  });

  test('a JS function reaches Dart as FjsCallback and fires back (probe)',
      () async {
    _run(
        engine,
        logs,
        "const p = __fjs.fns.objectCall('construct', 'probe', 'Probe');"
        "__fjs.fns.objectCall('invoke', p, 'onTick', n => console.log('tick:', n));"
        "__fjs.fns.objectCall('invoke', p, 'tick');");
    expect(await _waitForLine(logs, 'tick:'), 'tick: 0');
  });
}

/// Bridge-machinery probe: Future / callback members that real mmkv's API
/// does not expose. Registered under its own name in the tests that need
/// it; kept as small as the coverage requires.
class _ProbeModule extends FjsObjectModule {
  FjsCallback? tickListener;

  @override
  Object? construct(String className, List<Object?> args) => this;

  @override
  Object? invoke(Object instance, String member, List<Object?> args) {
    switch (member) {
      case 'waitFor':
        return Future<void>.delayed(
            Duration(milliseconds: (args[0] as num?)?.toInt() ?? 20),
            () => 'waited ${(args[0] as num?)?.toInt() ?? 20}ms');
      case 'onTick':
        tickListener = args[0] as FjsCallback;
        return null;
      case 'tick':
        return tickListener?.call([0]);
      default:
        throw StateError('probe has no member "$member"');
    }
  }
}
