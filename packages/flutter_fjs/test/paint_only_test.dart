// specs/194: the paint-only update path. What is under test:
//  * parity — every step of a colour-only update sequence draws the same pixels
//    and gives every node the same rect with the path on as with it off;
//  * the path is really taken (applied counter, zero node rebuilds) for the
//    updates it should take;
//  * every refusal condition falls back (counted by reason) and still draws the
//    same as the ordinary rebuild.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/paint_only.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/grid_tree.dart';
import 'support/parity.dart';

String _j(Map<String, Object?> m) => jsonEncode(m);

/// A small themed list: [rows] items (bg + radius + padding + margin, optional
/// `:active`), each with a title and a meta text. Styles: ids 1.. light,
/// 11.. dark. [extra] is merged into the item style (e.g. a width, to change
/// the wrapper chain).
class _Themed {
  _Themed({this.rows = 6, this.active = true, this.extraItem = const {}});
  final int rows;
  final bool active;
  final Map<String, Object?> extraItem;
  final items = <int>[], titles = <int>[], metas = <int>[];

  Map<String, Object?> item(bool dark) => {
    'flexDirection': 'row', 'alignItems': 'center', 'gap': '8px', 'margin': '0 12px 6px 12px',
    'padding': '12px 16px', 'borderRadius': '8px', 'backgroundColor': dark ? '#1C1C1E' : '#FFFFFF',
    ...extraItem,
  };
  Map<String, Object?> title(bool dark) => {'flexGrow': 1, 'fontSize': '15px', 'color': dark ? '#F5F5F7' : '#1A1A1A'};
  Map<String, Object?> meta(bool dark) => {'fontSize': '12px', 'color': dark ? '#8E8E93' : '#999999'};

  Uint8List first() {
    final w = GridFrameWriter();
    for (final (base, dark) in [(0, false), (10, true)]) {
      w
        ..defineStyle(base + 1, _j(item(dark)))
        ..defineStyle(base + 2, _j({'backgroundColor': dark ? '#2C2C2E' : '#ECECEF'}))
        ..defineStyle(base + 3, _j(title(dark)))
        ..defineStyle(base + 4, _j(meta(dark)));
    }
    w
      ..create(1, 'view')
      ..insert(0, 1, 0);
    var id = 2;
    for (var r = 0; r < rows; r++) {
      final item = id++, t = id++, m = id++;
      items.add(item);
      titles.add(t);
      metas.add(m);
      w
        ..create(item, 'view')
        ..setStyle(item, 1, active ? 2 : 0)
        ..insert(1, item, r)
        ..create(t, 'text')
        ..setStyle(t, 3)
        ..setText(t, 'row $r')
        ..insert(item, t, 0)
        ..create(m, 'text')
        ..setStyle(m, 4)
        ..setText(m, '#${r % 3}') // repeats: shared painters
        ..insert(item, m, 1);
    }
    return w.frame;
  }

  Uint8List theme(bool dark) {
    final base = dark ? 10 : 0;
    final w = GridFrameWriter();
    for (final i in items) {
      w.setStyle(i, base + 1, active ? base + 2 : 0);
    }
    for (final t in titles) {
      w.setStyle(t, base + 3);
    }
    for (final m in metas) {
      w.setStyle(m, base + 4);
    }
    return w.frame;
  }
}

Future<void> expectSame(
  WidgetTester tester,
  List<Uint8List> frames, {
  FjsFlatMode flat = FjsFlatMode.off,
  void Function()? afterOn,
}) async {
  addTearDown(tester.view.reset);
  fjsPaintOnlyEnabled = false;
  final off = await renderSequence(tester, frames, flat);
  fjsPaintOnlyEnabled = true;
  FjsPaintOnlyStats.reset();
  final on = await renderSequence(tester, frames, flat);
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
    var diff = 0;
    for (var j = 0; j < off[i].pixels.length; j++) {
      if (off[i].pixels[j] != on[i].pixels[j]) diff++;
    }
    expect(diff, 0, reason: 'step $i: $diff differing pixel bytes');
  }
}

