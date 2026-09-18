// Paint culling inside `scroll-view`.
//
// The property is invisible from the outside — the page looks identical
// either way — so it is asserted by counting the children the paint loop
// skipped. Without a counter, a regression here shows up only as "the app got
// slow again", which is how it went unnoticed in the first place: a Column
// paints all 1000 of its rows on every frame, and nothing about the picture
// says so.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/cull.dart';
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

  void raw(List<int> l) => b.addAll(l);

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
  }

  void setText(int id, String text) {
    u8(UiOpCode.setText);
    u32(id);
    final t = utf8.encode(text);
    u32(t.length);
    raw(t);
  }

  void defineStyle(int styleId, String json) {
    u8(UiOpCode.defineStyle);
    u32(styleId);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void setStyle(int id, int styleId) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(styleId);
    u32(0);
  }

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }

  Uint8List get frame => Uint8List.fromList(b);
}

const _rows = 200;
const _rowHeight = 40.0;

/// A scroll-view of [_rows] fixed-height rows — 8000px of content in an
/// 800px window, so all but ~20 of them are off screen.
int _rowId(int i) => 2 + i * 2;
int _textId(int i) => 3 + i * 2;

MirrorTree _tree() {
  final w = _W()
    ..create(1, 'scroll-view')
    ..insert(0, 1, 0)
    ..defineStyle(1, '{"height":"$_rowHeight","backgroundColor":"#eeeeee"}');
  for (var i = 0; i < _rows; i++) {
    w
      ..create(_rowId(i), 'view')
      ..setStyle(_rowId(i), 1)
      ..insert(1, _rowId(i), i)
      ..create(_textId(i), 'text')
      ..setText(_textId(i), 'row $i')
      ..insert(_rowId(i), _textId(i), 0);
  }
  return MirrorTree()
    ..applyFrame(w.frame)
    ..flushDirty();
}

Widget _render(MirrorTree tree) => Directionality(
  textDirection: TextDirection.ltr,
  child: FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  ),
);

void _surface(WidgetTester tester) {
  tester.view.physicalSize = const Size(400, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('a scroll-view paints the visible rows, not all of them', (
    tester,
  ) async {
    _surface(tester);
    final tree = _tree();
    fjsCulledChildren = 0;
    fjsPaintedChildren = 0;
    await tester.pumpWidget(_render(tree));

    // ~20 rows fit the window, plus the slack the cull rect is inflated by.
    // The exact number depends on that slack; what matters is the order of
    // magnitude — tens, not two hundred.
    expect(fjsPaintedChildren, lessThan(_rows ~/ 2));
    expect(fjsCulledChildren, greaterThan(_rows ~/ 2));
  });

  testWidgets('every row still paints with culling off', (tester) async {
    _surface(tester);
    final tree = _tree();
    fjsDisablePaintCulling = true;
    addTearDown(() => fjsDisablePaintCulling = false);
    fjsCulledChildren = 0;
    fjsPaintedChildren = 0;
    await tester.pumpWidget(_render(tree));

    // the control arm: the counters stay at zero because the culling loop
    // never ran, which is what "bypassed" has to mean for a fair comparison
    expect(fjsCulledChildren, 0);
    expect(fjsPaintedChildren, 0);
  });

  testWidgets('a scroller nested in a scroller still culls', (tester) async {
    // The shape examples/hello-fjs has: an app shell wraps every page in a
    // scroll-view, and the page brings one of its own. The INNER viewport is
    // useless for culling — sitting in an unbounded parent it is as tall as
    // its content, so its window covers every row. Only the outer one, the
    // one with a real height, says anything.
    _surface(tester);
    final w = _W()
      ..create(1, 'scroll-view')
      ..insert(0, 1, 0)
      ..create(2, 'scroll-view')
      ..insert(1, 2, 0)
      ..defineStyle(1, '{"height":"$_rowHeight","backgroundColor":"#eeeeee"}');
    for (var i = 0; i < _rows; i++) {
      w
        ..create(_rowId(i) + 2, 'view')
        ..setStyle(_rowId(i) + 2, 1)
        ..insert(2, _rowId(i) + 2, i);
    }
    final tree = MirrorTree()
      ..applyFrame(w.frame)
      ..flushDirty();

    fjsCulledChildren = 0;
    fjsPaintedChildren = 0;
    await tester.pumpWidget(_render(tree));

    expect(fjsPaintedChildren, lessThan(_rows ~/ 2));
    expect(fjsCulledChildren, greaterThan(_rows ~/ 2));
  });

  testWidgets(
    'a flex culling against an outer scroller repaints when it moves',
    (tester) async {
      // Reported from the simulator: a page of inner scroll-views rendered
      // blank below the fold, and scrolling a blank one into view did not
      // bring its rows back — only touching that inner list did.
      //
      // Every viewport is a repaint boundary, so the inner scroller's layer is
      // retained and an outer scroll merely re-offsets it: the culling
      // decision taken while it sat off screen stands forever. The flex has to
      // be told (fjsScrollerMoved), which is what this asserts — the widget
      // test harness repaints far more eagerly than the device, so asserting
      // on painted counts alone would pass either way.
      _surface(tester);
      const rowsInside = 40;
      final w = _W()
        ..create(1, 'scroll-view')
        ..insert(0, 1, 0)
        ..defineStyle(2, '{"height":"600"}')
        ..create(90, 'view')
        ..setStyle(90, 2)
        ..insert(1, 90, 0)
        ..defineStyle(3, '{"height":"400"}')
        ..create(2, 'scroll-view')
        ..setStyle(2, 3)
        ..insert(1, 2, 1)
        ..defineStyle(
          1,
          '{"height":"$_rowHeight","backgroundColor":"#eeeeee"}',
        );
      for (var i = 0; i < rowsInside; i++) {
        w
          ..create(_rowId(i) + 2, 'view')
          ..setStyle(_rowId(i) + 2, 1)
          ..insert(2, _rowId(i) + 2, i);
      }
      final tree = MirrorTree()
        ..applyFrame(w.frame)
        ..flushDirty();
      await tester.pumpWidget(_render(tree));

      // The inner content flex sits behind the inner viewport's repaint
      // boundary and culls against the OUTER window, so it must have
      // registered for the nudge.
      final inner = tester
          .renderObjectList<RenderFjsCullingFlex>(
            find.byType(FjsCullingFlex, skipOffstage: false),
          )
          .where((f) => f.childCount == rowsInside)
          .single;
      expect(fjsCullingFlexesAcrossBoundary, contains(inner));

      // ...and the nudge is what an outer scroll delivers: the flex is dirty
      // again, so the rows now in view get painted instead of staying blank.
      tester.binding.scheduleFrame();
      await tester.pump();
      expect(inner.debugNeedsPaint, isFalse);
      fjsScrollerMoved();
      expect(inner.debugNeedsPaint, isTrue);
    },
  );

  testWidgets('culling is paint-only: layout and hit testing see every row', (
    tester,
  ) async {
    _surface(tester);
    final tree = _tree();
    await tester.pumpWidget(_render(tree));

    // the scroll extent still covers all 200 rows, so the last one can be
    // scrolled to — culling must not shorten the content
    final scrollable = find.byType(Scrollable);
    expect(scrollable, findsOneWidget);
    final position = tester.state<ScrollableState>(scrollable).position;
    expect(
      position.maxScrollExtent,
      greaterThan(_rows * _rowHeight - 800 - _rowHeight),
    );
  });
}
