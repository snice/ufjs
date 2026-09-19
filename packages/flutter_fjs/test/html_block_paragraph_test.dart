// An HTML block box (`div`, marked `htmlBlock` by the Vue renderer) whose
// content is only inline text lays it out as ONE paragraph, as the browser
// does — vant's Field word limit is `<div><span>0</span>/50</div>`. An fjs
// view keeps stacking its children (its web adapter is a flex column).
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

  void bytes(List<int> l) {
    u32(l.length);
    b.addAll(l);
  }
}

void _create(_W w, int id, String tag, int parent, {Map? props, String? text}) {
  w.u8(UiOpCode.create);
  w.u32(id);
  final t = utf8.encode(tag);
  w.u16(t.length);
  w.b.addAll(t);
  if (text != null) {
    w.u8(UiOpCode.setText);
    w.u32(id);
    w.bytes(utf8.encode(text));
  }
  if (props != null) {
    w.u8(UiOpCode.setProps);
    w.u32(id);
    w.bytes(utf8.encode(jsonEncode(props)));
  }
  w.u8(UiOpCode.insert);
  w.u32(parent);
  w.u32(id);
  w.u32(0x7fffffff);
}

/// `<div style="text-align: right"><span>{count}</span>/50</div>`
MirrorTree _wordLimit({required bool htmlBlock, String count = '0'}) {
  final w = _W();
  _create(w, 1, 'view', 0, props: {
    'htmlBlock': htmlBlock,
    'style': {'textAlign': 'right'},
  });
  _create(w, 2, 'text', 1, text: count);
  _create(w, 3, 'text', 1, text: '/');
  _create(w, 4, 'text', 1, text: '50');
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

Widget _render(MirrorTree tree) => MaterialApp(
  home: Scaffold(
    body: FjsNodeRenderer(
      tree: tree,
      ids: tree.rootChildren,
      dispatch: (_, __, {String? text}) {},
    ),
  ),
);

String _paragraphs(WidgetTester tester) => tester
    .widgetList<RichText>(find.byType(RichText))
    .map((r) => r.text.toPlainText())
    .join('|');

void main() {
  testWidgets('an HTML block of inline runs is one paragraph', (tester) async {
    await tester.pumpWidget(_render(_wordLimit(htmlBlock: true)));
    expect(_paragraphs(tester), '0/50');
    // text-align reaches the paragraph: it ends at the box's right edge
    final para = tester.getRect(find.byType(RichText));
    expect(para.right, 800);
  });

  testWidgets('a span change rebuilds the paragraph', (tester) async {
    final tree = _wordLimit(htmlBlock: true);
    await tester.pumpWidget(_render(tree));
    final w = _W()..u8(UiOpCode.setText);
    w.u32(2);
    w.bytes(utf8.encode('7'));
    tree.applyFrame(Uint8List.fromList(w.b));
    tree.flushDirty();
    await tester.pump();
    expect(_paragraphs(tester), '7/50');
  });

  testWidgets('an fjs view keeps stacking its texts', (tester) async {
    await tester.pumpWidget(_render(_wordLimit(htmlBlock: false)));
    expect(_paragraphs(tester), '0|/|50');
  });
}
