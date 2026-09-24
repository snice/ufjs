// CSS `overflow: hidden` clips the box's CONTENT; the box's own
// box-shadow lies outside and stays visible. vant's Popover content is
// `overflow: hidden; border-radius: 8px; box-shadow: …` — drawn inside the
// clip, the app showed no shadow at all (specs/129).
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

MirrorTree _boxTree(String extra) {
  final w = _W();
  w.create(1, 'view');
  w.props(1, '{"style":{"width":200,"height":100}}');
  w.insert(0, 1);
  w.create(2, 'view');
  w.props(
    2,
    '{"style":{"width":100,"height":40,"borderRadius":8,'
    '"backgroundColor":"#ffffff",'
    '"boxShadow":"0 2px 12px rgba(50,50,51,.12)"$extra}}',
  );
  w.insert(1, 2);
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

bool _hasShadow(Widget w) =>
    w is DecoratedBox &&
    w.decoration is BoxDecoration &&
    ((w.decoration as BoxDecoration).boxShadow?.isNotEmpty ?? false);

void main() {
  testWidgets('an overflow:hidden box keeps its shadow outside the clip', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_boxTree(',"overflow":"hidden"')));
    final shadows = find.byWidgetPredicate(_hasShadow);
    // exactly one shadow: the clipped inner box no longer draws its own
    expect(shadows, findsOneWidget);
    // ...and it is not under the clip
    expect(
      find.ancestor(of: shadows, matching: find.byType(ClipRRect)),
      findsNothing,
    );
    expect(
      find.descendant(of: shadows, matching: find.byType(ClipRRect)),
      findsOneWidget,
    );
  });

  testWidgets('a box without overflow:hidden draws its shadow as before', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_boxTree('')));
    expect(find.byWidgetPredicate(_hasShadow), findsOneWidget);
    expect(find.byType(ClipRRect), findsNothing);
  });
}
