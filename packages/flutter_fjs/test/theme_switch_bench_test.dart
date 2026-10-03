// specs/194: a theme switch, off-device. The workload is hello-js's 主题压测
// screen: 1000 rows (item + title + meta, a badge on every seventh, ≈3333
// elements) in a scroll-view, each item with a `:active` style. A switch is one
// SET_STYLE per node whose colours changed — exactly what the JS side sends
// (applied 3176 of 3332) — and the Dart side then builds, lays out and paints.
// Benchmark, not a test (JIT + asserts: read ratios), off unless asked:
//
//   flutter test --dart-define=FJS_BENCH=true test/theme_switch_bench_test.dart
//
// Prints the stage split and how many node views were rebuilt, with the
// paint-only path (specs/194) off and on.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/paint_only.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/grid_tree.dart';

const _rows = 1000;

class _Theme {
  const _Theme(this.page, this.card, this.cardActive, this.border, this.title, this.muted, this.primary);
  final String page, card, cardActive, border, title, muted, primary;
}

const _light = _Theme('#F4F5F7', '#FFFFFF', '#ECECEF', '#E5E5E5', '#1A1A1A', '#999999', '#007AFF');
const _dark = _Theme('#000000', '#1C1C1E', '#2C2C2E', '#38383A', '#F5F5F7', '#8E8E93', '#0A84FF');

String _item(_Theme t) => jsonEncode({
  'flexDirection': 'row', 'alignItems': 'center', 'gap': '8px', 'margin': '0 12px 6px 12px',
  'padding': '12px 16px', 'borderRadius': '8px', 'borderColor': t.border, 'backgroundColor': t.card,
});
String _itemActive(_Theme t) => jsonEncode({'backgroundColor': t.cardActive});
String _title(_Theme t) => jsonEncode({'flexGrow': 1, 'fontSize': '15px', 'color': t.title});
String _meta(_Theme t) => jsonEncode({'fontSize': '12px', 'color': t.muted});
String _badge(_Theme t) => jsonEncode({'alignItems': 'center', 'borderRadius': '4px', 'padding': '2px 6px', 'backgroundColor': t.primary});
const _badgeText = '{"fontSize":"10px","color":"#ffffff"}';

// style ids: light 1..5, dark 11..15, constant 20
const _ids = {'item': 1, 'itemA': 2, 'title': 3, 'meta': 4, 'badge': 5};

class _Built {
  _Built(this.tree, this.items, this.titles, this.metas, this.badges);
  final MirrorTree tree;
  final List<int> items, titles, metas, badges;
}

_Built _build() {
  final w = GridFrameWriter();
  void define(int base, _Theme t) => w
    ..defineStyle(base + 1, _item(t))
    ..defineStyle(base + 2, _itemActive(t))
    ..defineStyle(base + 3, _title(t))
    ..defineStyle(base + 4, _meta(t))
    ..defineStyle(base + 5, _badge(t));
  define(0, _light);
  define(10, _dark);
  w.defineStyle(20, _badgeText);
  w.defineStyle(21, '{"height":"640px"}');
  w
    ..create(1, 'scroll-view')
    ..setStyle(1, 21)
    ..insert(0, 1, 0);
  var id = 2;
  final items = <int>[], titles = <int>[], metas = <int>[], badges = <int>[];
  for (var r = 0; r < _rows; r++) {
    final item = id++;
    items.add(item);
    w
      ..create(item, 'view')
      ..setStyle(item, _ids['item']!, _ids['itemA']!)
      ..insert(1, item, r);
    final title = id++;
    titles.add(title);
    w
      ..create(title, 'text')
      ..setStyle(title, _ids['title']!)
      ..setText(title, '第 ${r + 1} 行')
      ..insert(item, title, 0);
    final meta = id++;
    metas.add(meta);
    w
      ..create(meta, 'text')
      ..setStyle(meta, _ids['meta']!)
      ..setText(meta, '#${(r + 1).toString().padLeft(4, '0')}')
      ..insert(item, meta, 1);
    if (r % 7 == 0) {
      final badge = id++, bt = id++;
      badges.add(badge);
      w
        ..create(badge, 'view')
        ..setStyle(badge, _ids['badge']!)
        ..insert(item, badge, 2)
        ..create(bt, 'text')
        ..setStyle(bt, 20)
        ..setText(bt, 'NEW')
        ..insert(badge, bt, 0);
    }
  }
  final tree = MirrorTree()
    ..applyFrame(w.frame)
    ..flushDirty();
  return _Built(tree, items, titles, metas, badges);
}

/// The frame a theme switch sends: new style ids for every node whose colours
/// changed. [toDark] picks the 10-series ids.
List<int> _switchFrame(_Built b, bool toDark, GridFrameWriter w) {
  final base = toDark ? 10 : 0;
  for (final i in b.items) {
    w.setStyle(i, base + 1, base + 2);
  }
  for (final t in b.titles) {
    w.setStyle(t, base + 3);
  }
  for (final m in b.metas) {
    w.setStyle(m, base + 4);
  }
  for (final x in b.badges) {
    w.setStyle(x, base + 5);
  }
  return const [];
}

