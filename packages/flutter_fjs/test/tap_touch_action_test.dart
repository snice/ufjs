// Repro: a node with BOTH `@tap` and `touch-action: none` — the exact shape
// of the pelican canvas (canvas-compat §9 tells gesture canvases to write
// touch-action: none, and says @tap works on canvas). On web the tap fires;
// on Flutter the touch recognizer eagerly claims the arena at pointer-down,
// so the TapGestureRecognizer is rejected before the finger lifts.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart' show FjsEvent;
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';

class _W {
  final List<int> b = [];
  void u8(int v) => b.add(v & 0xff);
  void u16(int v) => b
    ..add(v & 0xff)
    ..add((v >> 8) & 0xff);
  void u32(int v) {
    final d = ByteData(4)..setUint32(0, v, Endian.little);
    b.addAll(d.buffer.asUint8List());
  }

  void str(String s) => b.addAll(utf8.encode(s));
  void raw(List<int> l) => b.addAll(l);
}

/// A 100x100 view with `@tap`, optionally `touch-action: none`.
MirrorTree _tree({bool touchActionNone = false}) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final props =
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff"'
      '${touchActionNone ? ',"touchAction":"none"' : ''}},"onTap":true}';
  final json = utf8.encode(props);
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

/// One rendered node, dispatch records the event types it emits.
Widget _host(MirrorTree tree, List<int> log) => MaterialApp(
  home: Center(
    child: FjsNodeRenderer(
      tree: tree,
      ids: const [1],
      dispatch: (id, type, {String? text}) => log.add(type),
    ),
  ),
);

void main() {
  testWidgets('control: @tap fires on a plain node', (tester) async {
    final log = <int>[];
    await tester.pumpWidget(_host(_tree(), log));
    await tester.tap(find.byType(Container));
    await tester.pump();
    expect(log, contains(FjsEvent.tap));
  });

  testWidgets('@tap fires on a touch-action: none node', (tester) async {
    final log = <int>[];
    await tester.pumpWidget(_host(_tree(touchActionNone: true), log));
    await tester.tap(find.byType(Container));
    await tester.pump();

    expect(
      log,
      contains(FjsEvent.tap),
      reason: 'touch-action: none must not eat the node\'s own @tap — '
          'on web it only suppresses scrolling',
    );
  });
}
