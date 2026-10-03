// specs/193: the parity harness. The same MirrorTree is rendered both ways
// (FjsFlatMode.off / force) and compared node by node (outer rect) and pixel by
// pixel. test/flat_parity_test.dart is the only thing that says the layout
// engine's mirror of the widget chain is right (flat_layout.dart's header): a
// style key joins the whitelist when a case there pins it.
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/flat/flat_surface.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

class Rendered {
  Rendered(this.rects, this.pixels, this.surfaces, {this.overflowed = false});
  final Map<int, Rect> rects;
  final Uint8List pixels;
  final int surfaces;

  /// The ordinary path reported a RenderFlex overflow while producing this
  /// snapshot: it paints a debug stripe there that has no flat equivalent, so
  /// pixel comparison of such a step is meaningless (rects still compare).
  final bool overflowed;
}

Rect? _rectOf(MirrorNode node) {
  final host = node.flatHost;
  if (host is RenderFlatSurface) return host.globalRectOf(node);
  final e = node.element;
  if (e is! Element || !e.mounted) return null;
  final ro = e.findRenderObject();
  if (ro is! RenderBox || !ro.attached || !ro.hasSize) return null;
  return ro.localToGlobal(Offset.zero) & ro.size;
}

Future<Rendered> render(
  WidgetTester tester,
  MirrorTree tree,
  FjsFlatMode mode, {
  Size viewport = const Size(400, 800),
  bool grow = false,
  Widget Function(Widget child)? wrap,
  Future<void> Function(WidgetTester tester)? after,
}) async {
  tester.view.physicalSize = viewport;
  tester.view.devicePixelRatio = 1;
  fjsFlatMode = mode;
  FjsFlatStats.reset();
  final key = GlobalKey();
  Widget body = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    grow: grow,
    dispatch: (_, __, {String? text}) {},
  );
  if (wrap != null) body = wrap(body);
  await tester.pumpWidget(
    MaterialApp(
      home: Material(
        color: Colors.white,
        child: RepaintBoundary(
          key: key,
          child: Align(alignment: Alignment.topLeft, child: body),
        ),
      ),
    ),
  );
  if (after != null) await after(tester);
  // an overflow is legitimate CSS content running past a box; the ordinary
  // path would also paint a debug stripe there, which has no flat equivalent
  final ex = tester.takeException();
  if (ex != null && !ex.toString().contains('overflowed')) throw ex;
  final rects = <int, Rect>{};
  for (final n in tree.allNodes) {
    if (FjsNodeRenderer.isHidden(n)) continue;
    final r = _rectOf(n);
    if (r != null) rects[n.id] = r;
  }
  final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  final bytes = await tester.runAsync(() async {
    final img = await boundary.toImage();
    final data = await img.toByteData(format: ui.ImageByteFormat.rawRgba);
    return data!.buffer.asUint8List();
  });
  return Rendered(rects, bytes!, FjsFlatStats.surfaces);
}

