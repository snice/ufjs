// A tap on blank page blurs a focused input, as a browser does (specs/124).
// Flutter's own tap-outside keeps focus for touch on mobile platforms, so
// FjsView puts FjsBlankTapBlur at the page root: only a tap (not a drag),
// and only one no deeper node handles (tap / touch listeners, inputs).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart' show FjsEvent;
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/blank_tap_blur.dart';

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

  void node(int id, int parent, String tag, Map<String, Object?> props) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
    final json = utf8.encode(jsonEncode(props));
    u8(UiOpCode.setProps);
    u32(id);
    u32(json.length);
    raw(json);
    u8(UiOpCode.insert);
    u32(parent);
    u32(id);
    u32(0x7fffffff);
  }
}

const _input1 = 2, _tapView = 3, _blank = 4, _input2 = 5, _touchView = 6;

// Stacked top to bottom in a 400-tall column; points measured from the
// laid-out tree: input 0-40, @tap view 80-130, blank between, input
// 240-280, @touchstart view 320-370.
const _atInput1 = Offset(50, 20);
const _atTapView = Offset(50, 105);
const _atBlank = Offset(50, 180);
const _atInput2 = Offset(50, 260);
const _atTouchView = Offset(50, 345);

MirrorTree _tree() {
  final w = _W();
  Map<String, Object?> box(double h) => {'width': 200, 'height': h};
  w.node(1, 0, 'view', {
    'style': {'width': 200, 'height': 400, 'flexDirection': 'column'},
  });
  w.node(_input1, 1, 'input', {'style': box(40), 'onFocus': true});
  w.node(_tapView, 1, 'view', {'style': box(50), 'onTap': true});
  w.node(_blank, 1, 'view', {'style': box(50)});
  w.node(_input2, 1, 'input', {'style': box(40)});
  w.node(_touchView, 1, 'view', {'style': box(50), 'onTouchstart': true});
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

typedef _Log = List<(int, int)>;

Widget _host(MirrorTree tree, _Log log) => MaterialApp(
  home: Scaffold(
    body: FjsBlankTapBlur(
      child: Align(
        alignment: Alignment.topLeft,
        child: FjsNodeRenderer(
          tree: tree,
          ids: tree.rootChildren,
          dispatch: (id, type, {String? text}) => log.add((id, type)),
        ),
      ),
    ),
  ),
);

/// Focus/blur events only, in order.
List<(int, int)> _focusLog(_Log log) => [
  for (final e in log)
    if (e.$2 == FjsEvent.focus || e.$2 == FjsEvent.blur) e,
];

Future<_Log> _focused(WidgetTester tester) async {
  final log = <(int, int)>[];
  await tester.pumpWidget(_host(_tree(), log));
  await tester.tapAt(_atInput1);
  await tester.pumpAndSettle();
  expect(_focusLog(log), [(_input1, FjsEvent.focus)]);
  log.clear();
  return log;
}

bool _hasFocus(WidgetTester tester, int index) => tester
    .widget<TextField>(find.byType(TextField).at(index))
    .focusNode!
    .hasFocus;

void main() {
  testWidgets('a tap on blank page blurs the field', (tester) async {
    final log = await _focused(tester);
    await tester.tapAt(_atBlank);
    await tester.pumpAndSettle();
    expect(_hasFocus(tester, 0), isFalse);
    expect(_focusLog(log), [(_input1, FjsEvent.blur)]);
  });

  testWidgets('a tap the page handles keeps focus', (tester) async {
    final log = await _focused(tester);
    await tester.tapAt(_atTapView);
    await tester.pumpAndSettle();
    expect(log, contains((_tapView, FjsEvent.tap)));
    expect(_hasFocus(tester, 0), isTrue);
    expect(_focusLog(log), isEmpty);
  });

  testWidgets('a touchstart listener keeps focus (vant clear icon)', (
    tester,
  ) async {
    final log = await _focused(tester);
    await tester.tapAt(_atTouchView);
    await tester.pumpAndSettle();
    expect(log, contains((_touchView, FjsEvent.touchStart)));
    expect(_hasFocus(tester, 0), isTrue);
  });

  testWidgets('a drag outside is not a tap', (tester) async {
    final log = await _focused(tester);
    await tester.dragFrom(_atBlank, const Offset(0, 60));
    await tester.pumpAndSettle();
    expect(_hasFocus(tester, 0), isTrue);
    expect(_focusLog(log), isEmpty);
  });

  testWidgets('tapping another input moves focus once', (tester) async {
    final log = await _focused(tester);
    await tester.tapAt(_atInput2);
    await tester.pumpAndSettle();
    expect(_hasFocus(tester, 0), isFalse);
    expect(_hasFocus(tester, 1), isTrue);
    expect(_focusLog(log), [
      (_input1, FjsEvent.blur),
      (_input2, FjsEvent.focus),
    ]);
  });
}
