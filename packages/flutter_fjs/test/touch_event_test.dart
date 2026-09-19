// Touch events: the payload JS receives, how moves are batched, and the
// `touch-action` half — who wins the gesture when a scrollable is listening
// for the same finger.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart' show FjsEvent;
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/render/touch.dart';
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
  void raw(List<int> l) => b.addAll(l);
}

MirrorTree _treeWith(String propsJson) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final json = utf8.encode(propsJson);
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

/// Two sibling nodes (1 and 2) under the root, both listening for touches.
MirrorTree _twoNodes() {
  final w = _W();
  for (final id in [1, 2]) {
    w.u8(UiOpCode.create);
    w.u32(id);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.setProps);
    w.u32(id);
    final json = utf8.encode('{$_box,$_listens}');
    w.u32(json.length);
    w.raw(json);
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(id);
    w.u32(id - 1);
  }
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

/// A positioned parent with two absolute children, matching dnd.vue.
MirrorTree _twoAbsoluteNodes() {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(10);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.setProps);
  w.u32(10);
  var json = utf8.encode(
    '{"style":{"position":"relative","width":100,"height":220}}',
  );
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(10);
  w.u32(0);

  for (final id in [1, 2]) {
    w.u8(UiOpCode.create);
    w.u32(id);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.setProps);
    w.u32(id);
    json = utf8.encode(
      '{"style":{"position":"absolute","left":0,"top":0,'
      '"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"touchAction":"none","transform":"translate(0px, ${(id - 1) * 110}px)"},'
      '$_listens}',
    );
    w.u32(json.length);
    w.raw(json);
    w.u8(UiOpCode.insert);
    w.u32(10);
    w.u32(id);
    w.u32(id - 1);
  }

  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

/// Moves node 1 after node 2, the frame a `v-for` reorder produces.
void _moveFirstLast(MirrorTree tree) {
  final w = _W();
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(2);
  tree.applyFrame(Uint8List.fromList(w.b));
}

void _moveFirstLastInStack(MirrorTree tree) {
  final w = _W();
  w.u8(UiOpCode.insert);
  w.u32(10);
  w.u32(1);
  w.u32(2);
  tree.applyFrame(Uint8List.fromList(w.b));
}

/// A setProps frame for node 1, the way a JS-side style change arrives.
void _setProps(MirrorTree tree, String propsJson) {
  final w = _W();
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final json = utf8.encode(propsJson);
  w.u32(json.length);
  w.raw(json);
  tree.applyFrame(Uint8List.fromList(w.b));
}

/// One dispatched event, decoded the way src/ui/touch.ts does.
class _Event {
  _Event(this.type, this.payload);
  final int type;
  final Map<String, Object?> payload;

  List<List<num>> _points(String key) {
    final raw = payload[key] ?? payload['touches'];
    return [
      for (final t in (raw as List<Object?>? ?? const []))
        [for (final n in t as List<Object?>) n as num],
    ];
  }

  List<List<num>> get touches => _points('touches');
  List<List<num>> get targetTouches => _points('tt');
  List<List<num>> get changedTouches => _points('changed');
}

Widget _render(
  MirrorTree tree,
  List<_Event> log, {
  bool scrollable = false,
  ScrollController? controller,
}) {
  final node = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (id, type, {String? text}) => log.add(
      _Event(
        type,
        text == null ? {} : jsonDecode(text) as Map<String, Object?>,
      ),
    ),
  );
  return MaterialApp(
    home: scrollable
        ? ListView(
            controller: controller,
            children: [node, const SizedBox(height: 2000)],
          )
        : Center(child: node),
  );
}

const _box = '"style":{"width":100,"height":100,"backgroundColor":"#ffffff"}';
const _listens =
    '"onTouchstart":true,"onTouchmove":true,'
    '"onTouchend":true,"onTouchcancel":true';