void main() {
  setUp(() {
    FjsPaintOnlyStats.reset();
    fjsFlatMode = FjsFlatMode.off;
  });
  tearDown(() {
    fjsPaintOnlyEnabled = true;
    fjsFlatMode = FjsFlatMode.auto;
  });

  group('parity', () {
    testWidgets('a themed list, light -> dark -> light -> dark', (tester) async {
      final t = _Themed();
      final frames = [t.first(), t.theme(true), t.theme(false), t.theme(true)];
      await expectSame(tester, frames, afterOn: () {
        expect(FjsPaintOnlyStats.applied, greaterThan(t.rows * 3), reason: 'fallbacks: ${FjsPaintOnlyStats.fallbacks}');
        expect(FjsPaintOnlyStats.fallbacks, isEmpty);
      });
    });

    testWidgets('without :active styles', (tester) async {
      final t = _Themed(active: false);
      await expectSame(tester, [t.first(), t.theme(true), t.theme(false)]);
    });

    testWidgets('different wrapper chains: sized, margin-less, padded boxes', (tester) async {
      for (final extra in <Map<String, Object?>>[
        {'width': '260px', 'height': '40px', 'alignItems': 'flex-start'},
        {'margin': '0px', 'padding': '0px'},
        {'padding': '2px 30px', 'margin': '3px'},
        {'height': '50px'},
      ]) {
        final t = _Themed(rows: 3, extraItem: extra);
        await expectSame(tester, [t.first(), t.theme(true), t.theme(false)]);
      }
    });

    testWidgets('texts that share a painter (same string, same style) recolour independently', (tester) async {
      final t = _Themed(rows: 9);
      await expectSame(tester, [t.first(), t.theme(true)]);
    });

    testWidgets('inside a flat surface the update goes the flat way, same pixels', (tester) async {
      final t = _Themed(rows: 4, active: false);
      await expectSame(tester, [t.first(), t.theme(true), t.theme(false)], flat: FjsFlatMode.force);
    });
  });

  group('the path is taken', () {
    testWidgets('a colour-only update rebuilds no node view', (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final t = _Themed(rows: 30);
      final tree = MirrorTree()
        ..applyFrame(t.first())
        ..flushDirty();
      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {}),
          ),
        ),
      );
      tester.takeException(); // 30 rows overflow the 800px test screen
      FjsNodeRenderer.buildCount = 0;
      FjsPaintOnlyStats.reset();
      tree.applyFrame(t.theme(true));
      tree.flushDirty();
      await tester.pump();
      tester.takeException();
      expect(FjsNodeRenderer.buildCount, 0);
      expect(FjsPaintOnlyStats.applied, 30 * 3);

      // control: the same update with the path off rebuilds the nodes
      fjsPaintOnlyEnabled = false;
      FjsNodeRenderer.buildCount = 0;
      tree.applyFrame(t.theme(false));
      tree.flushDirty();
      await tester.pump();
      tester.takeException();
      expect(FjsNodeRenderer.buildCount, greaterThan(30 * 3));
    });
  });

  group('refusals fall back, count their reason, and draw the same', () {
    // each: a style before / after on one node inside a list; the fallback
    // reason the counter must show
    Future<void> refusal(
      WidgetTester tester,
      String reason,
      Map<String, Object?> before,
      Map<String, Object?> after, {
      String tag = 'view',
      String? text,
      Map<String, Object?>? props,
    }) async {
      final w = GridFrameWriter()
        ..defineStyle(1, _j(before))
        ..defineStyle(2, _j(after))
        ..create(1, 'view')
        ..insert(0, 1, 0)
        ..create(2, tag)
        ..setStyle(2, 1)
        ..insert(1, 2, 0);
      if (props != null) w.setProps(2, _j(props));
      if (text != null) w.setText(2, text);
      final first = w.frame;
      final second = (GridFrameWriter()..setStyle(2, 2)).frame;
      await expectSame(tester, [first, second], afterOn: () {
        expect(FjsPaintOnlyStats.fallbacks.keys, contains(reason), reason: '${FjsPaintOnlyStats.fallbacks}');
        expect(FjsPaintOnlyStats.applied, 0);
      });
    }

    testWidgets('a layout key changes with the colour', (tester) async {
      await refusal(tester, 'non-paint-key', {'backgroundColor': '#ff0000', 'height': '20px'}, {'backgroundColor': '#00ff00', 'height': '40px'});
    });
    testWidgets('a key appears (background from nothing)', (tester) async {
      await refusal(tester, 'keys', {'height': '20px'}, {'height': '20px', 'backgroundColor': '#00ff00'});
    });
    testWidgets('a transition is declared', (tester) async {
      await refusal(tester, 'transition', {'backgroundColor': '#ff0000', 'transition': 'background-color 1s'}, {'backgroundColor': '#00ff00', 'transition': 'background-color 1s'});
    });
    testWidgets('a visible border takes the colour', (tester) async {
      await refusal(tester, 'border', {'backgroundColor': '#ff0000', 'border': '2px solid #000000'}, {'backgroundColor': '#00ff00', 'border': '2px solid #000000'});
    });
    testWidgets('a background image is present', (tester) async {
      await refusal(tester, 'background-image', {'backgroundColor': '#ff0000', 'backgroundImage': 'linear-gradient(#000000, #ffffff)'}, {'backgroundColor': '#00ff00', 'backgroundImage': 'linear-gradient(#000000, #ffffff)'});
    });
    testWidgets('a view carrying a bare string', (tester) async {
      await refusal(tester, 'view-text', {'backgroundColor': '#ff0000', 'color': '#000000'}, {'backgroundColor': '#00ff00', 'color': '#ffffff'}, text: 'bare');
    });
    testWidgets('an html block', (tester) async {
      await refusal(tester, 'html-block', {'backgroundColor': '#ff0000'}, {'backgroundColor': '#00ff00'}, props: {'htmlBlock': true});
    });
    testWidgets('other tags keep the ordinary path', (tester) async {
      await refusal(tester, 'tag', {'backgroundColor': '#ff0000'}, {'backgroundColor': '#00ff00'}, tag: 'image');
    });
  });

  group('state', () {
    testWidgets('a node held pressed is left to the ordinary rebuild', (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final t = _Themed(rows: 2);
      final tree = MirrorTree()
        ..applyFrame(t.first())
        ..flushDirty();
      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {}),
          ),
        ),
      );
      final item = tree.node(t.items.first)!;
      item.pressed = true; // what _PressedNodeState does while a finger is down
      FjsPaintOnlyStats.reset();
      tree.applyFrame((GridFrameWriter()..setStyle(t.items.first, 11, 12)).frame);
      tree.flushDirty();
      await tester.pump();
      expect(FjsPaintOnlyStats.fallbacks.keys, contains('pressed'));
      item.pressed = false;
    });

    testWidgets('a colour change in the same frame as a text change is not lost', (tester) async {
      final t = _Themed(rows: 3);
      final first = t.first(); // fills t.titles
      final w = GridFrameWriter();
      for (final title in t.titles) {
        w.setStyle(title, 13);
      }
      w.setText(t.titles.first, 'changed');
      await expectSame(tester, [first, w.frame]);
    });
  });
}
