// A reload (tree.clear) restarts node ids from scratch. The scroll offsets
// kept in PageStorage are keyed per node, so without the tree generation in
// the key the fresh tree's scroller would restore the old one's offset —
// the app would come back mid-page instead of at the top.
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

  void str(String s) => b.addAll(utf8.encode(s));
  void raw(List<int> l) => b.addAll(l);

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
    raw(bytes);
  }

  void insert(int parent, int id, int before) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(id);
    u32(before);
  }
}

/// A `scroll-view` (node 1) holding tall rows — enough to scroll.
void _mountPage(MirrorTree tree) {
  final w = _W();
  w.create(1, 'scroll-view');
  w.props(1, '{"style":{"height":300}}');
  w.insert(0, 1, 0);
  for (var i = 0; i < 20; i++) {
    final id = 2 + i;
    w.create(id, 'view');
    w.props(id, '{"style":{"height":100}}');
    w.insert(1, id, 0);
  }
  tree.applyFrame(Uint8List.fromList(w.b));
}

Widget _app(MirrorTree tree) => MaterialApp(
  home: KeyedSubtree(
    key: ValueKey('fjs-tree-${tree.generation}'),
    child: FjsNodeRenderer(
      tree: tree,
      ids: tree.rootChildren,
      dispatch: (_, __, {String? text}) {},
    ),
  ),
);

void main() {
  testWidgets('a reload puts the scroll-view back at the top', (tester) async {
    final tree = MirrorTree();
    _mountPage(tree);
    await tester.pumpWidget(_app(tree));

    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -400),
    );
    await tester.pumpAndSettle();
    final scrolled = tester
        .widget<Scrollable>(find.byType(Scrollable))
        .controller!
        .position
        .pixels;
    expect(scrolled, greaterThan(0));

    // what reloadDev does: clear the tree, then rebuild the same page — the
    // node ids come back identical
    tree.clear();
    _mountPage(tree);
    await tester.pumpWidget(_app(tree));
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<Scrollable>(find.byType(Scrollable))
          .controller!
          .position
          .pixels,
      0,
    );
  });
}
