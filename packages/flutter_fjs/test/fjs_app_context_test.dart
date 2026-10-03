// FjsApp.currentContext (specs/202): the seam a host uses to give native
// dialogs a BuildContext. Needs a VM only because FjsApp takes an engine;
// like the other engine-backed widget tests it returns early without the
// dev dylib — `No tests ran` is not a pass (build native first).
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter/material.dart';
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
  if (lib == null || !Platform.isMacOS) return;
  ffi.DynamicLibrary.open(lib);

  testWidgets('currentContext is live while mounted and a dialog can use it',
      (tester) async {
    final engine = FjsEngine();
    addTearDown(engine.dispose);
    expect(FjsApp.currentContext, isNull);

    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await tester.pump();
    final context = FjsApp.currentContext;
    expect(context, isNotNull);

    // the point of the seam: showDialog works with it
    showDialog<void>(
      context: context!,
      builder: (_) => const AlertDialog(content: Text('hello dialog')),
    );
    await tester.pumpAndSettle();
    expect(find.text('hello dialog'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    expect(FjsApp.currentContext, isNull);
  });
}
