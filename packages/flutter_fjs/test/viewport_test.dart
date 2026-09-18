// Viewport -> JS channel end to end (specs/043-media-queries): FjsView's
// metrics updates leave as dispatchEvent(0, 33, payload), the runtime's
// initial PULL reads `fjs.viewport.get`, and a rebuilt VM pulls again (dev
// reload path). The JS side is written against the raw channels —
// renderer.ts is what wires them into the style engine — so no built
// runtime bundle is needed, same setup as host_async_test.dart.
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

const _jsProgram = r'''
globalThis.__events = [];
globalThis.__fjsDispatchEvent = function (id, type, payload) {
  globalThis.__events.push({ id: id, type: type, payload: payload });
};
globalThis.dump = function (tag, value) {
  console.log(tag + ' ' + value);
};
''';

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

void main() {
  final lib = _libPath();
  if (lib == null || !Platform.isMacOS) {
    // no dev dylib (or not macOS): nothing to load the VM from
    return;
  }
  ffi.DynamicLibrary.open(lib);

  late FjsEngine engine;
  final logs = <String>[];

  /// console.log crosses the log trampoline synchronously, so the value is
  /// in [logs] by the time runSource returns.
  String dump(String expr, {String tag = 'OUT'}) {
    final before = logs.length;
    engine.runSource(
      'globalThis.dump("$tag", $expr);',
      filename: 'viewport-dump.js',
    );
    return logs.skip(before).firstWhere((l) => l.startsWith('$tag '));
  }

  setUp(() {
    logs.clear();
    engine = FjsEngine()..onLog = (level, message) => logs.add(message);
    engine.runSource(_jsProgram, filename: 'viewport-test.js');
  });

  tearDown(() => engine.dispose());

  test('updateViewport pushes event 33 with the fixed payload shape', () {
    engine.updateViewport(390, 844);
    final events = dump('JSON.stringify(globalThis.__events)', tag: 'EV');
    expect(events, contains('"type":33'));
    expect(events, contains('"id":0'));
    // the payload crosses JSON.stringify, so its quotes come back escaped
    expect(events, contains(r'\"width\":390.0,\"height\":844.0'));
  });

  test('a byte-equal size is deduped, a changed one is pushed', () {
    engine.updateViewport(390, 844);
    dump('JSON.stringify(globalThis.__events = [])', tag: 'EV');
    engine.updateViewport(390, 844); // same size, e.g. a second FjsView
    expect(dump('JSON.stringify(globalThis.__events)', tag: 'EV'), 'EV []');
    engine.updateViewport(700.5, 844);
    expect(
      dump('JSON.stringify(globalThis.__events)', tag: 'EV'),
      contains(r'\"width\":700.5,\"height\":844.0'),
    );
  });

  test('the runtime pulls the current size and a rebuilt VM pulls again', () {
    engine.updateViewport(414.0, 896.0);
    expect(
      dump('__fjs.fns.invokeHost("fjs.viewport.get")', tag: 'PULL'),
      'PULL {"width":414.0,"height":896.0}',
    );

    engine.reset();
    // the fresh VM knows nothing; re-run the test program the way a fresh
    // app bundle re-evals renderer.ts, and the pull — the same channel
    // renderer.ts makes at module load — must see the size the window
    // already had, without any new push
    engine.runSource(_jsProgram, filename: 'viewport-test.js');
    expect(
      dump('__fjs.fns.invokeHost("fjs.viewport.get")', tag: 'PULL'),
      'PULL {"width":414.0,"height":896.0}',
    );

    // and after the rebuild a change still reaches the new VM
    engine.updateViewport(390.0, 844.0);
    expect(
      dump('JSON.stringify(globalThis.__events)', tag: 'EV'),
      contains(r'\"width\":390.0,\"height\":844.0'),
    );
  });
}