/// Renders [build]'s tree both ways and asserts equal rects and pixels.
/// [expectSurfaces]: how many flat surfaces the forced render must make.
Future<void> expectParity(
  WidgetTester tester,
  MirrorTree Function() build, {
  int expectSurfaces = 1,
  Size viewport = const Size(400, 800),
  bool grow = false,
  Widget Function(Widget child)? wrap,
  String? reason,
  bool allowRejected = false,
  Future<void> Function(WidgetTester tester)? after,
}) async {
  final off = await render(tester, build(), FjsFlatMode.off, viewport: viewport, grow: grow, wrap: wrap, after: after);
  expect(off.surfaces, 0);
  await tester.pumpWidget(const SizedBox());
  final on = await render(tester, build(), FjsFlatMode.force, viewport: viewport, grow: grow, wrap: wrap, after: after);
  if (allowRejected) {
    // the gate may refuse the container (its children then become surfaces of
    // their own, or nothing does): parity must hold regardless, and the
    // coverage test below counts how often the container itself went flat
    if (on.surfaces == 1) {
      flatContainers++;
    } else {
      gatedContainers++;
    }
  } else {
    expect(
      on.surfaces,
      expectSurfaces,
      reason: 'flat surfaces made (rejected: ${FjsFlatStats.rejected})',
    );
  }
  expect(on.rects.keys.toSet(), off.rects.keys.toSet(), reason: 'node sets differ');
  for (final id in off.rects.keys) {
    final a = off.rects[id]!, b = on.rects[id]!;
    expect(
      (a.left - b.left).abs() < 0.01 &&
          (a.top - b.top).abs() < 0.01 &&
          (a.width - b.width).abs() < 0.01 &&
          (a.height - b.height).abs() < 0.01,
      isTrue,
      reason: 'node $id rect: ordinary $a vs flat $b${reason == null ? '' : ' ($reason)'}',
    );
  }
  var diff = 0;
  for (var i = 0; i < off.pixels.length; i++) {
    if (off.pixels[i] != on.pixels[i]) diff++;
  }
  expect(diff, 0, reason: '$diff differing pixel bytes${reason == null ? '' : ' ($reason)'}');
  await tester.pumpWidget(const SizedBox());
  fjsFlatMode = FjsFlatMode.auto;
}

int flatContainers = 0, gatedContainers = 0;

/// Mounts the tree the first frame builds, then applies each following frame
/// (applyFrame + flushDirty + pump), taking a [Rendered] snapshot (node rects +
/// pixels) after the mount and after every frame. The surface / widgets stay
/// mounted across frames, so incremental paths (flat layout, paint-only
/// updates) are the ones exercised.
Future<List<Rendered>> renderSequence(
  WidgetTester tester,
  List<Uint8List> frames,
  FjsFlatMode mode, {
  Widget Function(Widget child)? wrap,
  Size viewport = const Size(400, 800),
}) async {
  tester.view.physicalSize = viewport;
  tester.view.devicePixelRatio = 1;
  fjsFlatMode = mode;
  final tree = MirrorTree();
  final key = GlobalKey();
  tree
    ..applyFrame(frames.first)
    ..flushDirty();
  await tester.pumpWidget(
    MaterialApp(
      home: Material(
        color: Colors.white,
        child: RepaintBoundary(
          key: key,
          child: Align(
            alignment: Alignment.topLeft,
            child: wrap == null
                ? FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {})
                : wrap(FjsNodeRenderer(tree: tree, ids: tree.rootChildren, grow: false, dispatch: (_, __, {String? text}) {})),
          ),
        ),
      ),
    ),
  );
  final out = <Rendered>[];
  Future<void> snap() async {
    final ex = tester.takeException();
    if (ex != null && !ex.toString().contains('overflowed')) throw ex;
    final over = ex != null;
    final rects = <int, Rect>{};
    for (final n in tree.allNodes) {
      if (FjsNodeRenderer.isHidden(n)) continue;
      final host = n.flatHost;
      Rect? r;
      if (host != null) {
        r = (host as dynamic).globalRectOf(n) as Rect?;
      } else {
        final e = n.element;
        if (e is Element && e.mounted) {
          final ro = e.findRenderObject();
          if (ro is RenderBox && ro.attached && ro.hasSize) r = ro.localToGlobal(Offset.zero) & ro.size;
        }
      }
      if (r != null) rects[n.id] = r;
    }
    final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final bytes = await tester.runAsync(() async {
      final img = await boundary.toImage();
      return (await img.toByteData(format: ui.ImageByteFormat.rawRgba))!.buffer.asUint8List();
    });
    out.add(Rendered(rects, bytes!, 0, overflowed: over));
  }

  await snap();
  for (final f in frames.skip(1)) {
    tree
      ..applyFrame(f)
      ..flushDirty();
    await tester.pump();
    await snap();
  }
  await tester.pumpWidget(const SizedBox());
  return out;
}

