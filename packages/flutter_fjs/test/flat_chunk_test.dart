// specs/195 T032: the layered paint. A flat surface slices the children of its
// spine's last node into chunks, each a retained layer: an edit re-records the
// chunks it touches and re-attaches the rest. Counted with
// FlatStats.paintedChunks / reusedChunks; what is drawn is compared with the
// ordinary renderer.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/flat/flat_layout.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/widgets/text.dart' show FjsTextEnvData, FjsTextEnvScope;
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_tree.dart';
import 'support/grid_tree.dart';
import 'support/parity.dart';

Uint8List _text(int id, String t) => (GridFrameWriter()..setText(id, t)).frame;

Widget _page(MirrorTree tree) => MaterialApp(
  home: Material(
    child: Align(
      alignment: Alignment.topLeft,
      child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {}),
    ),
  ),
);

Future<void> _mount(WidgetTester tester, MirrorTree tree) async {
  tester.view.physicalSize = const Size(1200, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  fjsFlatMode = FjsFlatMode.force;
  FlatStats.reset();
  await tester.pumpWidget(_page(tree));
  tester.takeException();
}

Future<void> _apply(WidgetTester tester, MirrorTree tree, Uint8List frame) async {
  FlatStats.reset();
  tree.applyFrame(frame);
  tree.flushDirty();
  await tester.pump();
  tester.takeException();
}

/// A grid of [rows] rows of [cols] text cells (no margins, so a row's height is
/// its text's). Returns the tree and the text ids by row.
(MirrorTree, List<List<int>>) _grid(int rows, int cols, {Map<String, Object?> cell = const {}}) {
  final t = FixtureTree();
  final g = t.view(0);
  final ids = <List<int>>[];
  for (var r = 0; r < rows; r++) {
    final row = t.view(g, {'flexDirection': 'row'});
    final line = <int>[];
    for (var c = 0; c < cols; c++) {
      line.add(t.text(row, '$c', {'fontSize': '10px', 'lineHeight': '10px', ...cell}));
    }
    ids.add(line);
  }
  return (t.build(), ids);
}

void main() {
  tearDown(() => fjsFlatMode = FjsFlatMode.auto);

  testWidgets('an equal text environment rebuilt by the page above invalidates nothing', (tester) async {
    // FjsTextEnvScope makes a NEW environment object each time it rebuilds —
    // on a device, whenever any unrelated part of the page updates
    final seen = <FjsTextEnvData>[];
    Widget scope(Key k) => MaterialApp(
      home: Material(
        child: FjsTextEnvScope(
          key: k,
          child: Builder(
            builder: (context) {
              seen.add(FjsTextEnvData.maybeOf(context)!);
              return const SizedBox();
            },
          ),
        ),
      ),
    );
    await tester.pumpWidget(scope(const ValueKey('a')));
    await tester.pumpWidget(scope(const ValueKey('b'))); // new scope, new env object
    expect(seen.length, greaterThanOrEqualTo(2));
    final first = seen.first, last = seen.last;
    expect(identical(first, last), isFalse, reason: 'the scenario needs two distinct env objects');
    expect(first.sameAs(last), isTrue);

    // and an engine that has packed with one takes the other without dirtying
    final (tree, ids) = _grid(8, 3);
    final engine = FlatEngine();
    expect(engine.pack(tree, tree.node(1)!, first), isTrue);
    for (final n in engine.byId.values) {
      n.dirty = false;
    }
    FlatStats.reset();
    expect(engine.setEnv(last), isTrue);
    expect(engine.byId.values.where((n) => n.dirty), isEmpty, reason: 'an equal env re-keyed paragraphs');
    expect(ids, isNotEmpty);
  });

  testWidgets('first paint records every visible chunk once', (tester) async {
    final (tree, _) = _grid(20, 5);
    await _mount(tester, tree);
    expect(FlatStats.paintedChunks, 20);
    expect(FlatStats.reusedChunks, 0);
  });

  testWidgets('an edit re-records one chunk and re-attaches the others', (tester) async {
    final (tree, ids) = _grid(20, 5);
    await _mount(tester, tree);
    await _apply(tester, tree, _text(ids[7][2], '9')); // same advance
    expect(FlatStats.paintedChunks, 1);
    expect(FlatStats.reusedChunks, 19);
    // a wider text changes its cell's and row's layout, still only its row
    await _apply(tester, tree, _text(ids[3][1], 'wide wide'));
    expect(FlatStats.paintedChunks, 1);
    expect(FlatStats.reusedChunks, 19);
  });

  testWidgets('rows below a taller row move without being re-recorded', (tester) async {
    final (tree, ids) = _grid(12, 4);
    await _mount(tester, tree);
    final w = GridFrameWriter()
      ..defineStyle(900, '{"fontSize":"30px","lineHeight":"30px"}')
      ..setStyle(ids[0][0], 900);
    await _apply(tester, tree, w.frame);
    expect(FlatStats.paintedChunks, 1, reason: 'only the first row changed');
    expect(FlatStats.reusedChunks, 11, reason: 'the rest only moved down');
  });

  testWidgets('moved and edited rows draw what the ordinary renderer draws', (tester) async {
    final t = FixtureTree();
    final g = t.view(0);
    final texts = <int>[];
    for (var r = 0; r < 10; r++) {
      final row = t.view(g, {'flexDirection': 'row', 'backgroundColor': r.isEven ? '#eeeeff' : '#ffeeee'});
      for (var c = 0; c < 3; c++) {
        texts.add(t.text(row, '$r$c', {'fontSize': '12px', 'margin': '1px'}));
      }
    }
    final grow = (GridFrameWriter()
          ..defineStyle(901, '{"fontSize":"24px","margin":"1px"}')
          ..setStyle(texts[0], 901))
        .frame;
    final back = (GridFrameWriter()
          ..defineStyle(902, '{"fontSize":"12px","margin":"1px"}')
          ..setStyle(texts[0], 902))
        .frame;
    addTearDown(tester.view.reset);
    final seq = [t.frames, grow, _text(texts[14], 'edit'), back];
    final off = await renderSequence(tester, seq, FjsFlatMode.off);
    final on = await renderSequence(tester, seq, FjsFlatMode.force);
    for (var i = 0; i < off.length; i++) {
      for (final id in off[i].rects.keys) {
        expect(on[i].rects[id], off[i].rects[id], reason: 'step $i node $id');
      }
      if (off[i].overflowed) continue;
      var diff = 0;
      for (var j = 0; j < off[i].pixels.length; j++) {
        if (off[i].pixels[j] != on[i].pixels[j]) diff++;
      }
      expect(diff, 0, reason: 'step $i: $diff differing pixel bytes');
    }
  });

  testWidgets('fewer than four children: one layer, no chunks', (tester) async {
    final (tree, _) = _grid(3, 4);
    await _mount(tester, tree);
    expect(FlatStats.paintedChunks, 0);
    expect(FlatStats.reusedChunks, 0);
    expect(FlatStats.paintedNodes, greaterThan(0));
  });

  testWidgets('unmount and mount again: the layers are released and rebuilt', (tester) async {
    final (tree, ids) = _grid(8, 3);
    await _mount(tester, tree);
    await tester.pumpWidget(const SizedBox());
    final (tree2, ids2) = _grid(8, 3);
    FlatStats.reset();
    await tester.pumpWidget(_page(tree2));
    tester.takeException();
    expect(FlatStats.paintedChunks, 8);
    await _apply(tester, tree2, _text(ids2[2][1], '7'));
    expect(FlatStats.paintedChunks, 1);
    expect(ids.length, ids2.length);
  });

  testWidgets('a single-child wrapper above the list is part of the spine, not a chunk', (tester) async {
    final t = FixtureTree();
    final outer = t.view(0, {'backgroundColor': '#ddeedd', 'padding': '4px'});
    final inner = t.view(outer, {'backgroundColor': '#eeddee'});
    final texts = <int>[];
    for (var i = 0; i < 6; i++) {
      texts.add(t.text(inner, 'row $i', {'fontSize': '12px'}));
    }
    final tree = t.build();
    await _mount(tester, tree);
    expect(FlatStats.paintedChunks, 6, reason: 'one chunk per row, not one for the wrapper');
    await _apply(tester, tree, _text(texts[4], 'changed'));
    expect(FlatStats.paintedChunks, 1);
    expect(FlatStats.reusedChunks, 5);
  });
}
