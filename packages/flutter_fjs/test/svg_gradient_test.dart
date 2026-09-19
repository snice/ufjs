// specs/073: paint servers — linearGradient/radialGradient resolved from
// `fill/stroke: url(#id)`. vant's Empty illustrations are drawn almost
// entirely with gradient fills, so "url(#…) paints nothing" left the shapes
// blank on the app. The assertions sample real pixels off a
// PictureRecorder canvas — no golden files.
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/svg.dart';

/// Minimal op writer: svg subtrees need create/props/insert only — the
/// painter reads attributes from props and styles are optional.
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

  void str(String s) => b.addAll(utf8.encode(s));

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    u16(tag.length);
    str(tag);
  }

  void props(int id, Map<String, Object?> props) {
    final json = utf8.encode(jsonEncode(props));
    u8(UiOpCode.setProps);
    u32(id);
    u32(json.length);
    b.addAll(json);
  }

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }

  /// <defs><linearGradient|radialGradient id="g">…two stops…</…></defs>;
  /// radial when the attrs carry `r`. Callers set the stops right after.
  void gradient(int defsId, int gid, Map<String, Object?> attrs,
      {required List<int> stopIds}) {
    create(defsId, 'defs');
    create(gid, attrs.containsKey('r') ? 'radialGradient' : 'linearGradient');
    props(gid, {'id': 'g', ...attrs});
    for (final i in stopIds) {
      create(i, 'stop');
    }
    insert(gid, stopIds[0], 0);
    insert(gid, stopIds[1], 1);
    insert(defsId, gid, 0);
  }
}

/// Pumps the svg and paints it at 160×160, returning raw RGBA bytes.
///
/// The raster call (`Picture.toImage`) must run inside `tester.runAsync`:
/// the plain test body is a FakeAsync zone, and the engine's raster-thread
/// completion never drains there — the await would hang forever.
Future<Uint8List> _paintSvg(WidgetTester tester, _W w, int svgId) async {
  w.insert(0, svgId, 0);
  final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 160,
            height: 160,
            child: FjsSvg(tree: tree, nodeId: svgId),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  final painter = tester
      .widget<CustomPaint>(
        find.descendant(of: find.byType(FjsSvg), matching: find.byType(CustomPaint)),
      )
      .painter!;
  final px = await tester.runAsync<Uint8List?>(() async {
    final recorder = ui.PictureRecorder();
    painter.paint(Canvas(recorder), const Size(160, 160));
    final img = await recorder.endRecording().toImage(160, 160);
    final bd = await img.toByteData(format: ui.ImageByteFormat.rawRgba);
    return bd?.buffer.asUint8List();
  });
  return px!;
}

/// Straight-alpha sample at (x, y): rawRgba is premultiplied, so a pixel's
/// channels are `color * alpha / 255` — assertions compare premultiplied
/// values accordingly.
Color _pixel(Uint8List px, int x, int y) {
  final o = (y * 160 + x) * 4;
  return Color.fromARGB(px[o + 3], px[o], px[o + 1], px[o + 2]);
}

/// Ramp endpoints are only reached exactly at the box edges; a pixel a few
/// units in has moved a few percent along the ramp (and dithering wobbles
/// the last bit), so channel assertions compare within a tolerance.
void _expectNear(Color actual, Color expected, {int tol = 8, String? reason}) {
  expect(actual.alpha, closeTo(expected.alpha, tol), reason: reason);
  expect(actual.red, closeTo(expected.red, tol), reason: reason);
  expect(actual.green, closeTo(expected.green, tol), reason: reason);
  expect(actual.blue, closeTo(expected.blue, tol), reason: reason);
}

