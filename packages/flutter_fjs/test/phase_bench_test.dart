// specs/192 T010: where does the 4050 grid's mount frame go — build, layout or
// paint? Benchmark, not a test (JIT + asserts inflate absolute times; read the
// ratios), so it is off unless asked for:
//
//   flutter test --dart-define=FJS_BENCH=true test/phase_bench_test.dart
//
// The frame is driven by hand instead of through pumpWidget so each pipeline
// stage gets its own stopwatch: buildScope, flushLayout (INCLUDING any build
// that happens inside layout — what frame-timeline shows as BUILD nested in
// LAYOUT), flushCompositingBits + flushPaint. Mutation goes through a
// ValueNotifier so the swap is a normal setState in the tree.
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/grid_tree.dart';

void main() {
  testWidgets(
    'flat-4050 grid: build / layout / paint split',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      final tree = ValueNotifier<MirrorTree?>(null);
      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: Align(
              alignment: Alignment.topLeft,
              child: ValueListenableBuilder<MirrorTree?>(
                valueListenable: tree,
                builder: (_, t, __) => t == null
                    ? const SizedBox.shrink()
                    : FjsNodeRenderer(
                        tree: t,
                        ids: t.rootChildren,
                        dispatch: (_, __, {String? text}) {},
                      ),
              ),
            ),
          ),
        ),
      );

      final binding = tester.binding;
      final owner = binding.rootPipelineOwner;

      int us(Stopwatch s) => s.elapsedMicroseconds;
      final builds = <int>[], layouts = <int>[], paints = <int>[];
      final unmounts = <int>[], relayouts = <int>[], repaints = <int>[];

      for (var i = 0; i < 15; i++) {
        tree.value = buildGridTree();
        final sb = Stopwatch()..start();
        binding.buildOwner!.buildScope(binding.rootElement!);
        sb.stop();
        final sl = Stopwatch()..start();
        owner.flushLayout();
        sl.stop();
        final sp = Stopwatch()..start();
        owner.flushCompositingBits();
        owner.flushPaint();
        sp.stop();
        if (i >= 3) {
          builds.add(us(sb));
          layouts.add(us(sl));
          paints.add(us(sp));
        }
        await tester.pump(); // let the real frame finish, keeps state sane

        // Pure layout / paint of the already-built tree: dirty every render
        // object, no element is rebuilt. layout(first mount) - this = the
        // build that runs inside layout.
        if (i >= 3) {
          void dirty(RenderObject r) {
            r.markNeedsLayout();
            r.visitChildren(dirty);
          }

          dirty(binding.renderView);
          final sr = Stopwatch()..start();
          owner.flushLayout();
          sr.stop();
          relayouts.add(us(sr));
          void dirtyPaint(RenderObject r) {
            r.markNeedsPaint();
            r.visitChildren(dirtyPaint);
          }

          dirtyPaint(binding.renderView);
          final sq = Stopwatch()..start();
          owner.flushCompositingBits();
          owner.flushPaint();
          sq.stop();
          repaints.add(us(sq));
          await tester.pump();
        }

        tree.value = null;
        final su = Stopwatch()..start();
        binding.buildOwner!.buildScope(binding.rootElement!);
        owner.flushLayout();
        su.stop();
        if (i >= 3) unmounts.add(us(su));
        await tester.pump();
      }

      int min(List<int> l) => l.reduce((a, b) => a < b ? a : b);
      int med(List<int> l) => (l.toList()..sort())[l.length >> 1];
      final b = min(builds), l = min(layouts), p = min(paints);
      final total = b + l + p;
      String pct(int v) => '${(v * 100 / total).toStringAsFixed(0)}%';
      // ignore: avoid_print
      print(
        '[phase-bench] min  build=${b / 1000}ms(${pct(b)}) '
        'layout(incl. nested build)=${l / 1000}ms(${pct(l)}) '
        'paint=${p / 1000}ms(${pct(p)}) total=${total / 1000}ms '
        'unmount=${min(unmounts) / 1000}ms',
      );
      final rl = min(relayouts);
      // ignore: avoid_print
      print(
        '[phase-bench] split: layout-only=${rl / 1000}ms '
        'build-inside-layout=${(l - rl) / 1000}ms '
        'paint-only(all dirty)=${min(repaints) / 1000}ms  '
        '=> build ${((b + l - rl) * 100 / total).toStringAsFixed(0)}% '
        'layout ${(rl * 100 / total).toStringAsFixed(0)}% '
        'paint ${pct(p)}',
      );
      // ignore: avoid_print
      print(
        '[phase-bench] med  build=${med(builds) / 1000}ms '
        'layout=${med(layouts) / 1000}ms paint=${med(paints) / 1000}ms',
      );
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );
}
