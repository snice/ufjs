// Percentage `gap` and % border-radius on a %-sized box (spec 079): the gap
// is a fraction of the container's own size along the gap's axis (CSS gap
// semantics), resolved inside the flex LayoutBuilder; a % radius on a
// relative size resolves against the size the box actually gets.
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
}

/// A row/column container [containerProps] with three 50×50 children. The
/// container sits under a plain root on purpose: the page ROOT gives its
/// children a default flex-grow (renderer rule), which would turn every
/// slot into an Expanded and mask the gap geometry.
MirrorTree _treeWith(Map<String, Object?> containerProps) {
  final w = _W();
  void props(int id, Map<String, Object?> p, String tag) {
    w.u8(UiOpCode.create);
    w.u32(id);
    w.u16(tag.length);
    w.str(tag);
    w.u8(UiOpCode.setProps);
    w.u32(id);
    final json = utf8.encode(jsonEncode(p));
    w.u32(json.length);
    w.raw(json);
  }

  props(1, {'style': {'width': 300, 'height': 60}}, 'view');
  props(2, containerProps, 'view');
  w.u8(UiOpCode.insert);
  w.u32(1);
  w.u32(2);
  w.u32(0);
  for (var i = 0; i < 3; i++) {
    props(3 + i, {
      'style': {'width': 50, 'height': 50},
    }, 'view');
    w.u8(UiOpCode.insert);
    w.u32(2);
    w.u32(3 + i);
    w.u32(i);
  }
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

Widget _render(MirrorTree tree) {
  final node = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  );
  return MaterialApp(home: Center(child: node));
}

List<Offset> _childTops(WidgetTester tester) => tester
    .widgetList<SizedBox>(
      find.byWidgetPredicate((w) => w is SizedBox && w.width == 50.0),
    )
    .map((w) => tester.getTopLeft(find.byWidget(w)))
    .toList();

void main() {
  testWidgets('a % main-axis gap is a fraction of the row width', (
    tester,
  ) async {
    // 300px container, `gap: 10%` on the main axis (a row's main-axis gap
    // is column-gap → 30px between 50px children)
    final tree = _treeWith({
      'style': {
        'width': 300,
        'height': 60,
        'flexDirection': 'row',
        'gap': '10%',
      },
    });
    await tester.pumpWidget(_render(tree));
    final tops = _childTops(tester);
    expect(tops.length, 3);
    // the row is centred on the screen; the 30px gaps are the deltas
    expect(tops[1].dx - tops[0].dx, closeTo(80, 0.5));
    expect(tops[2].dx - tops[1].dx, closeTo(80, 0.5));
  });

  testWidgets('a wrap container takes the % gap as its run spacing', (
    tester,
  ) async {
    final tree = _treeWith({
      'style': {
        'width': 300,
        'height': 60,
        'flexDirection': 'row',
        'flexWrap': 'wrap',
        'gap': '10%',
      },
    });
    await tester.pumpWidget(_render(tree));
    final tops = _childTops(tester);
    expect(tops.length, 3);
    // Wrap lays the three 50px children on one line with 30px spacing
    expect(tops[1].dx - tops[0].dx, closeTo(80, 0.5));
    expect(tops[2].dx - tops[1].dx, closeTo(80, 0.5));
  });

  testWidgets('an absolute gap still lands on the run', (tester) async {
    final tree = _treeWith({
      'style': {
        'width': 300,
        'height': 60,
        'flexDirection': 'row',
        'gap': 12,
      },
    });
    await tester.pumpWidget(_render(tree));
    final tops = _childTops(tester);
    expect(tops[1].dx - tops[0].dx, 62);
    expect(tops[2].dx - tops[1].dx, 62);
  });

  testWidgets('a % border-radius resolves against the resolved size', (
    tester,
  ) async {
    // `width: 50%` of a 200px parent + `border-radius: 50%` → a 100×100
    // circle; the corners follow the size the box really gets (spec 079)
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.setProps);
    w.u32(1);
    final parent = utf8.encode(
      jsonEncode({'style': {'width': 200, 'height': 120}}),
    );
    w.u32(parent.length);
    w.raw(parent);
    w.u8(UiOpCode.create);
    w.u32(2);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.setProps);
    w.u32(2);
    final child = utf8.encode(
      jsonEncode({
        'style': {
          'flexGrow': 0,
          'width': '50%',
          'height': 100,
          'borderRadius': '50%',
        },
      }),
    );
    w.u32(child.length);
    w.raw(child);
    w.u8(UiOpCode.insert);
    w.u32(1);
    w.u32(2);
    w.u32(0);
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));

    await tester.pumpWidget(_render(tree));
    final decoration =
        tester.widget<Container>(find.byType(Container)).decoration
            as BoxDecoration;
    // Radius.elliptical(50, 50) == Radius.circular(50)
    expect(decoration.borderRadius, BorderRadius.circular(50));
  });
}
