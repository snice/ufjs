// specs/196: changing N cells' text, off-device. The 4050 grid through the
// ordinary renderer (flat surface off), N SET_TEXTs per step, with the
// text-only fast path off and on. Stages are driven by hand so each gets its own
// stopwatch (semantics included: flutter_test keeps a client attached).
// Benchmark, not a test (JIT + asserts: read ratios), off unless asked:
//
//   flutter test --dart-define=FJS_BENCH=true test/text_bump_bench_test.dart
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/render/paint_only.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/grid_tree.dart';

int _min(List<int> l) => l.reduce((a, b) => a < b ? a : b);
int _med(List<int> l) => (l.toList()..sort())[l.length >> 1];
String _ms(int us) => (us / 1000).toStringAsFixed(2);

void main() {
  testWidgets(
    'text bump over the 4050 grid: stage split and node rebuilds',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.reset();
        fjsTextOnlyEnabled = true;
        fjsFlatMode = FjsFlatMode.auto;
      });
      fjsFlatMode = FjsFlatMode.off;
      // text ids of the grid in document order (see grid_tree.dart: row r at
      // 2 + r*81, cell c at row+1+2c, its text at row+2+2c)
      List<int> textIds(int n) => [
        for (var i = 0; i < n; i++) 2 + (i ~/ 40) * 81 + 2 + 2 * (i % 40),
      ];

      Future<Map<String, List<int>>> measure(bool enabled, int n) async {
        fjsTextOnlyEnabled = enabled;
        final tree = buildGridTree();
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
        final b = tester.binding;
        final owner = b.rootPipelineOwner;
        final ids = textIds(n);
        final st = <String, List<int>>{'total': [], 'flush': [], 'build': [], 'layout': [], 'paint': [], 'sem': [], 'builds': []};
        for (var i = 0; i < 14; i++) {
          final w = GridFrameWriter();
          for (final id in ids) {
            w.setText(id, i.isEven ? 'a$id' : 'b${id % 97}');
          }
          FjsNodeRenderer.buildCount = 0;
          tree.applyFrame(w.frame);
          final sf = Stopwatch()..start();
          tree.flushDirty();
          sf.stop();
          final sb = Stopwatch()..start();
          b.buildOwner!.buildScope(b.rootElement!);
          sb.stop();
          final sl = Stopwatch()..start();
          owner.flushLayout();
          sl.stop();
          final sp = Stopwatch()..start();
          owner.flushCompositingBits();
          owner.flushPaint();
          sp.stop();
          final sm = Stopwatch()..start();
          owner.flushSemantics();
          sm.stop();
          final builds = FjsNodeRenderer.buildCount;
          await tester.pump();
          if (i >= 4) {
            st['flush']!.add(sf.elapsedMicroseconds);
            st['build']!.add(sb.elapsedMicroseconds);
            st['layout']!.add(sl.elapsedMicroseconds);
            st['paint']!.add(sp.elapsedMicroseconds);
            st['sem']!.add(sm.elapsedMicroseconds);
            st['total']!.add(sf.elapsedMicroseconds + sb.elapsedMicroseconds + sl.elapsedMicroseconds + sp.elapsedMicroseconds + sm.elapsedMicroseconds);
            st['builds']!.add(builds);
          }
        }
        await tester.pumpWidget(const SizedBox());
        return st;
      }

      String line(String name, Map<String, List<int>> m) =>
          '[text-bench] $name total min/med=${_ms(_min(m['total']!))}/${_ms(_med(m['total']!))}ms  '
          'split(min): flush ${_ms(_min(m['flush']!))} build ${_ms(_min(m['build']!))} '
          'layout ${_ms(_min(m['layout']!))} paint ${_ms(_min(m['paint']!))} semantics ${_ms(_min(m['sem']!))}  '
          'node builds=${_min(m['builds']!)}';

      for (final n in [200, 2000]) {
        await measure(false, n);
        await measure(true, n);
        final off = await measure(false, n), on = await measure(true, n);
        // ignore: avoid_print
        print('[text-bench] --- $n cells changed per step');
        // ignore: avoid_print
        print(line('text-only OFF', off));
        // ignore: avoid_print
        print(line('text-only ON ', on));
        // ignore: avoid_print
        print('[text-bench] ON/OFF: ${(_min(on['total']!) * 100 / _min(off['total']!)).toStringAsFixed(1)}% (min) '
            '${(_med(on['total']!) * 100 / _med(off['total']!)).toStringAsFixed(1)}% (med)');
      }
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );
}
