// The dev performance monitor. Two things worth pinning down: it is invisible
// until asked for (it must not cost a mounted timer or a timings callback in
// an app that never turns it on), and the heap row degrades instead of
// throwing when the engine binary predates `fjs_vm_heap`.
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/flutter_fjs.dart';

/// The engine is a static slice in an app binary but a plain dylib in a test
/// run, so the symbols have to be loaded by hand first — the same dance
/// animation_frame_test.dart does. No dylib (a CI box that never built
/// native/) means the file has nothing it can assert.
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

Widget _wrap(FjsEngine engine) => MaterialApp(
  home: FjsPerfOverlay(engine: engine, child: const Text('app')),
);

void main() {
  final lib = _libPath();
  if (lib == null || !Platform.isMacOS) return;
  ffi.DynamicLibrary.open(lib);

  testWidgets('hidden until asked for, then shows the panel', (tester) async {
    final engine = FjsEngine();
    addTearDown(engine.dispose);

    await tester.pumpWidget(_wrap(engine));
    expect(find.text('app'), findsOneWidget);
    // nothing of the panel in the tree: no timer, no timings callback
    expect(find.textContaining('nodes'), findsNothing);

    engine.perfOverlay.value = true;
    await tester.pump();
    expect(find.text('app'), findsOneWidget);
    for (final row in ['fps', 'ui', 'gpu', 'heap', 'nodes']) {
      expect(find.text(row), findsOneWidget, reason: 'row "$row" missing');
    }

    engine.perfOverlay.value = false;
    await tester.pump();
    expect(find.textContaining('nodes'), findsNothing);
  });

  testWidgets('the heap row reads without collecting, or says n/a', (
    tester,
  ) async {
    final engine = FjsEngine();
    addTearDown(engine.dispose);
    engine.perfOverlay.value = true;
    await tester.pumpWidget(_wrap(engine));

    final heap = engine.heapUsage();
    if (heap == null) {
      // an engine binary older than the symbol: the rest of the panel still
      // works, which is the whole point of looking it up optionally
      expect(find.text('n/a'), findsOneWidget);
      return;
    }
    expect(heap.bytes, greaterThan(0));
    expect(heap.objects, greaterThan(0));
    // reading it twice must not move the heap: it is a read, not a collection
    final again = engine.heapUsage()!;
    expect(again.objects, closeTo(heap.objects.toDouble(), heap.objects * 0.1));
    expect(find.textContaining('MB'), findsOneWidget);
  });
}
