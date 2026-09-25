// vant's square grid item — `flex-basis: 25%; height: 0; padding-top: 25%`
// with an absolute `height: 100%` content box: the % padding resolves
// against the ROW's width, lifts the zero border-box height, and the
// absolute child fills the padding box (specs/130).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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

  void props(int id, Map<String, Object?> style) {
    u8(UiOpCode.setProps);
    u32(id);
    final bytes = utf8.encode(jsonEncode({'style': style}));
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

MirrorTree _grid({bool wrap = true}) {
  final w = _W();
  w.create(1, 'view');
  w.props(1, {
    'width': 400,
    'flexDirection': 'row',
    if (wrap) 'flexWrap': 'wrap',
  });
  w.insert(0, 1);
  for (var i = 0; i < 4; i++) {
    final item = 10 + i * 2;
    w.create(item, 'view');
    w.props(item, {
      'position': 'relative',
      'boxSizing': 'border-box',
      'height': 0,
      'flexBasis': '25%',
      'paddingTop': '25%',
    });
    w.insert(1, item);
    w.create(item + 1, 'view');
    w.props(item + 1, {
      'position': 'absolute',
      'top': 0,
      'left': 0,
      'right': 0,
      'height': '100%',
      'padding': '16px 8px',
      'background': '#fff',
    });
    w.insert(item, item + 1);
  }
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

Size _sizeOf(WidgetTester tester, int id) =>
    tester.getSize(find.byKey(ValueKey<int>(id)).first);

void main() {
  for (final wrap in [true, false]) {
    testWidgets('square grid item is as tall as it is wide (wrap: $wrap)', (
      tester,
    ) async {
      await tester.pumpWidget(_render(_grid(wrap: wrap)));
      expect(_sizeOf(tester, 10), const Size(100, 100));
      // the key sits on the Positioned.fill slot; the box is the delegate's
      // child
      final content = find.descendant(
        of: find.byKey(const ValueKey<int>(11)),
        matching: find.byType(CustomSingleChildLayout),
      );
      final slot = tester.renderObject<RenderBox>(content.first);
      final box = (slot as RenderObjectWithChildMixin<RenderBox>).child!;
      expect(box.size, const Size(100, 100));
    });
  }
}
