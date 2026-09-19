// A stretched item whose absolute cross size is wider than the line keeps
// it: the box overflows, and the part past the line still paints and takes
// hits — render/flex.dart FjsUncappedCross. That is vant's swipe track
// (N×100% in a 100%-wide .van-swipe): clamped to the line, every page after
// the first translate step was a dead zone — the visible item lived beyond
// the track's box and Flutter hit testing rejects a point outside each
// render box (the browser hits the overflowing item under the transformed
// track). specs/073, vant-nav 两端对拍.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/ffi.dart' show FjsEvent;
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/render/touch.dart'
    show FjsTouchNode, debugResetTouches;
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

void _create(_W w, int id, int parent, Map props) {
  w.u8(UiOpCode.create);
  w.u32(id);
  final t = utf8.encode('view');
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

/// The vant swipe shape: `.van-swipe` (100×100, overflow hidden) > track
/// (explicit width 3×100, transform translateX) > three 100×100 items; the
/// track takes touch events, like vant's touchmove target.
MirrorTree _swipe({double translate = 0}) {
  final w = _W();
  _create(w, 1, 0, {
    'style': {'width': 100, 'height': 100, 'overflow': 'hidden'},
  });
  _create(w, 2, 1, {
    'onTouchstart': true,
    'style': {
      'flexDirection': 'row',
      'width': 300,
      'height': 100,
      'transform': 'translateX(${translate}px)',
    },
  });
  for (var i = 0; i < 3; i++) {
    _create(w, 3 + i, 2, {
      'style': {
        'width': 100,
        'height': 100,
        'backgroundColor': '#00000${i + 1}',
      },
    });
  }
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

Rect _box(WidgetTester tester, String hex) {
  final color = Color(int.parse('ff${hex.substring(1)}', radix: 16));
  final finder = find.byWidgetPredicate(
    (w) =>
        w is Container &&
        w.decoration is BoxDecoration &&
        (w.decoration! as BoxDecoration).color == color,
  );
  return tester.getRect(finder);
}

void main() {
  tearDown(debugResetTouches);

  testWidgets('the track keeps its declared width and the line keeps its own', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_swipe(), []));
    // items 2/3 live past the line — painted where the track lays them,
    // clipped by .van-swipe, and NOT clamped into it
    final track = tester.getRect(find.byType(FjsTouchNode));
    expect(_box(tester, '#000001').width, 100);
    expect(_box(tester, '#000002').left, 100);
    expect(_box(tester, '#000003').left, 200);
    expect(track.width, 300, reason: "the declared width, not the line's 100");
  });

  testWidgets('a press on the second page still reaches the track', (
    tester,
  ) async {
    // one translate step: page 2 fills the visible 100px band, its box is
    // entirely beyond the line-sized box a clamp would have left
    final log = <(int, int)>[];
    await tester.pumpWidget(_render(_swipe(translate: -100), log));
    final gesture = await tester.startGesture(const Offset(50, 50));
    await tester.pump();
    expect(log, contains((2, FjsEvent.touchStart)));
    await gesture.up();
  });

  testWidgets('a press on the third page too', (tester) async {
    final log = <(int, int)>[];
    await tester.pumpWidget(_render(_swipe(translate: -200), log));
    final gesture = await tester.startGesture(const Offset(50, 50));
    await tester.pump();
    expect(log, contains((2, FjsEvent.touchStart)));
    await gesture.up();
  });

  testWidgets('a press off the translated track misses it', (tester) async {
    // 100px down: past the 100-tall track, nobody answers there
    final log = <(int, int)>[];
    await tester.pumpWidget(_render(_swipe(translate: -100), log));
    final gesture = await tester.startGesture(const Offset(50, 150));
    await tester.pump();
    expect(log.where((e) => e.$1 == 2), isEmpty);
    await gesture.up();
  });

  testWidgets('percent cross size still resolves against the line', (
    tester,
  ) async {
    // `width: 50%` keeps the line as its reference (an unbounded one would
    // read back as auto), so it goes through the Align path
    final w = _W();
    _create(w, 1, 0, {
      'style': {'width': 100, 'height': 100},
    });
    _create(w, 2, 1, {
      'style': {'width': '50%', 'height': 20, 'backgroundColor': '#000001'},
    });
    await tester.pumpWidget(
      _render(MirrorTree()..applyFrame(Uint8List.fromList(w.b)), []),
    );
    expect(_box(tester, '#000001').width, 50);
  });
}
