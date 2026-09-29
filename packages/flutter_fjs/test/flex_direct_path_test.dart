// specs/156: most flex boxes are built directly instead of inside a
// LayoutBuilder, and a column's stretch-or-start choice moved from that
// builder into RenderFjsFlex. The two paths must lay out the same: every
// fixture here is rendered both ways and every node's box compared.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/flex.dart' show debugFjsFlexDirectPath;
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

class _W {
  final List<int> b = [];
  int _next = 1;
  void u8(int v) => b.add(v & 0xff);
  void u32(int v) {
    final d = ByteData(4)..setUint32(0, v, Endian.little);
    b.addAll(d.buffer.asUint8List());
  }

  void _str32(String s) {
    final bytes = utf8.encode(s);
    u32(bytes.length);
    b.addAll(bytes);
  }

  /// A node under [parent] (0 = root) with [style]; returns its id.
  int node(int parent, String tag, String style, {String? text}) {
    final id = _next++;
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    b
      ..add(t.length & 0xff)
      ..add(t.length >> 8)
      ..addAll(t);
    u8(UiOpCode.setProps);
    u32(id);
    _str32('{"style":{$style}}');
    if (text != null) {
      u8(UiOpCode.setText);
      u32(id);
      _str32(text);
    }
    u8(UiOpCode.insert);
    u32(parent);
    u32(id);
    u32(0x7fffffff);
    return id;
  }
}

/// Every node's laid-out box, by id (the outermost keyed widget of each).
Future<Map<int, Rect>> _layout(
  WidgetTester tester,
  void Function(_W w) build, {
  required bool direct,
  bool scrollable = false,
  Axis scrollAxis = Axis.vertical,
}) async {
  final w = _W();
  build(w);
  final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
  debugFjsFlexDirectPath = direct;
  try {
    final node = FjsNodeRenderer(tree: tree, ids: tree.rootChildren, dispatch: (_, __, {String? text}) {});
    await tester.pumpWidget(
      MaterialApp(
        home: Align(
          alignment: Alignment.topLeft,
          child: scrollable ? SingleChildScrollView(scrollDirection: scrollAxis, child: node) : node,
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    final out = <int, Rect>{};
    for (var id = 1; id < w._next; id++) {
      final f = find.byKey(ValueKey<int>(id));
      if (f.evaluate().isEmpty) continue;
      out[id] = tester.getRect(f.first);
    }
    // a fresh tree for the other path
    await tester.pumpWidget(const SizedBox());
    return out;
  } finally {
    debugFjsFlexDirectPath = true;
  }
}

Future<void> _same(
  WidgetTester tester,
  void Function(_W w) build, {
  bool scrollable = false,
  Axis scrollAxis = Axis.vertical,
}) async {
  final lb = await _layout(tester, build, direct: false, scrollable: scrollable, scrollAxis: scrollAxis);
  final direct = await _layout(tester, build, direct: true, scrollable: scrollable, scrollAxis: scrollAxis);
  expect(lb, isNotEmpty);
  expect(direct, lb);
}

void main() {
  // flat-4050's shape: rows of cells, each a column (unbounded width inside
  // its row: the stretch lays out as start) with a text
  void cells(_W w) {
    final root = w.node(0, 'view', '');
    final box = w.node(root, 'view', '');
    for (var r = 0; r < 3; r++) {
      final row = w.node(box, 'view', '"flexDirection":"row"');
      for (var i = 0; i < 4; i++) {
        final cell = w.node(row, 'view', '"backgroundColor":"#85d8b4","margin":0.5');
        w.node(cell, 'text', '"fontSize":5', text: '${i * 7}');
      }
    }
  }

  testWidgets('rows of cells', (tester) => _same(tester, cells));
  testWidgets('rows of cells in a horizontal scroller', (tester) =>
      _same(tester, cells, scrollable: true, scrollAxis: Axis.horizontal));

  // a stretch column inside a shrink-to-fit box (align-items: center): its
  // items size to the widest of them, then stretch to that — the two-pass
  // path the adaptive marker must leave as it was
  void shrinkToFit(_W w) {
    final root = w.node(0, 'view', '');
    final centred = w.node(root, 'view', '"alignItems":"center","width":300');
    final inner = w.node(centred, 'view', '"backgroundColor":"#eeeeee","padding":4');
    w.node(inner, 'view', '"backgroundColor":"#dd524d"').let((a) => w.node(a, 'text', '', text: 'short'));
    w.node(inner, 'view', '"backgroundColor":"#4cd964"').let((b) => w.node(b, 'text', '', text: 'a much longer line'));
    final nested = w.node(inner, 'view', '');
    w.node(nested, 'view', '"backgroundColor":"#007aff"').let((c) => w.node(c, 'text', '', text: 'nested'));
  }

  testWidgets('a stretch column inside a shrink-to-fit box', (tester) => _same(tester, shrinkToFit));
  testWidgets('the same inside a horizontal scroller', (tester) =>
      _same(tester, shrinkToFit, scrollable: true, scrollAxis: Axis.horizontal));

  // bounded stretch, px gap, justify, a row aligned at the end
  void mixed(_W w) {
    final root = w.node(0, 'view', '');
    final col = w.node(root, 'view', '"height":200,"rowGap":6,"justifyContent":"space-between"');
    for (var i = 0; i < 3; i++) {
      final item = w.node(col, 'view', '"backgroundColor":"#eeeeee","paddingLeft":${i * 3}');
      w.node(item, 'text', '', text: 'item $i');
    }
    final row = w.node(root, 'view', '"flexDirection":"row","alignItems":"flex-end","columnGap":4');
    for (var i = 0; i < 3; i++) {
      final c = w.node(row, 'view', '"backgroundColor":"#dddddd"');
      for (var k = 0; k <= i; k++) {
        w.node(c, 'text', '', text: 'l$k');
      }
    }
  }

  testWidgets('bounded stretch, gap, justify, end-aligned row', (tester) => _same(tester, mixed));
  testWidgets('the same in a vertical scroller', (tester) => _same(tester, mixed, scrollable: true));
}

extension<T> on T {
  R let<R>(R Function(T) f) => f(this);
}