int _min(List<int> l) => l.reduce((a, b) => a < b ? a : b);
int _med(List<int> l) => (l.toList()..sort())[l.length >> 1];
String _ms(int us) => (us / 1000).toStringAsFixed(2);

void main() {
  testWidgets(
    'theme switch over 1000 rows: stage split and node rebuilds',
    (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      Future<Map<String, List<int>>> measure(bool enabled) async {
      fjsPaintOnlyEnabled = enabled;
      final built = _build();
      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: FjsNodeRenderer(
              tree: built.tree,
              ids: built.tree.rootChildren,
              grow: false,
              dispatch: (_, __, {String? text}) {},
            ),
          ),
        ),
      );
      final b = tester.binding;
      final owner = b.rootPipelineOwner;
      final stages = <String, List<int>>{'apply': [], 'flush': [], 'build': [], 'layout': [], 'paint': [], 'total': [], 'builds': [], 'pureLayout': [], 'sem': []};
      var dark = false;
      for (var i = 0; i < 16; i++) {
        dark = !dark;
        final w = GridFrameWriter();
        _switchFrame(built, dark, w);
        FjsNodeRenderer.buildCount = 0;
        final sa = Stopwatch()..start();
        built.tree.applyFrame(w.frame);
        sa.stop();
        final sf = Stopwatch()..start();
        built.tree.flushDirty();
        sf.stop();
        final sb = Stopwatch()..start();
        b.buildOwner!.buildScope(b.rootElement!);
        sb.stop();
        // what the build stage left dirty (debug-only getters)
        var needLayout = 0, needPaint = 0, total = 0;
        void count(RenderObject r) {
          total++;
          if (r.debugNeedsLayout) needLayout++;
          if (r.debugNeedsPaint) needPaint++;
          r.visitChildren(count);
        }

        count(b.renderView);
        final sl = Stopwatch()..start();
        owner.flushLayout();
        sl.stop();
        final sp = Stopwatch()..start();
        owner.flushCompositingBits();
        owner.flushPaint();
        sp.stop();
        // semantics is attached for every flutter_test run (and on the iOS
        // simulator): a recolour that marks semantics dirty pays here
        final sm = Stopwatch()..start();
        owner.flushSemantics();
        sm.stop();
        final builds = FjsNodeRenderer.buildCount;
        await tester.pump();
        // pure layout of the whole tree: dirty every render object, no rebuild
        void dirtyAll(RenderObject r) {
          r.markNeedsLayout();
          r.visitChildren(dirtyAll);
        }

        dirtyAll(b.renderView);
        final sr = Stopwatch()..start();
        owner.flushLayout();
        sr.stop();
        await tester.pump();
        if (i == 6) {
          // ignore: avoid_print
          print('[theme-bench] after the build stage: renderObjects needing layout=$needLayout needing paint=$needPaint of $total');
        }
        if (i >= 4) {
          stages['pureLayout']!.add(sr.elapsedMicroseconds);
          stages['apply']!.add(sa.elapsedMicroseconds);
          stages['flush']!.add(sf.elapsedMicroseconds);
          stages['build']!.add(sb.elapsedMicroseconds);
          stages['layout']!.add(sl.elapsedMicroseconds);
          stages['paint']!.add(sp.elapsedMicroseconds);
          stages['sem']!.add(sm.elapsedMicroseconds);
          stages['total']!.add(sf.elapsedMicroseconds + sb.elapsedMicroseconds + sl.elapsedMicroseconds + sp.elapsedMicroseconds + sm.elapsedMicroseconds);
          stages['builds']!.add(builds);
        }
      }
      await tester.pumpWidget(const SizedBox());
      return stages;
      }

      await measure(false);
      await measure(true);
      final off = await measure(false), on = await measure(true);
      fjsPaintOnlyEnabled = true;
      String line(String name, Map<String, List<int>> m) =>
          '[theme-bench] $name switch (flush+build+layout+paint+semantics) min/med/max='
          '${_ms(_min(m['total']!))}/${_ms(_med(m['total']!))}/${_ms((m['total']!.toList()..sort()).last)}ms  '
          'split(min): flush ${_ms(_min(m['flush']!))} build ${_ms(_min(m['build']!))} '
          'layout ${_ms(_min(m['layout']!))} paint ${_ms(_min(m['paint']!))} semantics ${_ms(_min(m['sem']!))}  '
          'node builds per switch=${_min(m['builds']!)}';
      // ignore: avoid_print
      print(line('paint-only OFF', off));
      // ignore: avoid_print
      print(line('paint-only ON ', on));
      // ignore: avoid_print
      print('[theme-bench] ON/OFF: ${(_min(on['total']!) * 100 / _min(off['total']!)).toStringAsFixed(1)}% (min)  '
          '${(_med(on['total']!) * 100 / _med(off['total']!)).toStringAsFixed(1)}% (med)');
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );
}
