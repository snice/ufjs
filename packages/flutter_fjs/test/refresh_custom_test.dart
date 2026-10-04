// `refresh` 自定义头部模式（specs/206）：两个子级 = 头部内容 + scroll-view。
// 钉住通知驱动拉动整条链：拖动出头部 → 过阈值换文案（statuschange）→
// 释放触发 refresh + loading 钉住 → `refreshing` prop 翻 false 收口归位；
// 未过阈值释放收口且不触发 refresh。头部模式必须在通知层挑出直接子级
// scroll-view（depth != 0 不拉），这是它和内嵌滚动体共存的前提。
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart' show FjsEvent;
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';

class _W {
  final List<int> b = [];
  void u8(int v) => b.add(v & 0xff);
  void u16(int v) => b
    ..add(v & 0xff)
    ..add(v >> 8 & 0xff);
  void u32(int v) {
    final d = ByteData(4)..setUint32(0, v, Endian.little);
    b.addAll(d.buffer.asUint8List());
  }

  void bytes(List<int> l) {
    u32(l.length);
    b.addAll(l);
  }
}

void _create(
  _W w,
  int id,
  String tag,
  int parent, {
  Map<String, Object?>? props,
  String? text,
}) {
  w.u8(UiOpCode.create);
  w.u32(id);
  final t = utf8.encode(tag);
  w.u16(t.length);
  w.b.addAll(t);
  if (text != null) {
    w.u8(UiOpCode.setText);
    w.u32(id);
    w.bytes(utf8.encode(text));
  }
  if (props != null) {
    w.u8(UiOpCode.setProps);
    w.u32(id);
    w.bytes(utf8.encode(jsonEncode(props)));
  }
  w.u8(UiOpCode.insert);
  w.u32(parent);
  w.u32(id);
  w.u32(0x7fffffff);
}

class _Event {
  const _Event(this.nodeId, this.type, this.text);
  final int nodeId;
  final int type;
  final String? text;
}

/// root > refresh(props) > [view('HEAD'), scroll-view > view > 30 行文字]
MirrorTree _refreshTree({Map<String, Object?>? props}) {
  final w = _W();
  _create(w, 1, 'view', 0);
  _create(w, 2, 'refresh', 1, props: {
    'onStatuschange': true,
    ...?props,
  });
  _create(w, 3, 'view', 2);
  _create(w, 4, 'text', 3, text: 'HEAD');
  _create(w, 5, 'scroll-view', 2, props: {'scrollY': true});
  _create(w, 6, 'view', 5);
  for (var i = 0; i < 30; i++) {
    _create(w, 10 + i, 'text', 6, text: 'row $i');
  }
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b))..flushDirty();
}

Widget _render(MirrorTree tree, List<_Event> events) => MaterialApp(
  home: Scaffold(
    body: SizedBox(
      height: 420,
      child: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        dispatch: (id, type, {String? text}) => events.add(_Event(id, type, text)),
      ),
    ),
  ),
);

Future<void> applyProps(
  WidgetTester tester,
  MirrorTree tree,
  int id,
  Map<String, Object?> props,
) async {
  final w = _W();
  w.u8(UiOpCode.setProps);
  w.u32(id);
  w.bytes(utf8.encode(jsonEncode(props)));
  tree.applyFrame(Uint8List.fromList(w.b));
  tree.flushDirty();
  await tester.pump();
}

List<String> statuses(List<_Event> events) => [
  for (final e in events)
    if (e.type == FjsEvent.statusChange)
      (const JsonDecoder().convert(e.text!) as Map)['status'] as String,
];

void main() {
  testWidgets('pull past the threshold triggers refresh and holds', (
    tester,
  ) async {
    final events = <_Event>[];
    await tester.pumpWidget(_render(_refreshTree(), events));
    // Idle: the header sits fully above the box (top = -50, clipped).
    expect(tester.getTopLeft(find.text('HEAD')).dy, moreOrLessEquals(-50));

    await tester.drag(find.byType(Scrollable), const Offset(0, 120));
    await tester.pumpAndSettle();

    // Status lines crossed on the way: pulling, then loosing; the release
    // fired refresh (vant's order: refresh first, then the loading status).
    expect(statuses(events), ['pulling', 'loosing', 'loading']);
    expect(
      events.where((e) => e.type == FjsEvent.refresh),
      isNotEmpty,
    );
    // Released past the threshold: held at the head height, header at top 0.
    expect(tester.getTopLeft(find.text('HEAD')).dy, moreOrLessEquals(0));
  });

  testWidgets('refreshing prop flipped false collapses the header', (
    tester,
  ) async {
    final events = <_Event>[];
    final tree = _refreshTree(props: {'refreshing': false});
    await tester.pumpWidget(_render(tree, events));

    await tester.drag(find.byType(Scrollable), const Offset(0, 120));
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(find.text('HEAD')).dy, moreOrLessEquals(0));

    // The wrapper acks the trigger by flipping the prop true (vant's model
    // true) — native is already loading, so this is a no-op state-wise.
    await applyProps(tester, tree, 2, {'refreshing': true});
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(find.text('HEAD')).dy, moreOrLessEquals(0));

    // JS is done: the prop flips back false -> the header collapses above
    // the box and the status resets (vant's close()).
    await applyProps(tester, tree, 2, {'refreshing': false});
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(find.text('HEAD')).dy, moreOrLessEquals(-50));
    expect(statuses(events).last, 'normal');
  });

  testWidgets('releasing below the threshold cancels without a refresh', (
    tester,
  ) async {
    final events = <_Event>[];
    await tester.pumpWidget(_render(_refreshTree(), events));

    await tester.drag(find.byType(Scrollable), const Offset(0, 30));
    await tester.pumpAndSettle();

    expect(statuses(events), ['pulling', 'normal']);
    expect(events.where((e) => e.type == FjsEvent.refresh), isEmpty);
    expect(tester.getTopLeft(find.text('HEAD')).dy, moreOrLessEquals(-50));
  });

  testWidgets('a drag that starts mid-list never arms the pull', (
    tester,
  ) async {
    final events = <_Event>[];
    await tester.pumpWidget(_render(_refreshTree(), events));

    // Scroll the list down a bit, then drag it back past the top in ONE
    // gesture: vant only pulls from a touchstart at scrollTop 0.
    await tester.drag(find.byType(Scrollable), const Offset(0, -150));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(Scrollable), const Offset(0, 400));
    await tester.pumpAndSettle();

    expect(statuses(events), isEmpty);
    expect(events.where((e) => e.type == FjsEvent.refresh), isEmpty);
    expect(tester.getTopLeft(find.text('HEAD')).dy, moreOrLessEquals(-50));
  });
}
