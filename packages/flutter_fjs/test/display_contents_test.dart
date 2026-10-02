// specs/182: `display: contents` — a box that generates no box. The vapor ⇄
// VDOM slot bridge wraps slot content in one; its children must sit in the
// PARENT's flex line (vant's tabbar items stacked into a column inside it),
// and a child added to it later must reach the screen.
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

Widget _render(MirrorTree tree) => Directionality(
  textDirection: TextDirection.ltr,
  child: FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  ),
);

void main() {
  testWidgets('children of a display:contents box lay out in its parent, and later inserts show', (tester) async {
    final w = _W()
      ..defineStyle(1, '{"flexDirection":"row"}')
      ..defineStyle(2, '{"display":"contents"}')
      ..create(1, 'view')
      ..setStyle(1, 1)
      ..insert(0, 1, 0)
      ..create(2, 'view')
      ..setStyle(2, 2)
      ..insert(1, 2, 0);
    for (final (id, label) in [(3, 'a'), (4, 'b')]) {
      w
        ..create(id, 'text')
        ..setText(id, label)
        ..insert(2, id, id - 3);
    }
    final tree = MirrorTree()
      ..applyFrame(w.frame)
      ..flushDirty();
    await tester.pumpWidget(_render(tree));
    final a = tester.getTopLeft(find.text('a'));
    final b = tester.getTopLeft(find.text('b'));
    // one row: same line, b to the right of a
    expect(b.dy, a.dy);
    expect(b.dx, greaterThan(a.dx));

    tree.applyFrame((_W()
          ..create(5, 'text')
          ..setText(5, 'c')
          ..insert(2, 5, 2))
        .frame);
    tree.flushDirty();
    await tester.pump();
    final c = tester.getTopLeft(find.text('c'));
    expect(c.dy, a.dy);
    expect(c.dx, greaterThan(b.dx));
  });
}
