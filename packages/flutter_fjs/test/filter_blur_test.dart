// specs/222: CSS `filter: blur()` on a node — drawn as an ImageFiltered around
// the node's content; every other filter function is named once and ignored.
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/control_scope.dart'
    show resetFjsWarnOnce;

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

/// One 100x100 view whose style carries [filter] (null: no `filter` key).
MirrorTree _tree(Object? filter) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final style = <String, Object?>{
    'width': 100,
    'height': 100,
    'backgroundColor': '#ff0000',
    if (filter != null) 'filter': filter,
  };
  final json = utf8.encode(jsonEncode({'style': style}));
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

Widget _host(MirrorTree tree) => MaterialApp(
  home: Center(
    child: FjsNodeRenderer(
      tree: tree,
      ids: const [1],
      dispatch: (id, type, {String? text}) {},
    ),
  ),
);

/// The ImageFiltered widgets inside the app's own subtree (MaterialApp adds
/// none of its own around the page, but be exact: count under the node).
Finder get _filtered => find.descendant(
  of: find.byType(FjsNodeRenderer),
  matching: find.byType(ImageFiltered),
);

void main() {
  setUp(resetFjsWarnOnce);

  testWidgets('filter: blur(6px) draws an ImageFiltered with that deviation', (
    tester,
  ) async {
    await tester.pumpWidget(_host(_tree('blur(6px)')));
    expect(_filtered, findsOneWidget);
    final widget = tester.widget<ImageFiltered>(_filtered);
    expect(
      widget.imageFilter,
      ui.ImageFilter.blur(
        sigmaX: 6,
        sigmaY: 6,
        tileMode: TileMode.decal,
      ),
    );
  });

  testWidgets('a bare number is px, as for every other length', (tester) async {
    await tester.pumpWidget(_host(_tree('blur(4)')));
    expect(_filtered, findsOneWidget);
  });

  testWidgets('blur(0), none and no filter add no wrapper', (tester) async {
    for (final value in <Object?>['blur(0)', 'blur(0px)', 'none', null]) {
      await tester.pumpWidget(_host(_tree(value)));
      expect(_filtered, findsNothing, reason: '$value');
    }
  });

  testWidgets('layout is untouched: the node keeps its size', (tester) async {
    await tester.pumpWidget(_host(_tree('blur(8px)')));
    final box = tester.getSize(find.byType(FjsNodeRenderer));
    expect(box.width, 100);
    expect(box.height, 100);
  });

  testWidgets('other filter functions are ignored and named once', (
    tester,
  ) async {
    final messages = <String>[];
    final previous = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) messages.add(message);
    };
    try {
      await tester.pumpWidget(_host(_tree('brightness(.5)')));
      expect(_filtered, findsNothing);
      // rebuild: still warned only once
      await tester.pumpWidget(_host(_tree('brightness(.5)')));
    } finally {
      // flutter_test insists a foundation debug variable is back to its
      // default before the test body returns (a tearDown is too late)
      debugPrint = previous;
    }
    final warned = messages.where((m) => m.contains('brightness')).toList();
    expect(warned, hasLength(1));
  });

  testWidgets('blur next to another function keeps the blur', (tester) async {
    await tester.pumpWidget(_host(_tree('blur(4px) brightness(.5)')));
    expect(_filtered, findsOneWidget);
  });
}
