// specs/196: the text-content fast path. Under test:
//  * parity — after every SET_TEXT of a sequence the picture and every node's
//    rect equal what the ordinary rebuild draws;
//  * the path is taken (zero node rebuilds, applied counter) where it should be;
//  * every refusal falls back, is counted by reason, and still draws the same.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/render/paint_only.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_tree.dart';
import 'support/grid_tree.dart';
import 'support/parity.dart';

Uint8List _text(int id, String t) => (GridFrameWriter()..setText(id, t)).frame;

Future<void> expectSame(
  WidgetTester tester,
  List<Uint8List> frames, {
  FjsFlatMode flat = FjsFlatMode.off,
  Size viewport = const Size(800, 1200),
  void Function()? afterOn,
}) async {
  addTearDown(tester.view.reset);
  fjsTextOnlyEnabled = false;
  final off = await renderSequence(tester, frames, flat, viewport: viewport);
  fjsTextOnlyEnabled = true;
  FjsPaintOnlyStats.reset();
  final on = await renderSequence(tester, frames, flat, viewport: viewport);
  afterOn?.call();
  expect(on.length, off.length);
  for (var i = 0; i < off.length; i++) {
    expect(on[i].rects.keys.toSet(), off[i].rects.keys.toSet(), reason: 'step $i: node sets');
    for (final id in off[i].rects.keys) {
      final a = off[i].rects[id]!, b = on[i].rects[id]!;
      expect(
        (a.left - b.left).abs() < 0.01 && (a.top - b.top).abs() < 0.01 &&
            (a.width - b.width).abs() < 0.01 && (a.height - b.height).abs() < 0.01,
        isTrue,
        reason: 'step $i node $id: $a vs $b',
      );
    }
    if (off[i].overflowed || on[i].overflowed) continue;
    var diff = 0;
    for (var j = 0; j < off[i].pixels.length; j++) {
      if (off[i].pixels[j] != on[i].pixels[j]) diff++;
    }
    expect(diff, 0, reason: 'step $i: $diff differing pixel bytes');
  }
}

/// A column of [n] text nodes inside a view, each in the given [style].
(FixtureTree, List<int>) _list(int n, Map<String, Object?> style, {Map<String, Object?> box = const {}}) {
  final t = FixtureTree();
  final root = t.view(0, {'alignItems': 'flex-start', ...box});
  final ids = [for (var i = 0; i < n; i++) t.text(root, 'item $i', style)];
  return (t, ids);
}

