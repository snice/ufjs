// The wheel — the only part of <picker> that is a widget
// (specs/008-picker/plan.md §3.3). Its payload is asserted verbatim in the
// JS tests too (fjs-runtime/test/picker.test.ts drives the same shape), so
// the two platforms stay one contract.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/control_scope.dart';
import 'package:flutter_fjs/src/widgets/picker_view.dart';

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
}

class N {
  N(this.tag, {this.props = const {}, this.text, this.children = const []});

  final String tag;
  final Map<String, Object?> props;
  final String? text;
  final List<N> children;
}

MirrorTree treeOf(List<N> roots) {
  final w = _W();
  var next = 1;

  void emit(N node, int parent) {
    final id = next++;
    w.u8(UiOpCode.create);
    w.u32(id);
    final tag = utf8.encode(node.tag);
    w.u16(tag.length);
    w.raw(tag);
    if (node.text != null) {
      w.u8(UiOpCode.setText);
      w.u32(id);
      final t = utf8.encode(node.text!);
      w.u32(t.length);
      w.raw(t);
    }
    if (node.props.isNotEmpty) {
      w.u8(UiOpCode.setProps);
      w.u32(id);
      final json = utf8.encode(jsonEncode(node.props));
      w.u32(json.length);
      w.raw(json);
    }
    w.u8(UiOpCode.insert);
    w.u32(parent);
    w.u32(id);
    w.u32(0x7fffffff);
    for (final child in node.children) {
      emit(child, id);
    }
  }

  for (final root in roots) {
    emit(root, 0);
  }
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

typedef Events = List<(int, String?)>;

Widget render(MirrorTree tree, Events log) => MaterialApp(
  home: Scaffold(
    body: FjsNodeRenderer(
      tree: tree,
      ids: tree.rootChildren,
      dispatch: (id, type, {String? text}) => log.add((type, text)),
    ),
  ),
);

const int valueChanged = 5;

N column(List<String> items) => N(
  'picker-view-column',
  children: [for (final item in items) N('text', text: item)],
);

N vueColumn(List<String> items) => N(
  'picker-view-column',
  children: [
    N(
      'view',
      props: {
        'style': {'display': 'none'},
      },
    ),
    for (final item in items) N('text', text: item),
  ],
);

void main() {
  setUp(resetFjsWarnOnce);

  testWidgets('renders one wheel per column', (tester) async {
    final tree = treeOf([
      N(
        'picker-view',
        children: [
          column(['一', '二', '三']),
          column(['A', 'B']),
        ],
      ),
    ]);
    await tester.pumpWidget(render(tree, []));
    expect(find.byType(ListWheelScrollView), findsNWidgets(2));
    expect(find.text('一'), findsOneWidget);
    expect(find.text('B'), findsOneWidget);
  });

  testWidgets(
    'value picks the starting item, and past the end takes the last',
    (tester) async {
      final tree = treeOf([
        N(
          'picker-view',
          props: {
            'value': [1, 99],
          },
          children: [
            column(['一', '二', '三']),
            column(['A', 'B']),
          ],
        ),
      ]);
      final log = <(int, String?)>[];
      await tester.pumpWidget(render(tree, log));
      await tester.pumpAndSettle();

      final wheels = tester
          .widgetList<ListWheelScrollView>(find.byType(ListWheelScrollView))
          .toList();
      expect(
        (wheels[0].controller as FixedExtentScrollController).selectedItem,
        1,
      );
      // 99 is past the end of a two-item column -> the last one
      expect(
        (wheels[1].controller as FixedExtentScrollController).selectedItem,
        1,
      );
      // adopting a prop is not a user change
      expect(log, isEmpty);
    },
  );

  testWidgets('settling on an item reports every column once', (tester) async {
    final tree = treeOf([
      N(
        'picker-view',
        props: {'onValueChanged': true},
        children: [
          column(['一', '二', '三']),
          column(['A', 'B']),
        ],
      ),
    ]);
    final log = <(int, String?)>[];
    await tester.pumpWidget(render(tree, log));
    await tester.pumpAndSettle();

    await tester.drag(
      find.byType(ListWheelScrollView).first,
      const Offset(0, -fjsPickerItemHeight),
    );
    await tester.pumpAndSettle();

    expect(log, [(valueChanged, '[1,0]')]);
  });

  testWidgets('vue anchors do not count as wheel items', (tester) async {
    final tree = treeOf([
      N(
        'picker-view',
        props: {
          'value': [2],
          'onValueChanged': true,
        },
        children: [
          vueColumn(['2024', '2025', '2026', '2027']),
        ],
      ),
    ]);
    final log = <(int, String?)>[];
    await tester.pumpWidget(render(tree, log));
    await tester.pumpAndSettle();

    final wheel = tester.widget<ListWheelScrollView>(
      find.byType(ListWheelScrollView),
    );
    expect((wheel.controller as FixedExtentScrollController).selectedItem, 2);
    expect(find.text('2026'), findsOneWidget);
    expect(log, isEmpty);

    await tester.drag(
      find.byType(ListWheelScrollView),
      const Offset(0, -fjsPickerItemHeight),
    );
    await tester.pumpAndSettle();

    expect(log, [(valueChanged, '[3]')]);
  });

  testWidgets('a non-column child is dropped, loudly', (tester) async {
    final tree = treeOf([
      N(
        'picker-view',
        children: [
          column(['一']),
          N('text', text: '我不该在这里'),
        ],
      ),
    ]);
    await tester.pumpWidget(render(tree, []));

    expect(find.byType(ListWheelScrollView), findsOneWidget);
    expect(find.text('我不该在这里'), findsNothing);
  });

  testWidgets('without a height it is five rows tall', (tester) async {
    final tree = treeOf([
      N(
        'picker-view',
        children: [
          column(['一', '二']),
        ],
      ),
    ]);
    await tester.pumpWidget(render(tree, []));

    final size = tester.getSize(find.byType(ListWheelScrollView).first);
    expect(size.height, fjsPickerItemHeight * fjsPickerVisibleRows);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a column that disappears takes its wheel with it', (
    tester,
  ) async {
    // What a linked picker does: three columns become two.
    final tree = treeOf([
      N(
        'picker-view',
        children: [
          column(['一']),
          column(['A']),
          column(['x']),
        ],
      ),
    ]);
    await tester.pumpWidget(render(tree, []));
    expect(find.byType(ListWheelScrollView), findsNWidgets(3));

    final w = _W()
      ..u8(UiOpCode.remove)
      // ids are handed out depth-first: picker-view 1, then column/text
      // pairs — so the third column is 6
      ..u32(6);
    tree.applyFrame(Uint8List.fromList(w.b));
    tree.flushDirty();
    await tester.pumpAndSettle();

    expect(find.byType(ListWheelScrollView), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });
}
