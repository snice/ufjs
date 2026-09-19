// `transition: background-color …`: a solid background interpolates through
// the change instead of jumping (spec 045). transform/opacity transitions
// have their own machinery (_TransitionNode); the background rides a
// TweenAnimationBuilder inside the decorated box.
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
}

/// One 100x40 view carrying [style]; called again with new values to move
/// the SAME node's style across frames (that is what a transition needs —
/// a fresh tree would have nothing to animate from).
Uint8List _frame(
  String background,
  String transition, {
  String? gradient,
  String? border,
  int width = 100,
}) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  final style = StringBuffer('{"style":{"width":$width,"height":40');
  if (gradient != null) {
    style.write(',"backgroundImage":$gradient');
  } else if (background.isNotEmpty) {
    style.write(',"backgroundColor":"$background"');
  }
  if (border != null) style.write(',"border":"1px solid $border"');
  if (transition.isNotEmpty) style.write(',"transition":"$transition"');
  style.write('}}');
  final json = utf8.encode(style.toString());
  w.u8(UiOpCode.setProps);
  w.u32(1);
  w.u32(json.length);
  w.b.addAll(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0x7fffffff);
  return Uint8List.fromList(w.b);
}

Widget _render(MirrorTree tree) => MaterialApp(
  home: Align(
    alignment: Alignment.topLeft,
    child: FjsNodeRenderer(
      tree: tree,
      ids: tree.rootChildren,
      dispatch: (_, __, {String? text}) {},
    ),
  ),
);

BoxDecoration _deco(WidgetTester tester) =>
    tester.widget<Container>(find.byType(Container).first).decoration
        as BoxDecoration;

Color? _background(WidgetTester tester) => _deco(tester).color;

void main() {
  testWidgets('background-color interpolates through the change', (
    tester,
  ) async {
    final tree = MirrorTree()
      ..applyFrame(_frame('#dd524d', 'background-color 1s linear'));
    await tester.pumpWidget(_render(tree));
    expect(_background(tester), const Color(0xFFDD524D));

    // move the SAME node's style: red -> blue over 1s linear
    tree.applyFrame(_frame('#1c3d78', 'background-color 1s linear'));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    // halfway: channels are between the endpoints (linear curve)
    final mid = _background(tester)!;
    expect(
      (mid.r * 255.0).round(),
      inInclusiveRange(115, 135),
      reason: '221 -> 28 halfways ~124',
    );
    expect(
      (mid.b * 255.0).round(),
      inInclusiveRange(92, 105),
      reason: '77 -> 120 halfways ~98.5',
    );
    await tester.pump(const Duration(milliseconds: 600));
    expect(_background(tester), const Color(0xFF1C3D78));
  });

  testWidgets('no track: the change is immediate', (tester) async {
    final tree = MirrorTree()..applyFrame(_frame('#dd524d', ''));
    await tester.pumpWidget(_render(tree));
    expect(_background(tester), const Color(0xFFDD524D));

    tree.applyFrame(_frame('#1c3d78', ''));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(_background(tester), const Color(0xFF1C3D78));
  });

  testWidgets('duration 0 is a jump, not an animation', (tester) async {
    final tree = MirrorTree()
      ..applyFrame(_frame('#dd524d', 'background-color 0s'));
    await tester.pumpWidget(_render(tree));
    tree.applyFrame(_frame('#1c3d78', 'background-color 0s'));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(_background(tester), const Color(0xFF1C3D78));
  });

  testWidgets('`all` covers background-color', (tester) async {
    final tree = MirrorTree()..applyFrame(_frame('#dd524d', 'all 1s linear'));
    await tester.pumpWidget(_render(tree));
    tree.applyFrame(_frame('#1c3d78', 'all 1s linear'));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(_background(tester), isNot(const Color(0xFFDD524D)));
    expect(_background(tester), isNot(const Color(0xFF1C3D78)));
    await tester.pump(const Duration(milliseconds: 600));
    expect(_background(tester), const Color(0xFF1C3D78));
  });

  testWidgets('width interpolates and re-lays-out per frame', (tester) async {
    // a size transition is a LAYOUT animation: the resolved px animates and
    // the subtree re-lays-out each frame — same cost as on web
    final tree = MirrorTree()..applyFrame(_frame('#dd524d', 'width 1s linear'));
    await tester.pumpWidget(_render(tree));
    expect(tester.getSize(find.byType(Container)).width, 100);

    tree.applyFrame(_frame('#dd524d', 'width 1s linear', width: 200));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    final mid = tester.getSize(find.byType(Container)).width;
    expect(mid, inInclusiveRange(140, 160), reason: 'halfway of 100 -> 200');
    await tester.pump(const Duration(milliseconds: 600));
    expect(tester.getSize(find.byType(Container)).width, 200);
  });

  testWidgets('width without a track jumps', (tester) async {
    final tree = MirrorTree()..applyFrame(_frame('#dd524d', ''));
    await tester.pumpWidget(_render(tree));
    expect(tester.getSize(find.byType(Container)).width, 100);
    tree.applyFrame(_frame('#dd524d', '', width: 200));
    tree.flushDirty();
    await tester.pump();
    expect(tester.getSize(find.byType(Container)).width, 200);
  });

  testWidgets('a gradient background jumps instead of transitioning', (
    tester,
  ) async {
    // gradients are outside the transition contract (spec 044 note: the
    // TweenAnimationBuilder only carries the solid color); a changed
    // gradient applies on the next frame with no interpolation
    const g1 = '"linear-gradient(90deg, #ff0000, #0000ff)"';
    const g2 = '"linear-gradient(90deg, #00ff00, #ffff00)"';
    final tree = MirrorTree()
      ..applyFrame(_frame('', 'all 1s linear', gradient: g1));
    await tester.pumpWidget(_render(tree));
    expect(_deco(tester).gradient, isA<LinearGradient>());

    tree.applyFrame(_frame('', 'all 1s linear', gradient: g2));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    final gradient = _deco(tester).gradient! as LinearGradient;
    expect(
      (gradient.colors.first.toARGB32() & 0xffffff),
      const Color(0xFF00FF00).toARGB32() & 0xffffff,
    );
  });

  testWidgets('a background that appears fades in from transparent', (
    tester,
  ) async {
    // vant's checkbox: unchecked has no background at all, checked is blue;
    // the tween must already be in the tree before the first color arrives
    final tree = MirrorTree()
      ..applyFrame(_frame('', 'background-color 1s linear'));
    await tester.pumpWidget(_render(tree));
    expect(_background(tester), isNull);

    tree.applyFrame(_frame('#1989fa', 'background-color 1s linear'));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    final mid = _background(tester)!;
    expect(mid.a, inInclusiveRange(0.4, 0.6), reason: 'half faded in');
    await tester.pump(const Duration(milliseconds: 600));
    expect(_background(tester), const Color(0xFF1989FA));
  });

  testWidgets('border-color interpolates through the change', (tester) async {
    final tree = MirrorTree()
      ..applyFrame(_frame('', 'border-color 1s linear', border: '#000000'));
    await tester.pumpWidget(_render(tree));

    tree.applyFrame(_frame('', 'border-color 1s linear', border: '#ffffff'));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    final mid = (_deco(tester).border! as Border).top.color;
    expect((mid.r * 255).round(), inInclusiveRange(115, 140));
    await tester.pump(const Duration(milliseconds: 600));
    expect((_deco(tester).border! as Border).top.color, Colors.white);
  });
}