void main() {
  testWidgets('linear gradient shades along its axis', (tester) async {
    final w = _W()
      ..create(1, 'svg')
      ..props(1, {'viewBox': '0 0 160 160'})
      ..gradient(2, 3, {'x1': '0', 'y1': '0', 'x2': '0', 'y2': '100%'}, stopIds: [4, 5])
      ..props(4, {'offset': '0%', 'stop-color': '#FF0000'})
      ..props(5, {'offset': '100%', 'stop-color': '#0000FF'})
      ..create(6, 'rect')
      ..props(6, {'width': 160, 'height': 160, 'fill': 'url(#g)'})
      ..insert(1, 2, 0)
      ..insert(1, 6, 1);
    final px = await _paintSvg(tester, w, 1);
    // y=5 of 160: 3% into the ramp, so ~97% red
    _expectNear(_pixel(px, 80, 5), const Color(0xFFF90008), reason: 'top');
    _expectNear(_pixel(px, 80, 155), const Color(0xFF0000F9), reason: 'bottom');
  });

  testWidgets('radial gradient clamps past its radius', (tester) async {
    final w = _W()
      ..create(1, 'svg')
      ..props(1, {'viewBox': '0 0 160 160'})
      ..gradient(2, 3, {'cx': '50%', 'cy': '50%', 'r': '50%'}, stopIds: [4, 5])
      ..props(4, {'offset': '0%', 'stop-color': '#00FF00'})
      ..props(5, {'offset': '100%', 'stop-color': '#FF00FF'})
      ..create(6, 'rect')
      ..props(6, {'width': 160, 'height': 160, 'fill': 'url(#g)'})
      ..insert(1, 2, 0)
      ..insert(1, 6, 1);
    final px = await _paintSvg(tester, w, 1);
    // radius = 50% of the normalized diagonal = 80px
    _expectNear(_pixel(px, 80, 80), const Color(0xFF00FF00), reason: 'center');
    _expectNear(_pixel(px, 2, 2), const Color(0xFFFF00FF), reason: 'clamped corner');
  });

  testWidgets('stop-opacity folds into the gradient alpha', (tester) async {
    final w = _W()
      ..create(1, 'svg')
      ..props(1, {'viewBox': '0 0 160 160'})
      ..gradient(2, 3, {'x1': '0', 'y1': '0', 'x2': '0', 'y2': '100%'}, stopIds: [4, 5])
      ..props(4, {'offset': '0%', 'stop-color': '#FF0000', 'stop-opacity': '0.5'})
      ..props(5, {'offset': '100%', 'stop-color': '#FF0000'})
      ..create(6, 'rect')
      ..props(6, {'width': 160, 'height': 160, 'fill': 'url(#g)'})
      ..insert(1, 2, 0)
      ..insert(1, 6, 1);
    final px = await _paintSvg(tester, w, 1);
    // alpha rides the ramp too: 96.9% between the two stops' alphas
    expect((_pixel(px, 80, 5)).alpha, closeTo(128, 8));
    expect((_pixel(px, 80, 155)).alpha, closeTo(251, 4));
  });

  testWidgets('gradientTransform reshapes the gradient space', (tester) async {
    // vant's ground shadow: a squashed radial (scale on one axis)
    final w = _W()
      ..create(1, 'svg')
      ..props(1, {'viewBox': '0 0 160 160'})
      ..gradient(
        2,
        3,
        {'cx': '50%', 'cy': '50%', 'r': '50%', 'gradientTransform': 'scale(1 0.25)'},
        stopIds: [4, 5],
      )
      ..props(4, {'offset': '0%', 'stop-color': '#00FF00'})
      ..props(5, {'offset': '100%', 'stop-color': '#FF00FF'})
      ..create(6, 'rect')
      ..props(6, {'width': 160, 'height': 160, 'fill': 'url(#g)'})
      ..insert(1, 2, 0)
      ..insert(1, 6, 1);
    final px = await _paintSvg(tester, w, 1);
    // scale(1 0.25) moves the centre too (to y=20): the iso-color lines are
    // 80×20 ellipses around (80,20). (80,30) is 10px below that centre =
    // 40px in gradient space = mid-ramp; (80,110) is 90px below = 360px,
    // far past the radius → clamped to the last stop.
    final mid = _pixel(px, 80, 30);
    final below = _pixel(px, 80, 110);
    expect(mid, isNot(const Color(0xFF00FF00)));
    expect(mid, isNot(const Color(0xFFFF00FF)));
    expect(below, const Color(0xFFFF00FF));
  });

  testWidgets('a gradient can stroke, and fill:none stays empty', (tester) async {
    final w = _W()
      ..create(1, 'svg')
      ..props(1, {'viewBox': '0 0 160 160'})
      ..gradient(2, 3, {'x1': '0', 'y1': '0', 'x2': '0', 'y2': '100%'}, stopIds: [4, 5])
      ..props(4, {'offset': '0%', 'stop-color': '#FF0000'})
      ..props(5, {'offset': '100%', 'stop-color': '#0000FF'})
      ..create(6, 'circle')
      ..props(6, {
        'cx': 80, 'cy': 80, 'r': 40, 'fill': 'none',
        'stroke': 'url(#g)', 'stroke-width': 8,
      })
      ..insert(1, 2, 0)
      ..insert(1, 6, 1);
    final px = await _paintSvg(tester, w, 1);
    // (80,80) is inside the ring: fill:none → nothing painted
    expect((_pixel(px, 80, 80)).alpha, 0);
    // (80,42) is inside the 8px stroke band (36..44) around r=40
    final ring = _pixel(px, 80, 42);
    expect(ring.alpha, 255);
    expect(ring, isNot(const Color(0xFF000000)));
  });

  testWidgets('each shape maps the gradient to its own box', (tester) async {
    // van-empty inherits `fill="url(#…)"` from a <g>; children of every
    // size each get the full sweep, like the browser's objectBoundingBox
    final w = _W()
      ..create(1, 'svg')
      ..props(1, {'viewBox': '0 0 160 160'})
      ..gradient(2, 3, {'x1': '0', 'y1': '0', 'x2': '100%', 'y2': '0'}, stopIds: [4, 5])
      ..props(4, {'offset': '0%', 'stop-color': '#FF0000'})
      ..props(5, {'offset': '100%', 'stop-color': '#0000FF'})
      ..create(7, 'g')
      ..props(7, {'fill': 'url(#g)'})
      ..create(8, 'rect')
      ..props(8, {'width': 80, 'height': 80})
      ..create(9, 'rect')
      ..props(9, {'x': 80, 'width': 80, 'height': 80})
      ..insert(7, 8, 0)
      ..insert(7, 9, 1)
      ..insert(1, 2, 0)
      ..insert(1, 7, 1);
    final px = await _paintSvg(tester, w, 1);
    // left rect's own box starts the sweep red; right rect's box starts at
    // its own left edge, so the same canvas point in ramp terms is blue
    _expectNear(_pixel(px, 5, 5), const Color(0xFFF3000C), reason: 'left rect');
    _expectNear(_pixel(px, 155, 5), const Color(0xFF1000F3), reason: 'right rect');
  });

  testWidgets('the real van-empty default svg paints every group', (tester) async {
    // The exact markup the demo's `<van-empty>` mounts (specs/073 device
    // shots): gradient defs across THREE defs blocks, buildings and clouds
    // in `<g opacity=".8">` with group-inherited gradient fills, the
    // document on its box. Sampled where each group's silhouette is.
    final w = _W();
    // svg > defs×3 (gradients) + g(buildings) + g(clouds) + g(document)
    w
      ..create(1, 'svg')
      ..props(1, {'viewBox': '0 0 160 160'})
      // defs 1: the document gradients
      ..gradient(2, 3, {'x1': '50%', 'x2': '50%', 'y2': '100%'}, stopIds: [4, 5])
      ..props(4, {'stop-color': '#F2F3F5', 'offset': '0%'})
      ..props(5, {'stop-color': '#DCDEE0', 'offset': '100%'})
      ..create(6, 'linearGradient')
      ..props(6, {'id': 'g6', 'x1': '95%', 'y1': '48%', 'x2': '5.5%', 'y2': '51%'})
      ..create(7, 'stop')
      ..props(7, {'stop-color': '#EAEDF1', 'offset': '0%'})
      ..create(8, 'stop')
      ..props(8, {'stop-color': '#DCDEE0', 'offset': '100%'})
      ..insert(6, 7, 0)
      ..insert(6, 8, 1)
      ..insert(2, 6, 1)
      ..create(9, 'linearGradient')
      ..props(9, {'id': 'g7', 'y1': '45%', 'x2': '100%', 'y2': '54%'})
      ..create(10, 'stop')
      ..props(10, {'stop-color': '#EAEDF1', 'offset': '0%'})
      ..create(11, 'stop')
      ..props(11, {'stop-color': '#DCDEE0', 'offset': '100%'})
      ..insert(9, 10, 0)
      ..insert(9, 11, 1)
      ..insert(2, 9, 2)
      ..insert(1, 2, 0)
      // defs 2: the buildings' gradient
      ..create(12, 'defs')
      ..create(13, 'linearGradient')
      ..props(13, {'id': 'ga', 'x1': '64%', 'y1': '100%', 'x2': '64%'})
      ..create(14, 'stop')
      ..props(14, {'stop-color': '#FFF', 'offset': '0%', 'stop-opacity': '0.5'})
      ..create(15, 'stop')
      ..props(15, {'stop-color': '#F2F3F5', 'offset': '100%'})
      ..insert(13, 14, 0)
      ..insert(13, 15, 1)
      ..insert(12, 13, 0)
      ..insert(1, 12, 1)
      // buildings: <g opacity=".8" fill via url(#ga) on each path>
      ..create(16, 'g')
      ..props(16, {'opacity': '.8'})
      ..create(17, 'path')
      ..props(17, {'d': 'M36 131V53H16v20H2v58h34z', 'fill': 'url(#ga)'})
      ..create(18, 'path')
      ..props(18, {'d': 'M123 15h22v14h9v77h-31V15z', 'fill': 'url(#ga)'})
      ..insert(16, 17, 0)
      ..insert(16, 18, 1)
      ..insert(1, 16, 2)
      // defs 3 + clouds
      ..create(19, 'defs')
      ..create(20, 'linearGradient')
      ..props(20, {'id': 'gb', 'x1': '64%', 'y1': '97%', 'x2': '64%', 'y2': '0%'})
      ..create(21, 'stop')
      ..props(21, {'stop-color': '#F2F3F5', 'offset': '0%', 'stop-opacity': '0.3'})
      ..create(22, 'stop')
      ..props(22, {'stop-color': '#F2F3F5', 'offset': '100%'})
      ..insert(20, 21, 0)
      ..insert(20, 22, 1)
      ..insert(19, 20, 0)
      ..insert(1, 19, 3)
      ..create(23, 'g')
      ..props(23, {'opacity': '.8'})
      ..create(24, 'path')
      ..props(24, {
        'd': 'M87 6c3 0 7 3 8 6a8 8 0 1 1-1 16H80a7 7 0 0 1-8-6c0-4 3-7 6-7 0-5 4-9 9-9Z',
        'fill': 'url(#gb)',
      })
      ..create(25, 'path')
      ..props(25, {
        'd': 'M19 23c2 0 3 1 4 3 2 0 4 2 4 4a4 4 0 0 1-4 3v1h-7v-1l-1 1c-2 0-3-2-3-4 0-1 1-3 3-3 0-2 2-4 4-4Z',
        'fill': 'url(#gb)',
      })
      ..insert(23, 24, 0)
      ..insert(23, 25, 1)
      ..insert(1, 23, 4)
      // document on its box: <g translate(36 50) fill=none>…
      ..create(26, 'g')
      ..props(26, {'transform': 'translate(36 50)', 'fill': 'none'})
      ..create(27, 'g')
      ..props(27, {'transform': 'translate(8)'})
      ..create(28, 'rect')
      ..props(28, {'fill': '#EBEDF0', 'opacity': '.6', 'x': 38, 'y': 13, 'width': 36, 'height': 53, 'rx': 2})
      ..create(29, 'rect')
      ..props(29, {'fill': 'url(#g)', 'width': 64, 'height': 66, 'rx': 2})
      ..create(30, 'rect')
      ..props(30, {'fill': '#FFF', 'x': 6, 'y': 6, 'width': 52, 'height': 55, 'rx': 1})
      ..create(31, 'g')
      ..props(31, {'transform': 'translate(15 17)', 'fill': 'url(#g6)'})
      ..create(32, 'rect')
      ..props(32, {'width': 34, 'height': 6, 'rx': 1})
      ..create(33, 'path')
      ..props(33, {'d': 'M0 14h34v6H0z'})
      ..create(34, 'rect')
      ..props(34, {'y': 28, 'width': 34, 'height': 6, 'rx': 1})
      ..insert(31, 32, 0)
      ..insert(31, 33, 1)
      ..insert(31, 34, 2)
      ..insert(27, 28, 0)
      ..insert(27, 29, 1)
      ..insert(27, 30, 2)
      ..insert(27, 31, 3)
      ..create(35, 'rect')
      ..props(35, {'fill': 'url(#g7)', 'y': 61, 'width': 88, 'height': 28, 'rx': 1})
      ..create(36, 'rect')
      ..props(36, {'fill': '#F7F8FA', 'x': 29, 'y': 72, 'width': 30, 'height': 6, 'rx': 1})
      ..insert(26, 27, 0)
      ..insert(26, 35, 1)
      ..insert(26, 36, 2)
      ..insert(1, 26, 5);

    final px = await _paintSvg(tester, w, 1);
    void expectOpaque(String what, Color c) {
      expect(c.alpha, greaterThan(0), reason: '$what painted nothing');
    }

    // document paper, its text bars, the box under it
    expectOpaque('document paper', _pixel(px, 70, 90));
    expectOpaque('document text bar', _pixel(px, 60, 82));
    expectOpaque('box under document', _pixel(px, 80, 125));
    // buildings flanking the document
    expectOpaque('left building', _pixel(px, 19, 100));
    expectOpaque('right building', _pixel(px, 133, 60));
    // clouds
    expectOpaque('cloud right', _pixel(px, 87, 18));
    expectOpaque('cloud left', _pixel(px, 20, 30));
  });

  testWidgets('the van-empty search shadow (squashed radial) paints', (tester) async {
    // The ellipse under the magnifier: radialGradient r=297% squashed by
    // matrix(-.16 0 0 -.33 .58 .72) — this one was still missing on device
    // after the first gradient pass (specs/073).
    final w = _W()
      ..create(1, 'svg')
      ..props(1, {'viewBox': '0 0 160 160'})
      ..create(2, 'defs')
      ..create(3, 'radialGradient')
      ..props(3, {
        'id': 'gd',
        'cx': '50%', 'cy': '54%', 'fx': '50%', 'fy': '54%', 'r': '297%',
        'gradientTransform': 'matrix(-.16 0 0 -.33 .58 .72)',
      })
      ..create(4, 'stop')
      ..props(4, {'stop-color': '#EBEDF0', 'offset': '0%'})
      ..create(5, 'stop')
      ..props(5, {'stop-color': '#F2F3F5', 'offset': '100%', 'stop-opacity': '0.3'})
      ..insert(3, 4, 0)
      ..insert(3, 5, 1)
      ..insert(2, 3, 0)
      ..insert(1, 2, 0)
      ..create(6, 'ellipse')
      ..props(6, {'fill': 'url(#gd)', 'opacity': '.8', 'cx': 80, 'cy': 140, 'rx': 46, 'ry': 8})
      ..insert(1, 6, 1);

    final px = await _paintSvg(tester, w, 1);
    // the ellipse's own box is (34,132)-(126,148); its centre and left lobe
    // must carry the shadow (alpha 0.8 · near-1 → >100)
    expect(_pixel(px, 80, 140).alpha, greaterThan(100), reason: 'shadow centre');
    expect(_pixel(px, 50, 140).alpha, greaterThan(40), reason: 'shadow left lobe');
    expect(_pixel(px, 80, 145).alpha, greaterThan(40), reason: 'shadow lower rim');
  });
}
