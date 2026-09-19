// The vant popup slide: `.van-popup` carries `transition: transform .3s`,
// the enter flow flips `transform: translate3d(0, 100%, 0)` → none across
// two style updates one frame apart, and transitionNode must tween the
// whole transform — the `%` translation lives in transformFraction, so the
// fraction has to tween WITH the matrix or the sheet jumps (snaps) into
// place. Pins the mid-flight state.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
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

  void define(int sid, Map<String, Object?> style) {
    final json = utf8.encode(jsonEncode(style));
    u8(UiOpCode.defineStyle);
    u32(sid);
    u32(json.length);
    b.addAll(json);
  }

  void style(int id, int sid) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(sid);
    u32(0);
  }

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }
}

/// The rendered translation of node 2's FractionalTranslation (the `%` part
/// of its transform), or null when it renders unshifted.
double? _popupTranslationY(WidgetTester tester) {
  final translations = tester.widgetList<FractionalTranslation>(
    find.descendant(
      of: find.byKey(const ValueKey(2)),
      matching: find.byType(FractionalTranslation),
    ),
  );
  for (final t in translations) {
    if (t.translation.dy != 0) return t.translation.dy;
  }
  return null;
}

void main() {
  testWidgets('popup slide tweens the fraction between enter-from and none', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 800);
    addTearDown(tester.view.reset);
    const base = <String, Object?>{
      'position': 'absolute',
      'left': 0,
      'right': 0,
      'bottom': 0,
      'height': 200,
      'background': '#ffffff',
      'transition': 'transform .3s',
    };
    final w = _W()
      ..create(1, 'view')
      ..create(2, 'view')
      ..define(10, {
        ...base,
        'transform': 'translate3d(0, 100%, 0)',
      })
      ..style(2, 10)
      ..insert(1, 2, 0)
      ..insert(0, 1, 0);
    final frame1 = w.b.length;
    final tree = await _pump(tester, w);
    await tester.pump(const Duration(milliseconds: 50));
    // enter-from state: the sheet sits one full box height down
    expect(_popupTranslationY(tester), 1.0);

    // the enter flow drops the -from class one frame later
    w
      ..define(11, base)
      ..style(2, 11);
    tree.applyFrame(Uint8List.fromList(w.b.sublist(frame1)));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150)); // halfway

    final mid = _popupTranslationY(tester);
    expect(mid, isNotNull, reason: 'still animating at halfway');
    // halfway of the 100% translation: ~0.5, not the start, not the end
    expect(mid!, greaterThan(0.15), reason: 'mid-flight, not finished');
    expect(mid, lessThan(0.85), reason: 'mid-flight, not still at start');

    await tester.pump(const Duration(milliseconds: 400));
    expect(_popupTranslationY(tester), isNull);
  });


  testWidgets('the first popup slides in although its host is brand new', (
    tester,
  ) async {
    // The overlay host is created in the same frame as the first popup, and
    // the enter flow drops `enter-from` two frames later. A host that only
    // shows its portal after its first frame put the sheet on screen after
    // the drop: the first open of every page appeared without sliding.
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 800);
    addTearDown(tester.view.reset);
    const base = <String, Object?>{
      'position': 'fixed',
      'left': 0,
      'right': 0,
      'bottom': 0,
      'height': 200,
      'background': '#ffffff',
      'transition': 'transform .3s',
    };
    final w = _W()..create(1, 'view');
    w.insert(0, 1, 0);
    final tree = await _pump(tester, w);
    final start = w.b.length;
    w
      ..create(3, 'fjs-overlay-host')
      ..create(2, 'view')
      ..define(10, {...base, 'transform': 'translate3d(0, 100%, 0)'})
      ..style(2, 10)
      ..insert(3, 2, 0)
      ..insert(1, 3, 0);
    tree.applyFrame(Uint8List.fromList(w.b.sublist(start)));
    tree.flushDirty();
    await tester.pump();
    expect(_popupTranslationY(tester), 1.0, reason: 'on screen at enter-from');

    final flip = w.b.length;
    w
      ..define(11, base)
      ..style(2, 11);
    tree.applyFrame(Uint8List.fromList(w.b.sublist(flip)));
    tree.flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    final mid = _popupTranslationY(tester);
    expect(mid, isNotNull, reason: 'still sliding at halfway');
    expect(mid!, greaterThan(0.15));
    expect(mid, lessThan(0.85));
  });
}

Future<MirrorTree> _pump(WidgetTester tester, _W w) async {
  final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FjsNodeRenderer(
          tree: tree,
          ids: tree.rootChildren,
          dispatch: (_, __, {String? text}) {},
        ),
      ),
    ),
  );
  await tester.pump();
  return tree;
}