void main() {
  setUp(debugResetTouches);

  testWidgets('a drag reports start, move and end with DOM-shaped lists', (
    tester,
  ) async {
    final log = <_Event>[];
    await tester.pumpWidget(
      _render(_treeWith('{$_box,$_listens,"id":"card"}'), log),
    );
    final start = tester.getCenter(find.byType(Container));

    final finger = await tester.startGesture(start);
    expect(log.single.type, FjsEvent.touchStart);
    expect(log.single.payload['id'], 'card');
    expect(log.single.touches, [
      [1, start.dx, start.dy],
    ]);
    // one finger: targetTouches and changedTouches are the same list, and
    // the payload says so by leaving them out
    expect(log.single.payload.containsKey('tt'), isFalse);
    expect(log.single.targetTouches, log.single.touches);

    log.clear();
    await finger.moveBy(const Offset(20, 30));
    await tester.pump();
    expect(log.single.type, FjsEvent.touchMove);
    expect(log.single.changedTouches, [
      [1, start.dx + 20, start.dy + 30],
    ]);

    log.clear();
    await finger.up();
    await tester.pump();
    expect(log.single.type, FjsEvent.touchEnd);
    // as in the DOM, the finger that just left is gone from `touches` and
    // survives only in changedTouches
    expect(log.single.touches, isEmpty);
    expect(log.single.changedTouches, [
      [1, start.dx + 20, start.dy + 30],
    ]);
  });

  testWidgets('a drag survives its parent dropping a transition mid-gesture', (
    tester,
  ) async {
    // vant's Slider: the bar carries `transition: all .2s`, and the drag's
    // touchstart sets `transition: none` on it. The transition layer above
    // the button went away with it, the button's listener remounted, and
    // every move after that was routed to the disposed one.
    Uint8List props(int id, String json) {
      final w = _W()
        ..u8(UiOpCode.setProps)
        ..u32(id);
      final bytes = utf8.encode(json);
      w
        ..u32(bytes.length)
        ..raw(bytes);
      return Uint8List.fromList(w.b);
    }

    final w = _W();
    for (final id in [1, 2]) {
      w
        ..u8(UiOpCode.create)
        ..u32(id)
        ..u16(4)
        ..str('view');
    }
    w
      ..u8(UiOpCode.insert)
      ..u32(0)
      ..u32(1)
      ..u32(0)
      ..u8(UiOpCode.insert)
      ..u32(1)
      ..u32(2)
      ..u32(0);
    final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
    const bar = '"width":200,"height":100';
    tree
      ..applyFrame(props(1, '{"style":{$bar,"transition":"all .2s"}}'))
      ..applyFrame(props(2, '{$_box,$_listens}'));
    final log = <_Event>[];
    await tester.pumpWidget(_render(tree, log));

    final finger = await tester.startGesture(
      tester.getCenter(find.byType(Container).last),
    );
    expect(log.single.type, FjsEvent.touchStart);

    tree.applyFrame(props(1, '{"style":{$bar,"transition":"none"}}'));
    tree.flushDirty();
    await tester.pump();

    log.clear();
    await finger.moveBy(const Offset(20, 0));
    await tester.pump();
    expect(log.map((e) => e.type), [FjsEvent.touchMove]);
    await finger.up();
  });

  testWidgets('the payload carries the node origin, so JS can offset', (
    tester,
  ) async {
    // Coordinates are page-space; a page has no getBoundingClientRect to
    // convert them with, so the origin rides along and ui/touch.ts turns it
    // into offsetX/offsetY. A <canvas> hit-tests against exactly that.
    final log = <_Event>[];
    await tester.pumpWidget(_render(_treeWith('{$_box,$_listens}'), log));
    final box = tester.getTopLeft(find.byType(Container));
    final start = tester.getCenter(find.byType(Container));

    final finger = await tester.startGesture(start);
    expect(log.single.payload['o'], [box.dx, box.dy]);

    log.clear();
    await finger.moveBy(const Offset(10, 10));
    await tester.pump();
    expect(log.single.payload['o'], [box.dx, box.dy]);
    await finger.up();
  });

  testWidgets('moves in one frame collapse to a single dispatch', (
    tester,
  ) async {
    final log = <_Event>[];
    await tester.pumpWidget(_render(_treeWith('{$_box,$_listens}'), log));
    final start = tester.getCenter(find.byType(Container));
    final finger = TestPointer(1, PointerDeviceKind.touch);
    tester.binding.handlePointerEvent(finger.down(start));
    await tester.pump();
    log.clear();

    // three moves in one turn of the event loop, the way a platform hands
    // over a packet: JS only cares where the finger ended up
    tester.binding.handlePointerEvent(finger.move(start + const Offset(5, 0)));
    tester.binding.handlePointerEvent(finger.move(start + const Offset(10, 0)));
    tester.binding.handlePointerEvent(finger.move(start + const Offset(15, 0)));
    await tester.pump();
    expect(log.length, 1);
    expect(log.single.changedTouches.single[1], start.dx + 15);
    tester.binding.handlePointerEvent(finger.up());
  });

  testWidgets('a second finger shows up in touches, and both move in one '
      'event', (tester) async {
    final log = <_Event>[];
    await tester.pumpWidget(_render(_treeWith('{$_box,$_listens}'), log));
    final center = tester.getCenter(find.byType(Container));
    final one = TestPointer(1, PointerDeviceKind.touch);
    final two = TestPointer(2, PointerDeviceKind.touch);

    tester.binding.handlePointerEvent(one.down(center));
    tester.binding.handlePointerEvent(two.down(center + const Offset(10, 10)));
    await tester.pump();
    expect(log.last.type, FjsEvent.touchStart);
    expect(log.last.touches.length, 2);
    // the finger this event is about is the only one in changedTouches
    expect(log.last.changedTouches.single[0], 2);

    log.clear();
    tester.binding.handlePointerEvent(one.move(center + const Offset(0, 5)));
    tester.binding.handlePointerEvent(two.move(center + const Offset(10, 17)));
    await tester.pump();
    // both fingers moved in the same batch: one event, two changedTouches
    expect(log.length, 1);
    expect(log.single.changedTouches.length, 2);

    tester.binding.handlePointerEvent(one.up());
    tester.binding.handlePointerEvent(two.up());
    await tester.pump();
  });

  testWidgets('touch-action: none keeps an enclosing list from scrolling', (
    tester,
  ) async {
    final log = <_Event>[];
    final controller = ScrollController();
    await tester.pumpWidget(
      _render(
        _treeWith(
          '{"style":{"width":100,"height":100,'
          '"backgroundColor":"#ffffff","touchAction":"none"},$_listens}',
        ),
        log,
        scrollable: true,
        controller: controller,
      ),
    );

    final finger = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await finger.moveBy(const Offset(0, -120));
    await tester.pump();
    await finger.up();
    await tester.pump();

    expect(controller.offset, 0, reason: 'the node claimed the gesture');
    expect(
      log.map((e) => e.type),
      contains(FjsEvent.touchMove),
    ); // and kept getting the moves
    expect(log.map((e) => e.type), isNot(contains(FjsEvent.touchCancel)));
  });

  testWidgets('touch-action: none wins before a fast first scroll move', (
    tester,
  ) async {
    final log = <_Event>[];
    final controller = ScrollController();
    await tester.pumpWidget(
      _render(
        _treeWith(
          '{"style":{"width":100,"height":100,'
          '"backgroundColor":"#ffffff","touchAction":"none"},$_listens}',
        ),
        log,
        scrollable: true,
        controller: controller,
      ),
    );

    final start = tester.getCenter(find.byType(Container));
    final finger = TestPointer(1, PointerDeviceKind.touch);
    tester.binding.handlePointerEvent(finger.down(start));
    tester.binding.handlePointerEvent(
      finger.move(start + const Offset(0, -80)),
    );
    await tester.pump();

    expect(controller.offset, 0, reason: 'the node won before scroll slop');
    expect(log.map((e) => e.type), contains(FjsEvent.touchMove));
    expect(log.map((e) => e.type), isNot(contains(FjsEvent.touchCancel)));

    tester.binding.handlePointerEvent(finger.up());
    await tester.pump();
  });

  testWidgets('a scroll that takes over cancels the touches', (tester) async {
    final log = <_Event>[];
    final controller = ScrollController();
    await tester.pumpWidget(
      _render(
        _treeWith('{$_box,$_listens}'), // touch-action: auto
        log,
        scrollable: true,
        controller: controller,
      ),
    );

    final finger = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    // the first move past the threshold is what the list wins the arena
    // with; the second is the one it scrolls by
    await finger.moveBy(const Offset(0, -30));
    await tester.pump();
    await finger.moveBy(const Offset(0, -90));
    await tester.pump();

    expect(controller.offset, greaterThan(0), reason: 'the list scrolled');
    expect(log.last.type, FjsEvent.touchCancel);
    await finger.up();
  });

  testWidgets('touch-action: pan-y leaves vertical scrolling alone', (
    tester,
  ) async {
    final log = <_Event>[];
    final controller = ScrollController();
    await tester.pumpWidget(
      _render(
        _treeWith(
          '{"style":{"width":100,"height":100,'
          '"backgroundColor":"#ffffff","touchAction":"pan-y"},$_listens}',
        ),
        log,
        scrollable: true,
        controller: controller,
      ),
    );

    final finger = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await finger.moveBy(const Offset(0, -30));
    await tester.pump();
    await finger.moveBy(const Offset(0, -90));
    await tester.pump();
    expect(controller.offset, greaterThan(0));
    await finger.up();
  });

  testWidgets('a node with no touch handlers adds no listener', (tester) async {
    final log = <_Event>[];
    await tester.pumpWidget(_render(_treeWith('{$_box}'), log));
    expect(find.byType(FjsTouchNode), findsNothing);
    final finger = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    await finger.up();
    expect(log, isEmpty);
  });

  testWidgets('a node torn down mid-drag reports a cancel', (tester) async {
    final log = <_Event>[];
    final tree = _treeWith('{$_box,$_listens}');
    await tester.pumpWidget(_render(tree, log));
    final finger = await tester.startGesture(
      tester.getCenter(find.byType(Container)),
    );
    log.clear();

    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    expect(log.single.type, FjsEvent.touchCancel);
    await finger.up();
  });

  testWidgets('a translated node is touched where it is painted', (
    tester,
  ) async {
    // what a drag relies on: transform moves the hit test with the paint,
    // so the finger keeps holding the block it picked up
    final log = <_Event>[];
    await tester.pumpWidget(
      _render(
        _treeWith(
          '{"style":{"width":100,"height":100,'
          '"backgroundColor":"#ffffff","transform":"translate(120px, 0)"},'
          '$_listens}',
        ),
        log,
      ),
    );
    final painted = tester.getCenter(find.byType(Container));

    final finger = await tester.startGesture(painted);
    expect(log.single.type, FjsEvent.touchStart);
    await finger.up();

    log.clear();
    final away = await tester.startGesture(painted - const Offset(120, 0));
    expect(log, isEmpty, reason: 'the box is not where it laid out any more');
    await away.up();
  });

  testWidgets('a transform arriving mid-drag does not cancel it', (
    tester,
  ) async {
    // the drag itself is what sets the transform, so the node gaining one
    // must not disturb the listener holding the finger
    final log = <_Event>[];
    final tree = _treeWith('{$_box,$_listens}');
    await tester.pumpWidget(_render(tree, log));
    final start = tester.getCenter(find.byType(Container));
    final finger = await tester.startGesture(start);
    log.clear();

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transform":"translate(20px, 0)"}}',
    );
    await tester.pumpWidget(_render(tree, log));
    expect(log, isEmpty, reason: 'no cancel: the same listener is still there');

    await finger.moveBy(const Offset(30, 0));
    await tester.pump();
    expect(log.single.type, FjsEvent.touchMove);
    await finger.up();
  });

  testWidgets('reordering siblings mid-drag keeps the finger', (tester) async {
    // the drag is what reorders the list, so a row must survive its own
    // move: the nodes are keyed by id, otherwise the children reconcile by
    // position and every row is rebuilt — cancelling the drag in flight
    final log = <_Event>[];
    final tree = _twoNodes();
    await tester.pumpWidget(_render(tree, log));
    final second = tester.getCenter(find.byType(Container).last);

    final finger = await tester.startGesture(second);
    log.clear();

    _moveFirstLast(tree);
    await tester.pumpWidget(_render(tree, log));
    expect(log, isEmpty, reason: 'the drag survived the reorder');

    await finger.moveBy(const Offset(0, 20));
    await tester.pump();
    expect(log.single.type, FjsEvent.touchMove);
    await finger.up();
    await tester.pump();
    expect(log.last.type, FjsEvent.touchEnd);
  });

  testWidgets('reordering absolute stack children mid-drag keeps the finger', (
    tester,
  ) async {
    final log = <_Event>[];
    final tree = _twoAbsoluteNodes();
    await tester.pumpWidget(_render(tree, log));
    final first = tester.getCenter(find.byType(Container).first);

    final finger = await tester.startGesture(first);
    log.clear();

    _moveFirstLastInStack(tree);
    await tester.pumpWidget(_render(tree, log));
    expect(log, isEmpty, reason: 'stack reorder did not cancel the drag');

    await finger.moveBy(const Offset(0, 20));
    await tester.pump();
    expect(log.single.type, FjsEvent.touchMove);
    await finger.up();
    await tester.pump();
    expect(log.last.type, FjsEvent.touchEnd);
  });
}
