// `align-self`: one item's cross-axis alignment overrides its parent's
// `align-items` (render/flex.dart, stretch_flex.dart measureCross).
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
}

/// One node: tag, style, children.
class N {
  N(this.style, [this.children = const []]);
  final Map<String, Object?> style;
  final List<N> children;
}

MirrorTree _tree(N root) {
  final w = _W();
  var next = 1;
  void emit(N n, int parent) {
    final id = next++;
    w.u8(UiOpCode.create);
    w.u32(id);
    final tag = utf8.encode('view');
    w.u16(tag.length);
    w.b.addAll(tag);
    final json = utf8.encode(jsonEncode({'style': n.style}));
    w.u8(UiOpCode.setProps);
    w.u32(id);
    w.u32(json.length);
    w.b.addAll(json);
    w.u8(UiOpCode.insert);
    w.u32(parent);
    w.u32(id);
    w.u32(0x7fffffff);
    for (final k in n.children) {
      emit(k, id);
    }
  }

  emit(root, 0);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

Widget _render(MirrorTree tree, {bool scroll = false}) {
  final page = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    grow: false,
    dispatch: (_, __, {String? text}) {},
  );
  return MaterialApp(
    home: Scaffold(
      body: scroll
          ? SingleChildScrollView(child: page)
          : Align(alignment: Alignment.topLeft, child: page),
    ),
  );
}

/// The painted box of the node whose background is [hex].
Rect _box(WidgetTester tester, String hex) {
  final color = Color(int.parse('ff${hex.substring(1)}', radix: 16));
  final finder = find.byWidgetPredicate(
    (w) =>
        w is Container &&
        w.decoration is BoxDecoration &&
        (w.decoration! as BoxDecoration).color == color,
  );
  return tester.getRect(finder);
}

/// A fixed-size leaf.
N _leaf(double w, double h) => N({'width': w, 'height': h});

void main() {
  testWidgets('column: a centred item among stretched ones', (tester) async {
    await tester.pumpWidget(
      _render(
        _tree(
          N(
            {'width': 300, 'backgroundColor': '#000001'},
            [
              N({'backgroundColor': '#000002'}, [_leaf(100, 20)]),
              N(
                {'backgroundColor': '#000003', 'alignSelf': 'center'},
                [_leaf(100, 20)],
              ),
              N(
                {'backgroundColor': '#000004', 'alignSelf': 'flex-end'},
                [_leaf(50, 20)],
              ),
            ],
          ),
        ),
      ),
    );
    final root = _box(tester, '#000001');
    expect(_box(tester, '#000002').width, 300, reason: 'still stretched');
    final centred = _box(tester, '#000003');
    expect(centred.width, 100);
    expect(centred.left - root.left, 100);
    final end = _box(tester, '#000004');
    expect(end.width, 50);
    expect(end.right, root.right);
  });

  testWidgets('row in a scroll view: end and stretch against the tallest', (
    tester,
  ) async {
    // the row's cross axis is unbounded there (the page scrolls
    // vertically) — the plain stretch path falls back to start, so this is
    // the case measureCross exists for
    await tester.pumpWidget(
      _render(
        _tree(
          N(
            {},
            [
              N(
                {
                  'flexDirection': 'row',
                  'alignItems': 'flex-start',
                  'backgroundColor': '#000001',
                },
                [
                  N({'backgroundColor': '#000002'}, [_leaf(40, 60)]),
                  N(
                    {'backgroundColor': '#000003', 'alignSelf': 'flex-end'},
                    [_leaf(40, 20)],
                  ),
                  N(
                    {'backgroundColor': '#000004', 'alignSelf': 'stretch'},
                    [_leaf(40, 10)],
                  ),
                  N({'backgroundColor': '#000005'}, [_leaf(40, 30)]),
                ],
              ),
            ],
          ),
        ),
        scroll: true,
      ),
    );
    final row = _box(tester, '#000001');
    expect(row.height, 60, reason: 'the tallest item, not the viewport');
    final end = _box(tester, '#000003');
    expect(end.height, 20);
    expect(end.bottom, row.bottom);
    expect(_box(tester, '#000004').height, 60, reason: 'stretched');
    final start = _box(tester, '#000005');
    expect(start.height, 30, reason: 'align-items still applies');
    expect(start.top, row.top);
  });

  testWidgets('a centring column keeps its shrink-wrapped width', (
    tester,
  ) async {
    // align-items: center shrink-wraps the column to its widest item; a
    // stretch item stretches to THAT, not to the screen
    await tester.pumpWidget(
      _render(
        _tree(
          N(
            {'alignItems': 'center', 'backgroundColor': '#000001'},
            [
              N({'backgroundColor': '#000002'}, [_leaf(120, 20)]),
              N(
                {'backgroundColor': '#000003', 'alignSelf': 'stretch'},
                [_leaf(40, 20)],
              ),
              N({'backgroundColor': '#000004'}, [_leaf(40, 20)]),
            ],
          ),
        ),
      ),
    );
    final root = _box(tester, '#000001');
    expect(root.width, 120);
    expect(_box(tester, '#000003').width, 120);
    final centred = _box(tester, '#000004');
    expect(centred.width, 40);
    expect(centred.left - root.left, 40);
  });
}
