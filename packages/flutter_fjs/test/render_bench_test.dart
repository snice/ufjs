// Benchmarks, not tests: they time the two render-side caches against a
// bypassed control. Timing assertions flake on shared CI, so they are off
// unless asked for:
//
//   flutter test --dart-define=FJS_BENCH=true test/render_bench_test.dart
//
// The correctness guarantees live elsewhere and count instead of timing:
// resolved_style_test.dart counts parser invocations, node_rebuild_test.dart
// counts node builds.
//
// Both controls BYPASS the cache under test rather than merely emptying it.
// Emptying does not work: within a single build the first node refills the
// cache for all the others, and the two variants then measure the same. The
// passes are also interleaved, min-of-N — measuring one variant fully and
// then the other hands the second a JIT-warmed path, which is enough to
// reverse the result.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/render/style_parse.dart';
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

  void defineStyle(int id, String json) {
    u8(UiOpCode.defineStyle);
    u32(id);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void setStyle(int id, int sid) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(sid);
    u32(0);
  }

  void setText(int id, String t) {
    u8(UiOpCode.setText);
    u32(id);
    final j = utf8.encode(t);
    u32(j.length);
    raw(j);
  }

  void insert(int p, int c, int i) {
    u8(UiOpCode.insert);
    u32(p);
    u32(c);
    u32(i);
  }

  Uint8List get frame => Uint8List.fromList(b);
}

const _row =
    '{"backgroundColor":"#1c1c1e","borderColor":"#38383a",'
    '"borderRadius":"8px","padding":"12px 16px","margin":"4px 12px",'
    '"flexDirection":"row","alignItems":"center","gap":"8px",'
    '"boxShadow":"0 1px 2px rgba(0,0,0,.2)"}';
const _title =
    '{"color":"#f2f2f7","fontSize":"15px","fontWeight":"500","flexGrow":1}';
const _meta = '{"color":"#8e8e93","fontSize":"12px"}';

const _rows = 400; // 1200 nodes

/// row i has id 2 + i * 3; its title 3 + i * 3; its meta 4 + i * 3.
int _titleId(int i) => 3 + i * 3;

