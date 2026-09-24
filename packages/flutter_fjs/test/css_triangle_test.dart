// A CSS triangle — `width: 0; height: 0` with borders — keeps its border
// box: a border-box never shrinks past its own border (specs/129, vant's
// Popover arrow).
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

MirrorTree _tree(String arrowStyle) {
  final w = _W();
  w.create(1, 'view');
  w.props(1, '{"style":{"width":200,"height":100,"position":"relative"}}');
  w.insert(0, 1);
  w.create(2, 'view');
  w.props(2, '{"style":$arrowStyle}');
  w.insert(1, 2);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

Widget _render(MirrorTree tree) => MaterialApp(
  home: Align(
    alignment: Alignment.topLeft,
    child: FjsNodeRenderer(
      tree: tree,
      ids: tree.rootChildren,
      dispatch: (_, __, {text}) {},
    ),
  ),
);

Size _arrowSize(WidgetTester tester) {
  final box = tester.renderObject<RenderBox>(
    find.byWidgetPredicate(
      (w) =>
          w is DecoratedBox &&
          w.decoration is BoxDecoration &&
          (w.decoration as BoxDecoration).border != null,
    ),
  );
  return box.size;
}

void main() {
  const vantArrow =
      '{"position":"absolute","width":0,"height":0,'
      '"borderColor":"transparent","borderStyle":"solid","borderWidth":6,'
      '"top":0,"borderTopWidth":0,"borderBottomColor":"#fff",'
      '"marginTop":"-6px","left":"50%","transform":"translate(-50%)"}';

  testWidgets('an absolute 0x0 box keeps its border box (vant arrow)', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_tree(vantArrow)));
    expect(_arrowSize(tester), const Size(12, 6));
  });

  testWidgets('an in-flow 0x0 box keeps its border box too', (tester) async {
    await tester.pumpWidget(
      _render(
        _tree(
          '{"width":0,"height":0,"borderStyle":"solid","borderWidth":6,'
          '"borderColor":"transparent","borderTopWidth":0,'
          '"borderBottomColor":"#fff"}',
        ),
      ),
    );
    expect(_arrowSize(tester), const Size(12, 6));
  });
}
