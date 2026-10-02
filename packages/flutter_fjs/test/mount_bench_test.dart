// specs/190: the 4050 grid's mount frame, timed off-device. Benchmark, not a
// test (timings flake on shared CI), so it is off unless asked for:
//
//   flutter test --dart-define=FJS_BENCH=true test/mount_bench_test.dart
//
// Same tree as hello-js's flat-4050 grid: 50 rows × 40 × (cell view + text),
// three interned styles. Prints mount (build + layout + paint of the whole
// grid in one frame) and unmount, min-of-N, plus the Element / RenderObject
// census — the numbers the on-device frame-timeline reads as LAYOUT/BUILD.
// JIT + asserts inflate the absolute times; read them as before/after ratios.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

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

const _rows = 50, _cols = 40;

MirrorTree _tree() {
  final w = _W()
    ..create(1, 'view')
    ..insert(0, 1, 0)
    ..defineStyle(1, '{"flexDirection":"row"}')
    ..defineStyle(2, '{"backgroundColor":"#85d8b4","margin":"0.5px"}')
    ..defineStyle(3, '{"fontSize":"5px","lineHeight":"5px"}');
  var id = 2;
  for (var r = 0; r < _rows; r++) {
    final row = id++;
    w
      ..create(row, 'view')
      ..setStyle(row, 1)
      ..insert(1, row, r);
    for (var c = 0; c < _cols; c++) {
      final cell = id++;
      w
        ..create(cell, 'view')
        ..setStyle(cell, 2)
        ..insert(row, cell, c);
      final text = id++;
      w
        ..create(text, 'text')
        ..setStyle(text, 3)
        ..setText(text, '$c')
        ..insert(cell, text, 0);
    }
  }
  return MirrorTree()
    ..applyFrame(w.frame)
    ..flushDirty();
}

void main() {
  testWidgets(
    'flat-4050 grid: mount / unmount',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      Widget page(MirrorTree? tree) => MaterialApp(
        home: Material(
          child: Align(
            alignment: Alignment.topLeft,
            child: tree == null
                ? const SizedBox.shrink()
                : FjsNodeRenderer(
                    tree: tree,
                    ids: tree.rootChildren,
                    dispatch: (_, __, {String? text}) {},
                  ),
          ),
        ),
      );

      await tester.pumpWidget(page(null));
      var mount = 1 << 30, unmount = 1 << 30;
      for (var i = 0; i < 15; i++) {
        final tree = _tree();
        final sw = Stopwatch()..start();
        await tester.pumpWidget(page(tree));
        sw.stop();
        if (i >= 3 && sw.elapsedMicroseconds < mount) {
          mount = sw.elapsedMicroseconds;
        }
        sw
          ..reset()
          ..start();
        await tester.pumpWidget(page(null));
        sw.stop();
        if (i >= 3 && sw.elapsedMicroseconds < unmount) {
          unmount = sw.elapsedMicroseconds;
        }
      }

      await tester.pumpWidget(page(_tree()));
      var elements = 0, renderObjects = 0;
      void walk(Element e) {
        elements++;
        if (e is RenderObjectElement) renderObjects++;
        e.visitChildren(walk);
      }

      walk(tester.element(find.byType(FjsNodeRenderer)));
      // ignore: avoid_print
      print(
        '[mount-bench] nodes=${1 + _rows * (1 + 2 * _cols)} '
        'mount=${mount / 1000}ms unmount=${unmount / 1000}ms '
        'elements=$elements renderObjects=$renderObjects',
      );
    },
    skip: !const bool.fromEnvironment('FJS_BENCH'),
  );
}
