// `:hover`: the JS style engine sends a node's hover variant as its own op
// (12 SET_HOVER_STYLE), and the renderer swaps it in from a MouseRegion —
// desktop mouse only, no round trip through JS.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';

/// Minimal op-frame writer (same hand-encoding as active_style_test).
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

/// One `view` node with an interned base style and an interned `:hover`
/// variant, mounted under the root. [withActive] adds an `:active` variant
/// too, for the pressed-over-hover layering.
MirrorTree _treeWith({
  required Map<String, Object?> base,
  required Map<String, Object?> hover,
  Map<String, Object?>? active,
}) {
  final w = _W();
  void define(int id, Map<String, Object?> style) {
    final json = utf8.encode(jsonEncode(style));
    w.u8(UiOpCode.defineStyle);
    w.u32(id);
    w.u32(json.length);
    w.raw(json);
  }

  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  define(10, base);
  w.u8(UiOpCode.setStyle);
  w.u32(1);
  w.u32(10);
  w.u32(0);
  define(11, hover);
  w.u8(UiOpCode.hoverStyle);
  w.u32(1);
  w.u32(11);
  if (active != null) {
    define(12, active);
    w.u8(UiOpCode.setStyle);
    w.u32(1);
    w.u32(10);
    w.u32(12);
  }
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

Widget _render(MirrorTree tree) {
  final node = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  );
  return MaterialApp(home: Center(child: node));
}

Color? _boxColor(WidgetTester tester) {
  final container = tester.widget<Container>(find.byType(Container));
  return (container.decoration as BoxDecoration?)?.color;
}

Future<TestGesture> _hover(WidgetTester tester, Offset target) async {
  // MouseRegion only reacts to a mouse kind pointer; touch never hovers,
  // matching mobile browsers.
  final gesture = await tester.createGesture(kind: PointerDeviceKind.mouse);
  await gesture.addPointer(location: Offset.zero);
  await tester.pump();
  await gesture.moveTo(target);
  await tester.pump();
  return gesture;
}

void main() {
  const base = {'width': 100.0, 'height': 100.0, 'backgroundColor': '#ffffff'};
  const hover = {'width': 100.0, 'height': 100.0, 'backgroundColor': '#f2f2f2'};
  const active = {
    'width': 100.0,
    'height': 100.0,
    'backgroundColor': '#eef4ff',
  };

  testWidgets('op 12 sets and clears node.hoverStyle', (tester) async {
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    final json = utf8.encode(jsonEncode(hover));
    w.u8(UiOpCode.defineStyle);
    w.u32(11);
    w.u32(json.length);
    w.raw(json);
    w.u8(UiOpCode.hoverStyle);
    w.u32(1);
    w.u32(11);
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));
    expect(tree.node(1)!.hoverStyleMap, hover);

    // styleId 0 clears, same semantics as SET_STYLE's active slot
    final w2 = _W()..u8(UiOpCode.hoverStyle);
    w2.u32(1);
    w2.u32(0);
    tree.applyFrame(Uint8List.fromList(w2.b));
    expect(tree.node(1)!.hoverStyleMap, isNull);
  });

  testWidgets('a hovered node paints its :hover style, un-hover restores', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_treeWith(base: base, hover: hover)));
    expect(_boxColor(tester), const Color(0xFFFFFFFF));

    final gesture = await _hover(
      tester,
      tester.getCenter(find.byType(Container)),
    );
    expect(_boxColor(tester), const Color(0xFFF2F2F2));

    await gesture.moveTo(const Offset(1, 1));
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFFFFFFF));
  });

  testWidgets('pressed wins over hovered when both apply', (tester) async {
    await tester.pumpWidget(
      _render(_treeWith(base: base, hover: hover, active: active)),
    );
    final gesture = await _hover(
      tester,
      tester.getCenter(find.byType(Container)),
    );
    expect(_boxColor(tester), const Color(0xFFF2F2F2));

    // mouse down = pressed while still hovered: :active lays over :hover
    await gesture.down(tester.getCenter(find.byType(Container)));
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFEEF4FF));

    await gesture.up();
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFF2F2F2));
  });

  testWidgets('touch press does not apply the hover style', (tester) async {
    await tester.pumpWidget(
      _render(_treeWith(base: base, hover: hover, active: active)),
    );
    // a touch pointer entering the node is not a hover
    final press = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFEEF4FF));
    await press.up();
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFFFFFFF));
  });
}