MirrorTree _tree() {
  final w = _W()
    ..create(1, 'view')
    ..insert(0, 1, 0)
    ..defineStyle(1, _row)
    ..defineStyle(2, _title)
    ..defineStyle(3, _meta);
  var id = 2;
  for (var i = 0; i < _rows; i++) {
    final row = id++;
    w
      ..create(row, 'view')
      ..setStyle(row, 1)
      ..insert(1, row, i);
    final title = id++;
    w
      ..create(title, 'text')
      ..setStyle(title, 2)
      ..setText(title, 'row $i')
      ..insert(row, title, 0);
    final meta = id++;
    w
      ..create(meta, 'text')
      ..setStyle(meta, 3)
      ..setText(meta, '#$i')
      ..insert(row, meta, 1);
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

/// A surface tall enough for every row. The root's children are Expanded
/// (a page root fills its route), which cannot live under an unbounded
/// height, so a scroll view is not an option here.
void _bigSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(1200, 40000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// Rebuilds the root renderer, which is what engine.notifyListeners() causes
/// on every frame through FjsView's ListenableBuilder.
void _rebuildRoot(WidgetTester tester) {
  final element =
      tester.element(find.byType(FjsNodeRenderer)) as StatelessElement;
  element.markNeedsBuild();
  tester.binding.buildOwner!.buildScope(element);
}

void main() {
  testWidgets(
    'parse cache: one full rebuild, cached vs bypassed',
    (tester) async {
      _bigSurface(tester);
      final tree = _tree();
      await tester.pumpWidget(_render(tree));

      // the view cache would otherwise stop the rebuild at the root, leaving
      // nothing for the parse cache to be measured against
      fjsDisableViewCache = true;
      addTearDown(() => fjsDisableViewCache = false);

      var warm = 1 << 30, cold = 1 << 30, warmParses = 0, coldParses = 0;
      for (var i = 0; i < 25; i++) {
        for (final bypass in [true, false]) {
          fjsDisableParseCache = bypass;
          fjsParseCalls = 0;
          final sw = Stopwatch()..start();
          _rebuildRoot(tester);
          sw.stop();
          final us = sw.elapsedMicroseconds;
          if (i < 5) continue;
          if (bypass && us < cold) {
            cold = us;
            coldParses = fjsParseCalls;
          }
          if (!bypass && us < warm) {
            warm = us;
            warmParses = fjsParseCalls;
          }
        }
      }
      fjsDisableParseCache = false;
      // ignore: avoid_print
      print(
        '[parse-cache] nodes=${_rows * 3} warm=${warm / 1000}ms '
        'cold=${cold / 1000}ms ratio=${(cold / warm).toStringAsFixed(2)}x '
        'parses: $coldParses -> $warmParses',
      );
      // Interned FjsStyle views (specs/084) absorb rebuilds: getters do not
      // re-enter style_parse even with the parse cache bypassed. First-paint
      // of a new style id still hits the parse cache (resolved_style_test).
      expect(warmParses, 0);
      expect(coldParses, 0);
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );

  testWidgets(
    'view cache: one leaf edit, cached vs bypassed',
    (tester) async {
      _bigSurface(tester);
      final tree = _tree();
      await tester.pumpWidget(_render(tree));

      var n = 0;
      // one leaf changes, then the root rebuilds — exactly what one reactive
      // update does: applyFrame marks the node, notifyListeners rebuilds the
      // root, and the question is how far that travels
      int editOneLeaf() {
        tree.applyFrame((_W()..setText(_titleId(3), 'v${n++}')).frame);
        final sw = Stopwatch()..start();
        tree.flushDirty();
        _rebuildRoot(tester);
        sw.stop();
        return sw.elapsedMicroseconds;
      }

      var cached = 1 << 30,
          bypassed = 1 << 30,
          cachedBuilds = 0,
          bypassedBuilds = 0;
      for (var i = 0; i < 25; i++) {
        for (final bypass in [true, false]) {
          fjsDisableViewCache = bypass;
          FjsNodeRenderer.buildCount = 0;
          final us = editOneLeaf();
          final builds = FjsNodeRenderer.buildCount;
          if (i < 5) continue;
          if (bypass && us < bypassed) {
            bypassed = us;
            bypassedBuilds = builds;
          }
          if (!bypass && us < cached) {
            cached = us;
            cachedBuilds = builds;
          }
        }
      }
      fjsDisableViewCache = false;
      // ignore: avoid_print
      print(
        '[view-cache] nodes=${_rows * 3} cached=${cached / 1000}ms '
        'bypassed=${bypassed / 1000}ms '
        'ratio=${(bypassed / cached).toStringAsFixed(1)}x '
        'node builds: $bypassedBuilds -> $cachedBuilds',
      );
      expect(cachedBuilds, lessThan(bypassedBuilds));
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );

  testWidgets(
    'theme switch: does per-node granularity cost anything?',
    (tester) async {
      // The case granularity cannot help: every node genuinely changed, so
      // every node rebuilds either way. The question is whether the machinery
      // that makes leaf edits cheap — a ListenableBuilder element per node —
      // makes this case MORE expensive than it was.
      _bigSurface(tester);
      final tree = _tree();
      await tester.pumpWidget(_render(tree));

      var sid = 100;
      int switchTheme() {
        final w = _W()..defineStyle(++sid, '{"backgroundColor":"#${sid}0e1a"}');
        for (var i = 0; i < _rows; i++) {
          w.setStyle(2 + i * 3, sid);
        }
        tree.applyFrame(w.frame);
        final sw = Stopwatch()..start();
        tree.flushDirty();
        _rebuildRoot(tester);
        sw.stop();
        return sw.elapsedMicroseconds;
      }

      var cached = 1 << 30,
          bypassed = 1 << 30,
          cachedBuilds = 0,
          bypassedBuilds = 0;
      for (var i = 0; i < 15; i++) {
        for (final bypass in [true, false]) {
          fjsDisableViewCache = bypass;
          FjsNodeRenderer.buildCount = 0;
          final us = switchTheme();
          final builds = FjsNodeRenderer.buildCount;
          if (i < 3) continue;
          if (bypass && us < bypassed) {
            bypassed = us;
            bypassedBuilds = builds;
          }
          if (!bypass && us < cached) {
            cached = us;
            cachedBuilds = builds;
          }
        }
      }
      fjsDisableViewCache = false;
      // ignore: avoid_print
      print(
        '[theme-switch] nodes=${_rows * 3} '
        'granular=${cached / 1000}ms flat=${bypassed / 1000}ms '
        'node builds: $bypassedBuilds vs $cachedBuilds',
      );
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );
}
