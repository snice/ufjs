// An interactive absolutely positioned box that hangs outside its parents
// still takes the pointer there, as on the web — vant's Slider knob is a
// 24px circle on a 2px bar, and a drag that started off the bar's band went
// to the scroll-view instead (overflow_hit.dart).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/ffi.dart' show FjsEvent;
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/render/touch.dart' show debugResetTouches;
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
}

void _create(_W w, int id, String tag, int parent, Map props) {
  w.u8(UiOpCode.create);
  w.u32(id);
  final t = utf8.encode(tag);
  w.u16(t.length);
  w.b.addAll(t);
  final json = utf8.encode(jsonEncode(props));
  w.u8(UiOpCode.setProps);
  w.u32(id);
  w.u32(json.length);
  w.b.addAll(json);
  w.u8(UiOpCode.insert);
  w.u32(parent);
  w.u32(id);
  w.u32(0x7fffffff);
}

/// page (padding 40) > bar (200x2, relative) > knob (24x24 centred on the
/// bar's right end, touch handlers + `touch-action: none`)
MirrorTree _slider({bool interactive = true}) {
  final w = _W();
  _create(w, 1, 'view', 0, {
    'style': {'padding': 40},
  });
  _create(w, 2, 'view', 1, {
    'style': {'width': 200, 'height': 2, 'position': 'relative'},
  });
  _create(w, 3, 'view', 2, {
    if (interactive) 'onTouchstart': true,
    'style': {
      'position': 'absolute',
      'top': -11,
      'right': -12,
      'width': 24,
      'height': 24,
      if (interactive) 'touchAction': 'none',
    },
  });
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

Widget _render(MirrorTree tree, List<(int, int)> log) => MaterialApp(
  home: Scaffold(
    body: Align(
      alignment: Alignment.topLeft,
      child: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        grow: false,
        dispatch: (id, type, {String? text}) => log.add((id, type)),
      ),
    ),
  ),
);

void main() {
  tearDown(debugResetTouches);

  testWidgets('the knob takes a press outside the bar\'s band', (
    tester,
  ) async {
    final log = <(int, int)>[];
    await tester.pumpWidget(_render(_slider(), log));
    // bar spans y 40..42; the knob y 29..53, x 228..252
    final gesture = await tester.startGesture(const Offset(240, 50));
    await tester.pump();
    expect(log, contains((3, FjsEvent.touchStart)));
    await gesture.up();
  });

  testWidgets('a press off the knob still misses it', (tester) async {
    final log = <(int, int)>[];
    await tester.pumpWidget(_render(_slider(), log));
    final gesture = await tester.startGesture(const Offset(240, 60));
    await tester.pump();
    expect(log.where((e) => e.$1 == 3), isEmpty);
    await gesture.up();
  });
}
