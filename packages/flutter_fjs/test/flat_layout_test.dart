// specs/195 T021: incremental layout stops where Flutter's relayout boundary
// would — a dirty node whose size is unchanged moves nothing above it. Counted
// with FlatStats.relaidNodes; correctness of the resulting rects / pixels is
// compared with the ordinary renderer through the same sequences.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/flat/flat_layout.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_tree.dart';
import 'support/grid_tree.dart';
import 'support/parity.dart';

Uint8List _text(int id, String t) => (GridFrameWriter()..setText(id, t)).frame;

Future<MirrorTree> _mount(WidgetTester tester, MirrorTree tree, {Size size = const Size(1200, 800)}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  fjsFlatMode = FjsFlatMode.force;
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
  tester.takeException();
  return tree;
}

Future<int> _relaid(WidgetTester tester, MirrorTree tree, Uint8List frame) async {
  FlatStats.reset();
  tree.applyFrame(frame);
  tree.flushDirty();
  await tester.pump();
  tester.takeException();
  return FlatStats.relaidNodes;
}

void main() {
  tearDown(() => fjsFlatMode = FjsFlatMode.auto);

  testWidgets('a same-width text change re-lays exactly one node', (tester) async {
    final tree = await _mount(tester, buildGridTree());
    // ids: grid 1, row 2, cell 3, text 4; "0" -> "1" has the same advance
    expect(await _relaid(tester, tree, _text(4, '1')), 1);
    expect(await _relaid(tester, tree, _text(4, '0')), 1);
    // a text deep in the grid, in another row
    final deep = 2 + 7 * 81 + 1 + 2 * 5 + 1; // row 7, cell 5's text
    expect(await _relaid(tester, tree, _text(deep, '9')), 1);
  });

  testWidgets('a wider text re-lays the text, its cell, and stops at the row the grid pins', (tester) async {
    final tree = await _mount(tester, buildGridTree());
    final n = await _relaid(tester, tree, _text(4, 'wider than before'));
    // text -> cell (its width changed) -> row (laid again; its own size is
    // pinned by the column that stretches it, so the walk ends there)
    expect(n, inInclusiveRange(2, 4), reason: 'relaid $n');
  });

  testWidgets('the same edits, drawn: rects and pixels equal the ordinary renderer', (tester) async {
    Uint8List frame(int id, String t) => _text(id, t);
    final t = FixtureTree();
    final g = t.view(0);
    final texts = <int>[];
    for (var r = 0; r < 4; r++) {
      final row = t.view(g, {'flexDirection': 'row'});
      for (var c = 0; c < 5; c++) {
        final cell = t.view(row, {'backgroundColor': '#85d8b4', 'margin': '0.5px'});
        texts.add(t.text(cell, '$c', {'fontSize': '10px', 'lineHeight': '10px'}));
      }
    }
    final first = t.frames;
    await _sequenceParity(tester, [
      first,
      frame(texts[0], '1'), // same width
      frame(texts[3], 'a much longer text'), // wider: cell and row change size
      frame(texts[3], '3'), // back
      frame(texts[7], 'xx'),
    ]);
  });

  testWidgets('a child of a two-pass flex always propagates (shrink-to-fit column in a centring row)', (tester) async {
    final t = FixtureTree();
    final row = t.view(0, {'flexDirection': 'row', 'backgroundColor': '#eeeeee'}); // centres its items
    final col = t.view(row, {'backgroundColor': '#ddddff'}); // stretch column under a non-stretching parent
    final a = t.text(col, 'ab', {'fontSize': '12px'});
    t.text(col, 'cdef', {'fontSize': '12px'});
    t.text(row, 'side', {'fontSize': '12px'});
    await _sequenceParity(tester, [
      t.frames,
      _text(a, 'a longer line'),
      _text(a, 'ab'),
    ]);
  });
}

/// Replays [frames] (the first builds the tree) with the flat surface and with
/// the ordinary renderer and compares rects and pixels at every step.
Future<void> _sequenceParity(WidgetTester tester, List<Uint8List> frames) async {
  addTearDown(tester.view.reset);
  final off = await renderSequence(tester, frames, FjsFlatMode.off);
  final on = await renderSequence(tester, frames, FjsFlatMode.force);
  expect(on.length, off.length);
  for (var i = 0; i < off.length; i++) {
    expect(on[i].rects.keys.toSet(), off[i].rects.keys.toSet(), reason: 'step $i');
    for (final id in off[i].rects.keys) {
      final a = off[i].rects[id]!, b = on[i].rects[id]!;
      expect(
        (a.left - b.left).abs() < 0.01 && (a.top - b.top).abs() < 0.01 &&
            (a.width - b.width).abs() < 0.01 && (a.height - b.height).abs() < 0.01,
        isTrue,
        reason: 'step $i node $id: $a vs $b',
      );
    }
    var diff = 0;
    for (var j = 0; j < off[i].pixels.length; j++) {
      if (off[i].pixels[j] != on[i].pixels[j]) diff++;
    }
    expect(diff, 0, reason: 'step $i: $diff differing pixel bytes');
  }
}
