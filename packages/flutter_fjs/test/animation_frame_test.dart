import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

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
    return;
  }
  ffi.DynamicLibrary.open(lib);

  testWidgets('requestAnimationFrame callback runs on a later frame', (
    tester,
  ) async {
    final logs = <String>[];
    final engine = FjsEngine()..onLog = (_, message) => logs.add(message);
    addTearDown(engine.dispose);

    engine.runSource(r'''
var callbacks = {};
var nextId = 1;
globalThis.__fjsDispatchEvent = function (id, type, payload) {
  if (type !== 19) return;
  var cb = callbacks[id];
  if (!cb) return;
  delete callbacks[id];
  cb(Number(payload));
};
globalThis.requestAnimationFrame = function (cb) {
  var id = nextId++;
  callbacks[id] = cb;
  __fjs.fns.invokeHost('js.raf.request', id);
  return id;
};
requestAnimationFrame(function (t) {
  console.log('frame1 ' + Number.isFinite(t));
  requestAnimationFrame(function (t2) {
    console.log('frame2 ' + (t2 >= t));
  });
});
console.log('sync');
''', filename: 'raf-test.js');

    expect(logs, ['sync']);
    await tester.pump();
    expect(logs, ['sync', 'frame1 true']);
    await tester.pump();
    expect(logs, ['sync', 'frame1 true', 'frame2 true']);
  });
}
