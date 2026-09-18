// `:active`: the JS style engine sends a node's pressed style alongside its
// normal one, and the renderer swaps between them from the node's own press
// state — no round trip through JS.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';

/// Minimal op-frame writer (same hand-encoding as mirror_tree_test).
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

/// A single `view` node carrying [props], mounted under the root.
MirrorTree _treeWith(String propsJson) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final json = utf8.encode(propsJson);
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

Widget _render(MirrorTree tree, {bool scrollable = false}) {
  final node = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  );
  return MaterialApp(
    home: scrollable ? ListView(children: [node]) : Center(child: node),
  );
}

Color? _boxColor(WidgetTester tester) {
  final container = tester.widget<Container>(find.byType(Container));
  return (container.decoration as BoxDecoration?)?.color;
}

void main() {
  const base = '"style":{"width":100,"height":100,"backgroundColor":"#ffffff"}';
  const active =
      '"activeStyle":{"width":100,"height":100,'
      '"backgroundColor":"#eef4ff"}';

  testWidgets('a pressed node paints its :active style', (tester) async {
    await tester.pumpWidget(_render(_treeWith('{$base,$active,"onTap":true}')));
    expect(_boxColor(tester), const Color(0xFFFFFFFF));

    final press = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await tester.pump(); // the very next frame, not one deadline later
    expect(_boxColor(tester), const Color(0xFFEEF4FF));

    await press.up();
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFFFFFFF));
  });

  testWidgets('shows on pointer down inside a scrollable', (tester) async {
    // The regression this guards: a tap recognizer inside a list only reports
    // onTapDown once it wins the arena — a quick tap is over by then and the
    // pressed style never paints. Pointer down drives it instead.
    await tester.pumpWidget(
      _render(_treeWith('{$base,$active,"onTap":true}'), scrollable: true),
    );
    final press = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFEEF4FF));
    await press.up();
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFFFFFFF));
  });

  testWidgets('a jitter under the drag threshold keeps the press', (
    tester,
  ) async {
    // a mouse inside a scrollable resolves drags at 1px, so anything driven
    // by the gesture arena would drop the press on the smallest wobble
    await tester.pumpWidget(
      _render(_treeWith('{$base,$active,"onTap":true}'), scrollable: true),
    );
    final press = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await tester.pump();
    await press.moveBy(const Offset(3, 0));
    await tester.pump(const Duration(milliseconds: 200));
    expect(_boxColor(tester), const Color(0xFFEEF4FF));
    await press.up();
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFFFFFFF));
  });

  testWidgets('a press that turns into a drag drops the state', (tester) async {
    await tester.pumpWidget(_render(_treeWith('{$base,$active}')));

    final press = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFEEF4FF));

    // the tap recognizer gives up once the pointer travels: a row must not
    // stay highlighted while the list scrolls under the finger
    await press.moveBy(const Offset(0, 60));
    await tester.pump();
    expect(_boxColor(tester), const Color(0xFFFFFFFF));
    await press.up();
  });

  testWidgets('a node without an :active style adds no press handling', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_treeWith('{$base}')));
    expect(find.byType(GestureDetector), findsNothing);
    expect(_boxColor(tester), const Color(0xFFFFFFFF));
  });
  testWidgets('an :active transform reaches the transform wrapper', (
    tester,
  ) async {
    // The regression this guards: the transform wrapper (transitionNode)
    // used to be built from the BASE style only, so a pressed transform —
    // `:active { transform: scale(0.92) }` — never rendered at all (spec
    // 045 实机对拍修出). The state style now drives the wrapper too.
    await tester.pumpWidget(
      _render(
        _treeWith(
          '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff"},'
          '"activeStyle":{"transform":"scale(0.92)"}}',
        ),
      ),
    );
    expect(
      tester.widgetList<Transform>(find.byType(Transform)).isEmpty,
      isTrue,
      reason: 'unpressed, no base transform: no wrapper value',
    );

    final press = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await tester.pump();
    final scales = tester
        .widgetList<Transform>(find.byType(Transform))
        .map((t) => t.transform.storage[0])
        .toList();
    // X scale carries the 2D `scale(0.92)`; getMaxScaleOnAxis would read
    // the untouched Z axis and always report 1.0
    expect(scales, contains(closeTo(0.92, 0.01)));
    await press.up();
  });
}
