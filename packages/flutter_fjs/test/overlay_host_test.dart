// specs/070 D3: `position: fixed` hoisted elements must anchor inside the
// overlay host by their own offsets — `top: 0` at the top of the screen,
// `bottom: 0` at the bottom (vant nav-bar vs tab-bar). The device showed the
// top-anchored bar landing at the BOTTOM, so this pins both anchorings at the
// widget layer, through the same op stream the JS side writes.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
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

  void str(String s) => b.addAll(utf8.encode(s));

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    u16(tag.length);
    str(tag);
  }

  void define(int id, Map<String, Object?> style) {
    final json = utf8.encode(jsonEncode(style));
    u8(UiOpCode.defineStyle);
    u32(id);
    u32(json.length);
    raw(json);
  }

  void raw(List<int> l) => b.addAll(l);

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }

  void props(int id, Map<String, Object?> props) {
    final json = utf8.encode(jsonEncode(props));
    u8(UiOpCode.setProps);
    u32(id);
    u32(json.length);
    raw(json);
  }

  var _nextStyle = 1000;

  /// create + define + setStyle in one go.
  void node(int id, String tag, Map<String, Object?> style) {
    create(id, tag);
    final sid = _nextStyle++;
    define(sid, style);
    u8(UiOpCode.setStyle);
    u32(id);
    u32(sid);
    u32(0);
  }
}

Future<MirrorTree> _pump(WidgetTester tester, _W w) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = const Size(400, 640);
  addTearDown(tester.view.reset);
  final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FjsNodeRenderer(
          tree: tree,
          ids: tree.rootChildren,
          dispatch: (id, ev, {String? text}) {},
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
  return tree;
}

Rect _paintedRect(WidgetTester tester, int id) {
  final b = tester.renderObject(find.byKey(ValueKey(id)).first) as RenderBox;
  return Rect.fromPoints(
    b.localToGlobal(Offset.zero),
    b.localToGlobal(b.size.bottomRight(Offset.zero)),
  );
}

void main() {
  // The page root plus the overlay host it gains on first hoist, and one
  // hoisted bar per anchor edge — vant's `.van-nav-bar--fixed` (top: 0) and
  // `.van-tabbar` (bottom: 0), both `left: 0; width: 100%`.
  _W bars() {
    final w = _W()
      ..node(1, 'view', {'flexGrow': 1})
      ..node(2, 'fjs-overlay-host', {
        'position': 'absolute', 'left': 0, 'top': 0, 'right': 0, 'bottom': 0,
      })
      ..node(3, 'view', {
        'position': 'fixed', 'left': 0, 'top': 0, 'width': '100%',
        'height': 44, 'backgroundColor': '#1989fa',
      })
      ..node(4, 'view', {
        'position': 'fixed', 'left': 0, 'bottom': 0, 'width': '100%',
        'height': 50, 'backgroundColor': '#07c160',
      })
      ..insert(1, 2, 0)
      ..insert(2, 3, 0)
      ..insert(2, 4, 1)
      ..insert(0, 1, 0);
    return w;
  }

  testWidgets('hoisted top:0 lands at the top of the screen', (tester) async {
    await _pump(tester, bars());
    final r = _paintedRect(tester, 3);
    // ignore: avoid_print
    print('bar rect=$r');
    expect(r.top, 0, reason: 'top:0 anchors the bar to the screen top');
    expect(r.left, 0);
    expect(r.width, 400);
  });

  testWidgets('hoisted bottom:0 lands at the bottom of the screen',
      (tester) async {
    await _pump(tester, bars());
    final r = _paintedRect(tester, 4);
    expect(r.bottom, 640,
        reason: 'bottom:0 anchors the bar to the screen bottom');
    expect(r.width, 400);
  });

}
