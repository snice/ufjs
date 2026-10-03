// specs/193 T033: a flat surface inside a scroll-view records only what the
// viewport can show. Invisible from outside (a culled frame looks like an
// uncelled one), so asserted with the engine's painted-node counter, plus a
// parity check after a real scroll — which also pins the repaint-on-scroll
// wiring: the surface is its own repaint boundary, so a stale picture would
// show as missing rows.
import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/flat/flat_layout.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/cull.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_tree.dart';
import 'support/parity.dart';

const _rows = 300;

/// scroll-view (300px high) > list view > [_rows] rows of three 20px texts.
MirrorTree _long() {
  final t = FixtureTree();
  final sv = t.node(0, 'scroll-view', style: {'height': '300px'});
  final list = t.view(sv);
  for (var r = 0; r < _rows; r++) {
    final row = t.view(list, {'flexDirection': 'row'});
    for (var c = 0; c < 3; c++) {
      t.text(row, '${r * 3 + c}', {'fontSize': '20px'});
    }
  }
  return t.build();
}

const _nodes = 1 + _rows * 4;

void main() {
  tearDown(() {
    fjsFlatMode = FjsFlatMode.auto;
    fjsDisablePaintCulling = false;
  });

  testWidgets('only the visible rows are recorded', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    fjsFlatMode = FjsFlatMode.force;
    final tree = _long();
    FlatStats.reset();
    await tester.pumpWidget(
      MaterialApp(
        home: Material(
          child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, dispatch: (_, __, {String? text}) {}),
        ),
      ),
    );
    final culled = FlatStats.paintedNodes;
    expect(culled, greaterThan(0));
    expect(culled, lessThan(_nodes ~/ 4), reason: 'painted $culled of $_nodes');

    // control arm: culling off paints every node
    await tester.pumpWidget(const SizedBox());
    fjsDisablePaintCulling = true;
    FlatStats.reset();
    await tester.pumpWidget(
      MaterialApp(
        home: Material(
          child: FjsNodeRenderer(tree: _long(), ids: const [1], dispatch: (_, __, {String? text}) {}),
        ),
      ),
    );
    expect(FlatStats.paintedNodes, _nodes);
  });

  testWidgets('after a real scroll the surface paints the same pixels as the widgets', (tester) async {
    await expectParity(
      tester,
      _long,
      expectSurfaces: 1,
      viewport: const Size(400, 800),
      after: (tester) async {
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -2500));
        await tester.pumpAndSettle();
      },
    );
  });
}
