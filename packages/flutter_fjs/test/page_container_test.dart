// `page-container`'s contract (specs/065), mirroring modal_live_test's
// shape: ops frames written the way the JS writer would send them, so the
// tests exercise the real mirror-tree -> route path.
//
// The asymmetry with `modal` is deliberate and asserted here: a JS-driven
// close reports NOTHING on modal (JS already knows) but fires the whole
// leave chain on page-container, because the native side owns the
// animation clock — the page syncs `show` in @after-leave.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart';
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

  void raw(List<int> l) => b.addAll(l);
}

class _Ops {
  final _W w = _W();

  void create(int id, String tag) {
    w.u8(UiOpCode.create);
    w.u32(id);
    final bytes = utf8.encode(tag);
    w.u16(bytes.length);
    w.raw(bytes);
  }

  void text(int id, String value) {
    w.u8(UiOpCode.setText);
    w.u32(id);
    final bytes = utf8.encode(value);
    w.u32(bytes.length);
    w.raw(bytes);
  }

  void props(int id, Map<String, Object?> value) {
    w.u8(UiOpCode.setProps);
    w.u32(id);
    final bytes = utf8.encode(jsonEncode(value));
    w.u32(bytes.length);
    w.raw(bytes);
  }

  void insert(int parent, int id) {
    w.u8(UiOpCode.insert);
    w.u32(parent);
    w.u32(id);
    w.u32(0x7fffffff);
  }

  void remove(int id) {
    w.u8(UiOpCode.remove);
    w.u32(id);
  }

  Uint8List take() => Uint8List.fromList(w.b);
}

typedef Events = List<(int, String?)>;

Widget render(MirrorTree tree, Events log) => MaterialApp(
  home: Scaffold(
    body: FjsNodeRenderer(
      tree: tree,
      ids: tree.rootChildren,
      dispatch: (id, type, {String? text}) => log.add((type, text)),
    ),
  ),
);

(MirrorTree, Events) openable({
  String position = 'bottom',
  bool slideDown = false,
  int rows = 1,
}) {
  final ops = _Ops()
    ..create(1, 'page-container')
    ..props(1, {
      'show': false,
      'position': position,
      'closeOnSlideDown': slideDown,
      'onBeforeEnter': true,
      'onEnter': true,
      'onAfterEnter': true,
      'onBeforeLeave': true,
      'onLeave': true,
      'onAfterLeave': true,
      'onClickoverlay': true,
    })
    ..insert(0, 1);
  for (var i = 0; i < rows; i++) {
    ops
      ..create(10 + i, 'text')
      ..text(10 + i, 'row $i')
      ..insert(1, 10 + i);
  }
  final tree = MirrorTree()..applyFrame(ops.take());
  return (tree, <(int, String?)>[]);
}

void setShow(MirrorTree tree, bool show) {
  tree.applyFrame((_Ops()..props(1, {'show': show})).take());
  tree.flushDirty();
}

void addChild(MirrorTree tree, int id, String label) {
  tree.applyFrame(
    (_Ops()
          ..create(id, 'text')
          ..text(id, label)
          ..insert(1, id))
        .take(),
  );
  tree.flushDirty();
}

const enterChain = [FjsEvent.beforeEnter, FjsEvent.enter, FjsEvent.afterEnter];
const leaveChain = [FjsEvent.beforeLeave, FjsEvent.leave, FjsEvent.afterLeave];

void main() {
  testWidgets(
    'show drives the container, and the leave chain fires on a JS-driven close',
    (tester) async {
      final (tree, log) = openable();
      await tester.pumpWidget(render(tree, log));
      expect(find.text('row 0'), findsNothing);

      setShow(tree, true);
      await tester.pumpAndSettle();
      expect(find.text('row 0'), findsOneWidget);
      expect(log.map((e) => e.$1), enterChain);

      // modal's "JS already knows" rule does NOT apply: the page syncs show
      // from @after-leave, so even a JS-driven close reports the chain.
      setShow(tree, false);
      await tester.pumpAndSettle();
      expect(find.text('row 0'), findsNothing);
      expect(log.map((e) => e.$1), [...enterChain, ...leaveChain]);
    },
  );

  testWidgets(
    'overlay tap reports clickoverlay and leaves the close to the page',
    (tester) async {
      final (tree, log) = openable();
      await tester.pumpWidget(render(tree, log));
      setShow(tree, true);
      await tester.pumpAndSettle();
      log.clear();

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(log, [(FjsEvent.clickOverlay, null)]);
      // still open — wx semantics: the page closes in its own handler
      expect(find.text('row 0'), findsOneWidget);
    },
  );

  testWidgets('content added while open shows up in the open container', (
    tester,
  ) async {
    final (tree, log) = openable();
    await tester.pumpWidget(render(tree, log));
    setShow(tree, true);
    await tester.pumpAndSettle();
    expect(find.text('row 1'), findsNothing);

    addChild(tree, 11, 'row 1');
    await tester.pumpAndSettle();
    expect(find.text('row 1'), findsOneWidget);
  });

  testWidgets('an edge swipe pops the container and fires the leave chain', (
    tester,
  ) async {
    final (tree, log) = openable();
    await tester.pumpWidget(render(tree, log));
    setShow(tree, true);
    await tester.pumpAndSettle();
    log.clear();

    // start inside the 20px leading-edge strip; a synthetic drag carries no
    // usable fling velocity, so drag past half the screen to settle the
    // bounce-back vs pop decision on distance alone
    await tester.dragFrom(const Offset(5, 300), const Offset(500, 0));
    await tester.pumpAndSettle();
    expect(find.text('row 0'), findsNothing);
    expect(log.map((e) => e.$1), leaveChain);
  });

  testWidgets('close-on-slide-down pops past the threshold, not below it', (
    tester,
  ) async {
    final (tree, log) = openable(slideDown: true);
    await tester.pumpWidget(render(tree, log));
    setShow(tree, true);
    await tester.pumpAndSettle();

    // 40px of downward drag stays under the 80px threshold
    await tester.drag(find.text('row 0'), const Offset(0, 40));
    await tester.pumpAndSettle();
    expect(find.text('row 0'), findsOneWidget);

    // 120px crosses it
    await tester.drag(find.text('row 0'), const Offset(0, 120));
    await tester.pumpAndSettle();
    expect(find.text('row 0'), findsNothing);
    final seen = log.map((e) => e.$1).toList();
    expect(seen.sublist(seen.length - 3), leaveChain);
  });

  testWidgets('center fades, right slides in from the side', (tester) async {
    for (final position in ['center', 'right']) {
      final (tree, log) = openable(position: position);
      await tester.pumpWidget(render(tree, log));
      setShow(tree, true);
      await tester.pumpAndSettle();
      expect(find.text('row 0'), findsOneWidget, reason: position);
      expect(tester.takeException(), isNull);

      setShow(tree, false);
      await tester.pumpAndSettle();
      expect(find.text('row 0'), findsNothing, reason: position);
      log.clear();
    }
  });
}
