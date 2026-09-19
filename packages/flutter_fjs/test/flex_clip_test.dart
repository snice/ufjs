// CSS overflow:hidden on a flex container absorbs its overflowing content:
// children keep their natural layout, the paint clips, and no debug overflow
// is reported — web semantics. The case that matters: flex-shrink:0 items
// running past the box (vant's swipe track is N×100% of flex-shrink:0
// items inside an overflow:hidden view). What these pin down:
//   * such a row clips silently when the box declares overflow:hidden
//   * the same box without overflow:hidden still reports the overflow
//   * the wrap path clips too
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

/// A 100x40 row holding two 80px no-shrink children — 60px of overflow.
MirrorTree _rowTree(String parentExtra, int idBase) {
  final w = _W();
  // an outer box so the row is not a root child (root children grow);
  // per-case ids keep the runs independent
  w.create(idBase, 'view');
  w.props(idBase, '{"style":{"width":200,"height":100}}');
  w.insert(0, idBase);
  w.create(idBase + 1, 'view');
  w.props(
    idBase + 1,
    '{"style":{"width":100,"height":40,"flexDirection":"row"$parentExtra}}',
  );
  w.insert(idBase, idBase + 1);
  for (final id in [idBase + 2, idBase + 3]) {
    w.create(id, 'view');
    w.props(
      id,
      '{"style":{"width":80,"height":20,"flexShrink":0,'
      '"backgroundColor":"#07c160"}}',
    );
    w.insert(idBase + 1, id);
  }
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
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

RenderBox _firstChildBox(WidgetTester tester) {
  return tester.renderObject<RenderBox>(
    find
        .byWidgetPredicate(
          (w) =>
              w is DecoratedBox &&
              (w.decoration as BoxDecoration).color == const Color(0xFF07C160),
        )
        .first,
  );
}

void main() {
  testWidgets('overflow:hidden flex clips its wide children silently', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_rowTree(',"overflow":"hidden"', 10)));
    expect(tester.takeException(), isNull);
    // the children keep their natural layout — only the paint clips, as in
    // CSS
    expect(_firstChildBox(tester).size, const Size(80, 20));
  });

  testWidgets('a visible-overflow flex still reports the overflow', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_rowTree('', 20)));
    expect(tester.takeException(), isNotNull);
  });

  testWidgets('overflow:hidden wrap clips its wide children silently', (
    tester,
  ) async {
    await tester.pumpWidget(
      _render(_rowTree(',"overflow":"hidden","flexWrap":"wrap"', 30)),
    );
    expect(tester.takeException(), isNull);
    expect(_firstChildBox(tester).size, const Size(80, 20));
  });
}
