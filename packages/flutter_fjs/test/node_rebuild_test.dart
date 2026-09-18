// Rebuild granularity. The property under test is invisible from the outside
// — the tree renders correctly either way — so it is asserted by counting
// node builds. Before per-node views, one setText rebuilt the whole page.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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

  void raw(List<int> l) => b.addAll(l);

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
  }

  void setText(int id, String text) {
    u8(UiOpCode.setText);
    u32(id);
    final t = utf8.encode(text);
    u32(t.length);
    raw(t);
  }

  void setProps(int id, String json) {
    u8(UiOpCode.setProps);
    u32(id);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
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

  void removeChild(int parent, int child) {
    u8(UiOpCode.removeChild);
    u32(parent);
    u32(child);
  }

  Uint8List get frame => Uint8List.fromList(b);
}

// small enough that the rows fit the default test surface without overflowing
const _rows = 8;

/// root > `_rows` rows, each with one text child. Row i has id 2 + i * 2,
/// its text child 3 + i * 2.
int _rowId(int i) => 2 + i * 2;
int _textId(int i) => 3 + i * 2;

MirrorTree _tree() {
  final w = _W()
    ..create(1, 'view')
    ..insert(0, 1, 0);
  for (var i = 0; i < _rows; i++) {
    w
      ..create(_rowId(i), 'view')
      ..insert(1, _rowId(i), i)
      ..create(_textId(i), 'text')
      ..setText(_textId(i), 'row $i')
      ..insert(_rowId(i), _textId(i), 0);
  }
  // the engine flushes once per frame, so the mount frame's dirty set must
  // not still be pending when a later frame is applied — otherwise every node
  // signals on the next flush and nothing looks granular
  return MirrorTree()
    ..applyFrame(w.frame)
    ..flushDirty();
}

Widget _render(MirrorTree tree) => Directionality(
  textDirection: TextDirection.ltr,
  child: FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  ),
);

/// Applies a frame the way the engine does: mutate, then release the
/// per-node signals in one go.
Future<void> apply(WidgetTester tester, MirrorTree tree, _W w) async {
  tree.applyFrame(w.frame);
  tree.flushDirty();
  await tester.pump();
}

void main() {
  testWidgets('editing one leaf does not rebuild the page', (tester) async {
    final tree = _tree();
    await tester.pumpWidget(_render(tree));
    expect(find.text('row 0'), findsOneWidget);

    FjsNodeRenderer.buildCount = 0;
    await apply(tester, tree, _W()..setText(_textId(7), 'changed'));

    expect(find.text('changed'), findsOneWidget);
    // the text node, plus its row (a parent re-collects its children, and
    // reads their position/flexGrow while laying itself out)
    expect(
      FjsNodeRenderer.buildCount,
      lessThanOrEqualTo(4),
      reason: 'a leaf edit must not cost one build per node on the page',
    );
  });

  testWidgets('restyling one node does not rebuild the page', (tester) async {
    final tree = _tree();
    await tester.pumpWidget(_render(tree));

    FjsNodeRenderer.buildCount = 0;
    await apply(
      tester,
      tree,
      _W()
        ..defineStyle(1, '{"backgroundColor":"#ff0000"}')
        ..setStyle(_rowId(3), 1),
    );
    expect(FjsNodeRenderer.buildCount, lessThanOrEqualTo(4));
  });

  testWidgets('a theme switch does rebuild everything', (tester) async {
    // the complement: when every node genuinely changed, every node rebuilds.
    // Granularity is about not doing work, not about skipping real work.
    final tree = _tree();
    await tester.pumpWidget(_render(tree));

    final w = _W()..defineStyle(9, '{"backgroundColor":"#101114"}');
    for (var i = 0; i < _rows; i++) {
      w.setStyle(_rowId(i), 9);
    }
    FjsNodeRenderer.buildCount = 0;
    await apply(tester, tree, w);
    expect(FjsNodeRenderer.buildCount, greaterThanOrEqualTo(_rows));
  });

  testWidgets('inserting a child rebuilds the parent, not its siblings', (
    tester,
  ) async {
    final tree = _tree();
    await tester.pumpWidget(_render(tree));

    FjsNodeRenderer.buildCount = 0;
    await apply(
      tester,
      tree,
      _W()
        ..create(999, 'text')
        ..setText(999, 'added')
        ..insert(_rowId(5), 999, 1),
    );

    expect(find.text('added'), findsOneWidget);
    // row 5, its new child, and the root re-collecting its children
    expect(FjsNodeRenderer.buildCount, lessThanOrEqualTo(6));
  });

  testWidgets('a child becoming hidden makes its parent re-collect', (
    tester,
  ) async {
    // display:none is evaluated by the PARENT when it gathers its children,
    // so a child-only signal would leave the row showing a gap. This is the
    // test that fails if the parent is not marked alongside the child.
    final tree = _tree();
    await tester.pumpWidget(_render(tree));
    expect(find.text('row 5'), findsOneWidget);

    await apply(
      tester,
      tree,
      _W()
        ..defineStyle(2, '{"display":"none"}')
        ..setStyle(_textId(5), 2),
    );
    expect(find.text('row 5'), findsNothing);
  });

  testWidgets('a removed child leaves the tree', (tester) async {
    final tree = _tree();
    await tester.pumpWidget(_render(tree));
    expect(find.text('row 4'), findsOneWidget);

    await apply(tester, tree, _W()..removeChild(_rowId(4), _textId(4)));
    expect(find.text('row 4'), findsNothing);
  });

  testWidgets('a reorder moves rows without rebuilding their subtrees', (
    tester,
  ) async {
    final tree = _tree();
    await tester.pumpWidget(_render(tree));

    FjsNodeRenderer.buildCount = 0;
    // move the last row to the front, the shape a keyed v-for reorder makes
    await apply(tester, tree, _W()..insert(1, _rowId(_rows - 1), 0));
    await tester.pump();

    expect(find.text('row ${_rows - 1}'), findsOneWidget);
    expect(
      FjsNodeRenderer.buildCount,
      lessThanOrEqualTo(4),
      reason: 'a move is a slot change, not a rebuild',
    );
  });
}
