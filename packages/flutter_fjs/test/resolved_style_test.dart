// Style parsing is memoized: a computed style shared by N nodes is parsed
// once, not once per node per build. These are the assertions that keep it
// that way — the failure mode being guarded against is silent (everything
// still renders correctly, it just costs O(nodes x getters) string parsing
// on every frame), so nothing else would catch a regression.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_fjs/src/render/style_parse.dart';
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

  void raw(List<int> l) => b.addAll(l);

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
  }

  void defineStyle(int styleId, String json) {
    u8(UiOpCode.defineStyle);
    u32(styleId);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void setStyle(int id, int styleId, [int activeStyleId = 0]) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(styleId);
    u32(activeStyleId);
  }

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }

  Uint8List get frame => Uint8List.fromList(b);
}

/// A root `view` with [rows] children, all resolving to one interned style —
/// the shape a list of similar rows produces.
MirrorTree _rows(int rows) {
  const style =
      '{"backgroundColor":"#1c1c1e","borderColor":"#38383a",'
      '"borderRadius":"8px","padding":"12px 16px","margin":"4px 12px",'
      '"color":"#f2f2f7","fontSize":"15px","boxShadow":"0 1px 2px rgba(0,0,0,.2)"}';
  final w = _W()
    ..create(1, 'view')
    ..insert(0, 1, 0)
    ..defineStyle(1, style);
  for (var i = 0; i < rows; i++) {
    final id = i + 2;
    w
      ..create(id, 'view')
      ..setStyle(id, 1)
      ..insert(1, id, i);
  }
  final tree = MirrorTree()..applyFrame(w.frame);
  return tree;
}

Widget _render(MirrorTree tree) => Directionality(
  textDirection: TextDirection.ltr,
  child: FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  ),
);

void main() {
  setUp(fjsClearParseCaches);

  testWidgets(
    'parsing does not scale with the number of nodes sharing a style',
    (tester) async {
      await tester.pumpWidget(_render(_rows(1)));
      final forOne = fjsParseCalls;
      expect(
        forOne,
        greaterThan(0),
        reason: 'the style should have been parsed',
      );

      fjsClearParseCaches();
      await tester.pumpWidget(_render(_rows(50)));
      // 50 nodes resolve to the same interned style, so the same values are
      // parsed the same number of times as for one node
      expect(fjsParseCalls, forOne);
    },
  );

  testWidgets('a rebuild re-parses nothing', (tester) async {
    final tree = _rows(20);
    await tester.pumpWidget(_render(tree));
    final afterFirst = fjsParseCalls;

    // same tree, fresh widget: this is what every notifyListeners() does today
    await tester.pumpWidget(_render(tree));
    await tester.pump();
    expect(fjsParseCalls, afterFirst);
  });

  testWidgets('a theme switch parses each new value once, not once per node', (
    tester,
  ) async {
    final tree = _rows(50);
    await tester.pumpWidget(_render(tree));
    fjsClearParseCaches();

    // the dark variant: one new DEFINE_STYLE, every row re-pointed at it
    final w = _W()
      ..defineStyle(2, '{"backgroundColor":"#ffffff","color":"#1a1a1a"}');
    for (var i = 0; i < 50; i++) {
      w.setStyle(i + 2, 2);
    }
    tree.applyFrame(w.frame);
    await tester.pumpWidget(_render(tree));

    // two colours in the new style; the exact count is not the point, the
    // point is that it does not grow with the 50 nodes wearing it
    expect(fjsParseCalls, lessThan(10));
  });

  test('a null result is cached, not recomputed', () {
    fjsClearParseCaches();
    expect(parseColor('not-a-colour'), isNull);
    final after = fjsParseCalls;
    expect(parseColor('not-a-colour'), isNull);
    expect(fjsParseCalls, after);
  });

  test('null in costs nothing at all', () {
    fjsClearParseCaches();
    expect(parseColor(null), isNull);
    expect(parseLength(null), isNull);
    expect(fjsParseCalls, 0);
  });

  test('a shared box-shadow list is handed out frozen', () {
    final shadows = parseBoxShadows('0 1px 2px rgba(0,0,0,.2)')!;
    expect(
      identical(shadows, parseBoxShadows('0 1px 2px rgba(0,0,0,.2)')),
      isTrue,
    );
    expect(() => shadows.add(shadows.first), throwsUnsupportedError);
  });

  test('nodes sharing a styleId share one FjsStyle and one padding', () {
    final tree = _rows(3);
    final a = FjsStyle.of(tree.node(2)!);
    final b = FjsStyle.of(tree.node(3)!);
    final c = FjsStyle.of(tree.node(4)!);
    expect(identical(a, b), isTrue);
    expect(identical(a, c), isTrue);
    expect(identical(a.padding, b.padding), isTrue);
    expect(a.padding, const EdgeInsets.fromLTRB(16, 12, 16, 12));
    expect(identical(a.boxBorders(), b.boxBorders()), isTrue);
  });

  test('DEFINE_STYLE then SET_STYLE to a new id drops the old view', () {
    final tree = _rows(2);
    final before = FjsStyle.of(tree.node(2)!);
    final oldPadding = before.padding;
    final w = _W()
      ..defineStyle(2, '{"padding":"4px","backgroundColor":"#ffffff"}');
    for (var i = 0; i < 2; i++) {
      w.setStyle(i + 2, 2);
    }
    tree.applyFrame(w.frame);
    final after = FjsStyle.of(tree.node(2)!);
    expect(identical(after, before), isFalse);
    expect(identical(after.padding, oldPadding), isFalse);
    expect(after.padding, const EdgeInsets.all(4));
    expect(after.backgroundColor, const Color(0xFFFFFFFF));
  });

  test('pressed overlay does not write through the interned base', () {
    const baseJson =
        '{"padding":"12px 16px","backgroundColor":"#111111"}';
    const activeJson =
        '{"padding":"0px","backgroundColor":"#ff0000"}';
    final w = _W()
      ..create(1, 'view')
      ..insert(0, 1, 0)
      ..defineStyle(1, baseJson)
      ..defineStyle(2, activeJson)
      ..create(2, 'view')
      ..setStyle(2, 1, 2)
      ..insert(1, 2, 0);
    final tree = MirrorTree()..applyFrame(w.frame);
    final node = tree.node(2)!;
    final base = FjsStyle.of(node);
    final pad = base.padding;
    final bg = base.backgroundColor;
    expect(pad, const EdgeInsets.fromLTRB(16, 12, 16, 12));

    final pressed = FjsStyle.stateOf(node, pressed: true);
    expect(identical(pressed, base), isFalse);
    expect(pressed.padding, EdgeInsets.zero);
    expect(pressed.backgroundColor, const Color(0xFFFF0000));
    // reading the overlay must not mutate the shared base view
    expect(identical(FjsStyle.of(node), base), isTrue);
    expect(identical(base.padding, pad), isTrue);
    expect(base.backgroundColor, bg);
    expect(base.padding, const EdgeInsets.fromLTRB(16, 12, 16, 12));
    expect(
      identical(pressed, FjsStyle.stateOf(node, pressed: true)),
      isTrue,
    );
  });
}
