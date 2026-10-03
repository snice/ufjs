// specs/193 T032: a node inside a flat surface has no element, yet JS reads its
// box through `fjs.ui.rect` (getBoundingClientRect). The answer must be the one
// the ordinary path gives.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/geometry.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/registry/host.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_tree.dart';
import 'support/grid_tree.dart';

Future<Map<int, List<double>>> _rects(
  WidgetTester tester,
  MirrorTree tree,
  FjsFlatMode mode,
  List<int> ids,
) async {
  fjsFlatMode = mode;
  tester.view.physicalSize = const Size(1200, 800); // the 4050 grid is ~800px wide
  tester.view.devicePixelRatio = 1;
  final host = HostRegistry();
  registerGeometryHostModules(host: host, tree: tree);
  await tester.pumpWidget(
    MaterialApp(
      home: Material(
        child: Align(
          alignment: Alignment.topLeft,
          child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {}),
        ),
      ),
    ),
  );
  final out = <int, List<double>>{};
  for (final id in ids) {
    final raw = host.invoke('fjs.ui.rect', [id]).value;
    out[id] = [for (final v in jsonDecode(raw! as String) as List) (v as num).toDouble()];
  }
  await tester.pumpWidget(const SizedBox());
  return out;
}

void main() {
  tearDown(() => fjsFlatMode = FjsFlatMode.auto);

  testWidgets('fjs.ui.rect inside a surface equals the ordinary path, node by node', (tester) async {
    addTearDown(tester.view.reset);
    List<int> pick(MirrorTree t) => [for (final n in t.allNodes) n.id]..sort();
    final ordinary = buildGridTree();
    final ids = pick(ordinary).where((i) => i % 7 == 1 || i < 6).toList();
    final off = await _rects(tester, ordinary, FjsFlatMode.off, ids);
    final on = await _rects(tester, buildGridTree(), FjsFlatMode.force, ids);
    expect(on.keys, off.keys);
    for (final id in ids) {
      for (var i = 0; i < 4; i++) {
        expect(on[id]![i], closeTo(off[id]![i], 0.01), reason: 'node $id component $i: ${off[id]} vs ${on[id]}');
      }
    }
  });

  testWidgets('a removed node answers null instead of a stale rect', (tester) async {
    addTearDown(tester.view.reset);
    fjsFlatMode = FjsFlatMode.force;
    final t = FixtureTree();
    final r = t.view(0);
    final a = t.text(r, 'a');
    t.text(r, 'b');
    final tree = t.build();
    final host = HostRegistry();
    registerGeometryHostModules(host: host, tree: tree);
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    await tester.pumpWidget(
      MaterialApp(
        home: Material(
          child: Align(
            alignment: Alignment.topLeft,
            child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {}),
          ),
        ),
      ),
    );
    expect(host.invoke('fjs.ui.rect', [a]).value, isNotNull);
    tree.applyFrame((GridFrameWriter()..u8(2)..u32(a)).frame); // REMOVE
    tree.flushDirty();
    await tester.pump();
    expect(host.invoke('fjs.ui.rect', [a]).value, isNull);
  });
}
