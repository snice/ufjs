// specs/193 T042: below what size is a flat surface not worth it? Benchmark
// (off unless asked): mount of an N-node pure subtree through the ordinary
// renderer and through a surface, min of 25.
//
//   flutter test --dart-define=FJS_BENCH=true test/flat_threshold_bench_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_tree.dart';

MirrorTree _tree(int nodes) {
  final t = FixtureTree();
  final root = t.view(0, {'alignItems': 'flex-start'});
  var made = 1;
  while (made < nodes) {
    final row = t.view(root, {'flexDirection': 'row', 'gap': '2px', 'alignItems': 'center'});
    made++;
    for (var c = 0; c < 3 && made < nodes; c++) {
      t.text(row, '$made', {'fontSize': '12px', 'margin': '1px'});
      made++;
    }
  }
  return t.build();
}

void main() {
  testWidgets(
    'mount cost by subtree size',
    (tester) async {
      tester.view.physicalSize = const Size(400, 4000);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.reset();
        fjsFlatMode = FjsFlatMode.auto;
      });
      final holder = ValueNotifier<MirrorTree?>(null);
      await tester.pumpWidget(
        MaterialApp(
          home: Material(
            child: Align(
              alignment: Alignment.topLeft,
              child: ValueListenableBuilder<MirrorTree?>(
                valueListenable: holder,
                builder: (_, t, __) => t == null
                    ? const SizedBox.shrink()
                    : FjsNodeRenderer(tree: t, ids: t.rootChildren, grow: false, dispatch: (_, __, {String? text}) {}),
              ),
            ),
          ),
        ),
      );
      final binding = tester.binding;
      final owner = binding.rootPipelineOwner;
      int mount(FjsFlatMode mode, int n) {
        fjsFlatMode = mode;
        var best = 1 << 30;
        for (var i = 0; i < 25; i++) {
          holder.value = _tree(n);
          final sw = Stopwatch()..start();
          binding.buildOwner!.buildScope(binding.rootElement!);
          owner.flushLayout();
          owner.flushCompositingBits();
          owner.flushPaint();
          sw.stop();
          if (i >= 5 && sw.elapsedMicroseconds < best) best = sw.elapsedMicroseconds;
          holder.value = null;
          binding.buildOwner!.buildScope(binding.rootElement!);
          owner.flushLayout();
        }
        return best;
      }

      for (final n in [4, 8, 16, 32, 64, 128, 512]) {
        mount(FjsFlatMode.off, n);
        mount(FjsFlatMode.force, n);
        final off = mount(FjsFlatMode.off, n), on = mount(FjsFlatMode.force, n);
        // ignore: avoid_print
        print('[flat-threshold] nodes=${n.toString().padLeft(3)} ordinary=${(off / 1000).toStringAsFixed(3)}ms '
            'flat=${(on / 1000).toStringAsFixed(3)}ms ratio=${(on * 100 / off).toStringAsFixed(0)}%');
      }
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );
}
