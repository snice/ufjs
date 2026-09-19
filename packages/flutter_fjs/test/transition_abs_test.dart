// CSS transitions on an absolute box's geometry — left/top/right/bottom/
// width/height. These lengths resolve inside the layout pass (the delegate
// for percentages, plain Positioned for px), so without per-frame
// interpolation a change jumps: vant's progress portion is `width: 70%` and
// its pivot `left: 70%` under `transition: all`. What these pin down:
//   * a percentage width and a percentage left tween against the containing
//     block (the delegate path)
//   * a px inset tweens too (the plain Positioned path)
//   * a property with no track — or duration 0 — still snaps
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

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

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    u16(tag.length);
    str(tag);
  }

  void props(int id, String json) {
    u8(UiOpCode.setProps);
    u32(id);
    final bytes = utf8.encode(json);
    u32(bytes.length);
    b.addAll(bytes);
  }

  void insert(int parent, int child) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(0x7fffffff);
  }
}

/// A 200x40 track with one absolutely positioned box inside — van-progress
/// in miniature. Anchored top-left so global offsets ARE the insets.
MirrorTree _trackTree(String childStyle) {
  final w = _W();
  w.create(1, 'view');
  w.props(1, '{"style":{"width":200,"height":40,"position":"relative"}}');
  w.insert(0, 1);
  w.create(2, 'view');
  w.props(2, '{"style":$childStyle}');
  w.insert(1, 2);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

void _restyle(MirrorTree tree, String childStyle) {
  final w = _W();
  w.props(2, '{"style":$childStyle}');
  tree.applyFrame(Uint8List.fromList(w.b));
}

Widget _render(MirrorTree tree) {
  return MaterialApp(
    home: Align(
      alignment: Alignment.topLeft,
      child: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        dispatch: (_, __, {text}) {},
      ),
    ),
  );
}

RenderBox _childBox(WidgetTester tester) {
  return tester.renderObject(
    find.byWidgetPredicate(
      (w) =>
          w is DecoratedBox &&
          (w.decoration as BoxDecoration).color == const Color(0xFF07C160),
    ),
  );
}

String _portion(String left, String width) =>
    '{"position":"absolute","top":0,"left":$left,"width":$width,'
    '"height":"100%","backgroundColor":"#07c160",'
    '"transition":"all 100ms linear"}';

void main() {
  testWidgets('percentage width of an absolute box tweens', (tester) async {
    final tree = _trackTree(_portion('0', '"40%"'));
    await tester.pumpWidget(_render(tree));
    expect(_childBox(tester).size.width, closeTo(80, 0.01));

    _restyle(tree, _portion('0', '"100%"'));
    await tester.pumpWidget(_render(tree));
    // the first frame after the change still shows the old size
    expect(_childBox(tester).size.width, closeTo(80, 0.01));

    await tester.pump(const Duration(milliseconds: 50));
    final mid = _childBox(tester).size.width;
    expect(mid, greaterThan(81));
    expect(mid, lessThan(199));

    await tester.pump(const Duration(milliseconds: 50));
    expect(_childBox(tester).size.width, closeTo(200, 0.01));
  });

  testWidgets('percentage left of an absolute box tweens', (tester) async {
    final tree = _trackTree(
      '{"position":"absolute","top":"50%","left":"40%","width":20,'
      '"height":20,"backgroundColor":"#07c160",'
      '"transition":"all 100ms linear"}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_childBox(tester).localToGlobal(Offset.zero).dx, closeTo(80, 0.01));

    _restyle(
      tree,
      '{"position":"absolute","top":"50%","left":"100%","width":20,'
      '"height":20,"backgroundColor":"#07c160",'
      '"transition":"all 100ms linear"}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_childBox(tester).localToGlobal(Offset.zero).dx, closeTo(80, 0.01));

    await tester.pump(const Duration(milliseconds: 50));
    final mid = _childBox(tester).localToGlobal(Offset.zero).dx;
    expect(mid, greaterThan(81));
    expect(mid, lessThan(199));

    await tester.pump(const Duration(milliseconds: 50));
    expect(_childBox(tester).localToGlobal(Offset.zero).dx, closeTo(200, 0.01));
  });

  testWidgets('a px inset of an absolute box tweens', (tester) async {
    final tree = _trackTree(
      '{"position":"absolute","top":0,"left":20,"width":20,"height":20,'
      '"backgroundColor":"#07c160","transition":"all 100ms linear"}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_childBox(tester).localToGlobal(Offset.zero).dx, closeTo(20, 0.01));

    _restyle(
      tree,
      '{"position":"absolute","top":0,"left":120,"width":20,"height":20,'
      '"backgroundColor":"#07c160","transition":"all 100ms linear"}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_childBox(tester).localToGlobal(Offset.zero).dx, closeTo(20, 0.01));

    await tester.pump(const Duration(milliseconds: 50));
    final mid = _childBox(tester).localToGlobal(Offset.zero).dx;
    expect(mid, greaterThan(21));
    expect(mid, lessThan(119));

    await tester.pump(const Duration(milliseconds: 50));
    expect(_childBox(tester).localToGlobal(Offset.zero).dx, closeTo(120, 0.01));
  });

  testWidgets('a property the transition does not cover snaps', (tester) async {
    final tree = _trackTree(
      '{"position":"absolute","top":0,"left":0,"width":"40%","height":"100%",'
      '"backgroundColor":"#07c160","transition":"opacity 100ms linear"}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_childBox(tester).size.width, closeTo(80, 0.01));

    _restyle(
      tree,
      '{"position":"absolute","top":0,"left":0,"width":"100%","height":"100%",'
      '"backgroundColor":"#07c160","transition":"opacity 100ms linear"}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_childBox(tester).size.width, closeTo(200, 0.01));
  });
}
