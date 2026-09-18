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

  void setStyle(int id, int styleId) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(styleId);
    u32(0);
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
}
