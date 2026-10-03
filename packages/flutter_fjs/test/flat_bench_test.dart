// specs/193: the 4050 grid through the ordinary renderer and through the Dart
// flat surface. Off unless asked:
//
//   flutter test --dart-define=FJS_BENCH=true test/flat_bench_test.dart
//
// Read ratios, not absolutes: JIT + asserts. (specs/192's C++ layout probe was
// a third arm until the verdict "C++ layout stays out of main"; its numbers are
// in specs/193/spec.md; the probe code itself was not kept.)
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/flat/flat_layout.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/grid_tree.dart';

Uint8List _setText(int id, String t) => (GridFrameWriter()..setText(id, t)).frame;
int _min(List<int> l) => l.reduce((a, b) => a < b ? a : b);
int _med(List<int> l) => (l.toList()..sort())[l.length >> 1];
String _ms(int us) => (us / 1000).toStringAsFixed(2);

void main() {
  testWidgets(
    'flat-4050 grid: ordinary renderer vs Dart flat surface',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.reset();
        fjsFlatMode = FjsFlatMode.auto;
      });
      final binding = tester.binding;
      final owner = binding.rootPipelineOwner;
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
                    : FjsNodeRenderer(
                        tree: t,
                        ids: t.rootChildren,
                        grow: false,
                        dispatch: (_, __, {String? text}) {},
                      ),
              ),
            ),
          ),
        ),
      );

      List<int> frame() {
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
        return [sb.elapsedMicroseconds, sl.elapsedMicroseconds, sp.elapsedMicroseconds];
      }

      Future<Map<String, List<int>>> run(String mode) async {
        fjsFlatMode = mode == 'flat' ? FjsFlatMode.force : FjsFlatMode.off;
        final m = <String, List<int>>{'mount': [], 'update': [], 'unmount': [], 'relaid': [], 'b': [], 'l': [], 'p': []};
        for (var i = 0; i < 15; i++) {
          final tree = buildGridTree();
          holder.value = tree;
          final f = frame();
          await tester.pump();
          if (i >= 3) {
            m['mount']!.add(f[0] + f[1] + f[2]);
            m['b']!.add(f[0]);
            m['l']!.add(f[1]);
            m['p']!.add(f[2]);
          }
          tree.applyFrame(_setText(4, 'x$i'));
          tree.flushDirty();
          FlatStats.reset();
          final su = Stopwatch()..start();
          await tester.pump();
          su.stop();
          if (i >= 3) {
            m['update']!.add(su.elapsedMicroseconds);
            m['relaid']!.add(FlatStats.relaidNodes);
          }
          holder.value = null;
          final sd = Stopwatch()..start();
          binding.buildOwner!.buildScope(binding.rootElement!);
          owner.flushLayout();
          sd.stop();
          if (i >= 3) m['unmount']!.add(sd.elapsedMicroseconds);
          await tester.pump();
        }
        return m;
      }

      await run('clone');
      await run('flat');
      final results = <String, Map<String, List<int>>>{
        'clone': await run('clone'),
        'flat(Dart)': await run('flat'),
      };
      for (final e in results.entries) {
        final m = e.value;
        // ignore: avoid_print
        print(
          '[flat-bench] ${e.key.padRight(11)} mount min/med=${_ms(_min(m['mount']!))}/${_ms(_med(m['mount']!))}ms '
          '(build ${_ms(_min(m['b']!))} layout ${_ms(_min(m['l']!))} paint ${_ms(_min(m['p']!))}) '
          'update1 min/med=${_ms(_min(m['update']!))}/${_ms(_med(m['update']!))}ms '
          'unmount min=${_ms(_min(m['unmount']!))}ms'
          '${e.key.startsWith('flat') ? ' relaidNodes(update1)=${_min(m['relaid']!)}' : ''}',
        );
      }
      final c = _min(results['clone']!['mount']!), f = _min(results['flat(Dart)']!['mount']!);
      final cu = _min(results['clone']!['update']!), fu = _min(results['flat(Dart)']!['update']!);
      // ignore: avoid_print
      print(
        '[flat-bench] flat/clone: mount ${(f * 100 / c).toStringAsFixed(1)}%  update1 ${(fu * 100 / cu).toStringAsFixed(1)}%',
      );
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );
}