void main() {
  setUp(FjsPaintOnlyStats.reset);
  tearDown(() {
    fjsTextOnlyEnabled = true;
    fjsFlatMode = FjsFlatMode.auto;
  });

  group('parity', () {
    testWidgets('same width, wider, narrower, multi-line, back to the original', (tester) async {
      final (t, ids) = _list(6, {'fontSize': '14px'}, box: {'width': '300px'});
      final first = t.frames;
      await expectSame(tester, [
        first,
        _text(ids[1], 'iten 1'), // same width
        _text(ids[2], 'a much longer text that must wrap in a narrow box'),
        _text(ids[3], 'x'),
        _text(ids[2], 'item 2'), // back
      ], afterOn: () {
        expect(FjsPaintOnlyStats.textApplied, 4, reason: '${FjsPaintOnlyStats.textFallbacks}');
        expect(FjsPaintOnlyStats.textFallbacks, isEmpty);
      });
    });

    testWidgets('text-transform, text-align, max-lines and ellipsis', (tester) async {
      final (t, ids) = _list(3, {'fontSize': '14px', 'textTransform': 'uppercase', 'textAlign': 'center', 'maxLines': 2, 'textOverflow': 'ellipsis'}, box: {'width': '200px', 'alignItems': 'stretch'});
      await expectSame(tester, [
        t.frames,
        _text(ids[0], 'one two three four five six seven eight nine'),
        _text(ids[1], 'short'),
      ]);
    });

    testWidgets('many nodes with the same string share one painter', (tester) async {
      final (t, ids) = _list(12, {'fontSize': '12px'});
      await expectSame(tester, [
        t.frames,
        for (final id in ids) _text(id, 'same'),
        for (final id in ids.take(5)) _text(id, 'other'),
      ]);
    });

    testWidgets('texts inside a pressable container (`:active`) and a styled box', (tester) async {
      final w = GridFrameWriter()
        ..defineStyle(1, '{"padding":"8px","backgroundColor":"#eeeeee"}')
        ..defineStyle(2, '{"backgroundColor":"#cccccc"}')
        ..defineStyle(3, '{"fontSize":"14px"}')
        ..create(1, 'view')
        ..insert(0, 1, 0)
        ..create(2, 'view')
        ..setStyle(2, 1, 2)
        ..insert(1, 2, 0)
        ..create(3, 'text')
        ..setStyle(3, 3)
        ..setText(3, 'before')
        ..insert(2, 3, 0);
      await expectSame(tester, [w.frame, _text(3, 'after and longer'), _text(3, 'x')]);
    });

    testWidgets('a text and its colour changing in the same frame', (tester) async {
      final w = GridFrameWriter()
        ..defineStyle(1, '{"fontSize":"14px","color":"#111111"}')
        ..defineStyle(2, '{"fontSize":"14px","color":"#cc0000"}')
        ..create(1, 'view')
        ..insert(0, 1, 0)
        ..create(2, 'text')
        ..setStyle(2, 1)
        ..setText(2, 'plain')
        ..insert(1, 2, 0);
      final both = (GridFrameWriter()..setStyle(2, 2)..setText(2, 'recoloured and longer')).frame;
      await expectSame(tester, [w.frame, both, _text(2, 'again')]);
    });

    testWidgets('inside a flat surface the update goes the flat way, same pixels', (tester) async {
      final (t, ids) = _list(6, {'fontSize': '14px'});
      await expectSame(tester, [t.frames, _text(ids[1], 'longer text here'), _text(ids[4], 'x')], flat: FjsFlatMode.force);
    });
  });

  group('the path is taken', () {
    testWidgets('200 text changes rebuild no node view', (tester) async {
      tester.view.physicalSize = const Size(800, 6000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final (t, ids) = _list(200, {'fontSize': '10px', 'lineHeight': '10px'});
      final tree = t.build();
      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {}),
          ),
        ),
      );
      tester.takeException();
      FjsNodeRenderer.buildCount = 0;
      FjsPaintOnlyStats.reset();
      final w = GridFrameWriter();
      for (final id in ids) {
        w.setText(id, 'n$id');
      }
      tree.applyFrame(w.frame);
      tree.flushDirty();
      await tester.pump();
      tester.takeException();
      expect(FjsNodeRenderer.buildCount, 0);
      expect(FjsPaintOnlyStats.textApplied, 200);

      fjsTextOnlyEnabled = false; // control: the same update rebuilds them
      FjsNodeRenderer.buildCount = 0;
      final w2 = GridFrameWriter();
      for (final id in ids) {
        w2.setText(id, 'm$id');
      }
      tree.applyFrame(w2.frame);
      tree.flushDirty();
      await tester.pump();
      tester.takeException();
      expect(FjsNodeRenderer.buildCount, greaterThan(200));
    });

    testWidgets('the semantics label follows the new text, and a wrapping text grows its parent', (tester) async {
      final handle = tester.ensureSemantics();
      final (t, ids) = _list(1, {'fontSize': '14px'}, box: {'width': '120px', 'backgroundColor': '#dddddd', 'alignItems': 'stretch'});
      final tree = t.build();
      tester.view.physicalSize = const Size(800, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
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
      double height() => (tree.node(1)!.element as Element).renderObject!.paintBounds.height;
      final before = height();
      FjsPaintOnlyStats.reset();
      tree.applyFrame(_text(ids[0], 'this sentence is long enough to wrap onto several lines'));
      tree.flushDirty();
      await tester.pump();
      tester.takeException();
      expect(FjsPaintOnlyStats.textApplied, 1);
      expect(height(), greaterThan(before), reason: 'the parent grew with the wrapped text');
      expect(find.bySemanticsLabel(RegExp('this sentence is long')), findsOneWidget);
      handle.dispose();
    });
  });

  group('refusals fall back, count their reason, and draw the same', () {
    Future<void> refusal(
      WidgetTester tester,
      String reason,
      Uint8List first,
      Uint8List second,
    ) async {
      await expectSame(tester, [first, second], afterOn: () {
        expect(FjsPaintOnlyStats.textFallbacks.keys, contains(reason), reason: '${FjsPaintOnlyStats.textFallbacks}');
        expect(FjsPaintOnlyStats.textApplied, 0);
      });
    }

    testWidgets('a text becoming empty, and an empty one getting text', (tester) async {
      final (t, ids) = _list(3, {'fontSize': '14px'});
      await refusal(tester, 'visibility', t.frames, _text(ids[1], ''));
      final (t2, ids2) = _list(3, {'fontSize': '14px'});
      final f = t2.frames;
      await refusal(tester, 'visibility', f, (GridFrameWriter()..setText(ids2[1], '')..setText(ids2[1], 'back')).frame);
    });

    testWidgets('rich text', (tester) async {
      final t = FixtureTree();
      final r = t.view(0);
      final id = t.node(r, 'text', style: {'fontSize': '14px'}, text: 'x', props: {'richSpans': ['a', 'b']});
      await refusal(tester, 'not-plain-text', t.frames, _text(id, 'y'));
    });

    testWidgets('a span (text inside text)', (tester) async {
      final t = FixtureTree();
      final r = t.view(0);
      final outer = t.text(r, 'outer ', {'fontSize': '14px'});
      final span = t.text(outer, 'span', {'fontSize': '14px', 'color': '#cc0000'});
      await refusal(tester, 'parent', t.frames, _text(span, 'spanned'));
      expect(outer, isNonZero);
    });

    testWidgets('an html block paragraph', (tester) async {
      final t = FixtureTree();
      final block = t.node(0, 'view', props: {'htmlBlock': true});
      final a = t.text(block, 'one', {'fontSize': '14px'});
      t.text(block, 'two', {'fontSize': '14px'});
      await refusal(tester, 'parent', t.frames, _text(a, 'one!'));
    });

    testWidgets('a button label', (tester) async {
      final t = FixtureTree();
      final b = t.node(0, 'button', style: {'fontSize': '14px'});
      final inner = t.view(b);
      final label = t.text(inner, 'Tap', {'fontSize': '14px'});
      await refusal(tester, 'button', t.frames, _text(label, 'Tapped'));
    });

    testWidgets('a display: contents parent', (tester) async {
      final t = FixtureTree();
      final c = t.view(0, {'display': 'contents'});
      final id = t.text(c, 'x', {'fontSize': '14px'});
      await refusal(tester, 'parent-contents', t.frames, _text(id, 'y'));
    });

    testWidgets('a text with a transition', (tester) async {
      final (t, ids) = _list(2, {'fontSize': '14px', 'transition': 'color 1s', 'color': '#111111'});
      await refusal(tester, 'transition', t.frames, _text(ids[0], 'changed'));
    });

    testWidgets('a node held pressed', (tester) async {
      tester.view.physicalSize = const Size(800, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final (t, ids) = _list(2, {'fontSize': '14px'});
      final tree = t.build();
      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {}),
          ),
        ),
      );
      tester.takeException();
      tree.node(ids[0])!.pressed = true;
      FjsPaintOnlyStats.reset();
      tree.applyFrame(_text(ids[0], 'while pressed'));
      tree.flushDirty();
      await tester.pump();
      tester.takeException();
      expect(FjsPaintOnlyStats.textFallbacks.keys, contains('pressed'));
      tree.node(ids[0])!.pressed = false;
    });
  });
}
