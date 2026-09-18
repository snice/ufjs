// swiper's properties. `circular` and the index a page sees are defined in
// fjs-runtime/src/scroll/metrics.ts (wrapIndex); the same behaviours are
// asserted for the web adapter in fjs-runtime/test/web-scroll-swiper.test.ts.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/control_scope.dart';
import 'package:flutter_fjs/src/widgets/swiper.dart';

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

/// Builds `<swiper>` with [pages] text children and the given props; the
/// swiper is always node 1, so a test can send it a new prop frame.
MirrorTree swiperTree(
  Map<String, Object?> props,
  int pages, {

  /// Put a plain <view> between the page and its text, the way a real page
  /// does (`<swiper-item><view class="slide">`).
  bool wrapInView = false,

  /// Pages as bare <view>s rather than <swiper-item>s — what the element
  /// API can still produce; the compiler rejects it in a template.
  bool bare = false,
}) {
  final w = _W();
  var next = 1;
  final swiper = next++;
  w.u8(UiOpCode.create);
  w.u32(swiper);
  final tag = utf8.encode('swiper');
  w.u16(tag.length);
  w.raw(tag);
  final json = utf8.encode(jsonEncode(props));
  w.u8(UiOpCode.setProps);
  w.u32(swiper);
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(swiper);
  w.u32(0x7fffffff);
  for (var i = 0; i < pages; i++) {
    final page = next++;
    w.u8(UiOpCode.create);
    w.u32(page);
    final itemTag = utf8.encode(bare ? 'view' : 'swiper-item');
    w.u16(itemTag.length);
    w.raw(itemTag);
    w.u8(UiOpCode.insert);
    w.u32(swiper);
    w.u32(page);
    w.u32(0x7fffffff);
    var textParent = page;
    if (wrapInView) {
      final box = next++;
      w.u8(UiOpCode.create);
      w.u32(box);
      final viewTag = utf8.encode('view');
      w.u16(viewTag.length);
      w.raw(viewTag);
      w.u8(UiOpCode.insert);
      w.u32(page);
      w.u32(box);
      w.u32(0x7fffffff);
      textParent = box;
    }
    final text = next++;
    w.u8(UiOpCode.create);
    w.u32(text);
    final textTag = utf8.encode('text');
    w.u16(textTag.length);
    w.raw(textTag);
    w.u8(UiOpCode.setText);
    w.u32(text);
    final body = utf8.encode('page $i');
    w.u32(body.length);
    w.raw(body);
    w.u8(UiOpCode.insert);
    w.u32(textParent);
    w.u32(text);
    w.u32(0x7fffffff);
  }
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

void setSwiperProps(MirrorTree tree, Map<String, Object?> props) {
  final w = _W()
    ..u8(UiOpCode.setProps)
    ..u32(1);
  final json = utf8.encode(jsonEncode(props));
  w.u32(json.length);
  w.raw(json);
  tree.applyFrame(Uint8List.fromList(w.b));
  tree.flushDirty();
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

const int pageChanged = 6;

void main() {
  setUp(resetFjsWarnOnce);

  testWidgets('renders one page per child and starts on current', (
    tester,
  ) async {
    final tree = swiperTree({'current': 1}, 3);
    await tester.pumpWidget(render(tree, []));
    await tester.pumpAndSettle();
    expect(find.text('page 1'), findsOneWidget);
    expect(find.text('page 0'), findsNothing);
  });

  testWidgets('a current the page changes turns the pager', (tester) async {
    final tree = swiperTree({'current': 0}, 3);
    final log = <(int, String?)>[];
    await tester.pumpWidget(render(tree, log));
    await tester.pumpAndSettle();

    setSwiperProps(tree, {'current': 2});
    await tester.pumpAndSettle();
    expect(find.text('page 2'), findsOneWidget);
    expect(log, [(pageChanged, '2')]);
  });

  testWidgets('an out-of-range current lands on the last page and warns', (
    tester,
  ) async {
    final logs = <String>[];
    final original = debugPrint;
    debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
    try {
      final tree = swiperTree({'current': 9}, 3);
      await tester.pumpWidget(render(tree, []));
      await tester.pumpAndSettle();
      expect(find.text('page 2'), findsOneWidget);
    } finally {
      debugPrint = original;
    }
    expect(logs.where((l) => l.contains('current=9')), isNotEmpty);
  });

  testWidgets('a bare child still pages and warns (specs/051)', (tester) async {
    final logs = <String>[];
    final original = debugPrint;
    debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
    try {
      final tree = swiperTree({'current': 1}, 2, bare: true);
      await tester.pumpWidget(render(tree, []));
      await tester.pumpAndSettle();
      expect(find.text('page 1'), findsOneWidget);
    } finally {
      debugPrint = original;
    }
    expect(
      logs.where((l) => l.contains('is not a <swiper-item>')),
      hasLength(1),
    );
  });

  testWidgets('swiper-item pages do not warn', (tester) async {
    final logs = <String>[];
    final original = debugPrint;
    debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
    try {
      await tester.pumpWidget(render(swiperTree({}, 2), []));
      await tester.pumpAndSettle();
    } finally {
      debugPrint = original;
    }
    expect(logs.where((l) => l.contains('swiper-item')), isEmpty);
  });

  testWidgets('circular reports the real index when it wraps', (tester) async {
    // Driven by autoplay rather than gestures: a fling's momentum can carry
    // two pages, and what is under test here is the INDEX the page sees,
    // not the physics.
    final tree = swiperTree({
      'circular': true,
      'autoplay': true,
      'interval': 1000,
      'duration': 1,
    }, 3);
    final log = <(int, String?)>[];
    await tester.pumpWidget(render(tree, log));
    await tester.pumpAndSettle();

    for (var i = 0; i < 3; i++) {
      await tester.pump(const Duration(milliseconds: 1100));
      await tester.pumpAndSettle();
    }
    // pumpAndSettle keeps the clock running, so more ticks may land after
    // these three; what matters is the order and that a clone's page number
    // never shows up.
    expect(log.map((e) => e.$2).take(3).toList(), ['1', '2', '0']);
  });

  testWidgets('autoplay turns the page on its interval', (tester) async {
    final tree = swiperTree({
      'autoplay': true,
      'interval': 1000,
      'duration': 1,
    }, 3);
    final log = <(int, String?)>[];
    await tester.pumpWidget(render(tree, log));
    await tester.pumpAndSettle();

    await tester.pump(const Duration(milliseconds: 1100));
    await tester.pumpAndSettle();
    expect(log, [(pageChanged, '1')]);

    // and stops at the end without circular
    await tester.pump(const Duration(milliseconds: 1100));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 1100));
    await tester.pumpAndSettle();
    expect(log.last.$2, '2');
  });

  testWidgets('indicator dots: one per page, the current one filled', (
    tester,
  ) async {
    final tree = swiperTree({'indicatorDots': true, 'current': 1}, 3);
    await tester.pumpWidget(render(tree, []));
    await tester.pumpAndSettle();

    final dots = tester
        .widgetList<Container>(find.byType(Container))
        .where(
          (c) =>
              c.constraints?.maxWidth == fjsSwiperDotSize ||
              (c.decoration as BoxDecoration?)?.shape == BoxShape.circle,
        )
        .toList();
    expect(dots, hasLength(3));
    final colors = dots
        .map((d) => (d.decoration as BoxDecoration).color)
        .toList();
    expect(colors[1], fjsSwiperDotActiveColor);
    expect(colors[0], fjsSwiperDotColor);
  });

  testWidgets('a page fills the pager, wrapper or not', (tester) async {
    // Caught on the simulator: a <swiper-item> shrink-wrapped its content to
    // one line at the top instead of filling the 200px page.
    final tree = swiperTree({}, 3, wrapInView: true);
    await tester.pumpWidget(render(tree, []));
    await tester.pumpAndSettle();

    final pager = tester.getSize(find.byType(PageView));
    // The CONTENT has to fill, not just the box around it: the demo's slide
    // is a plain <view> with no height, and on the simulator it rendered as
    // a strip at the top of a 200px pager.
    // the id shows up twice: on the node's own view and on the flex wrapper
    // that carries its key
    final content = tester.getSize(find.byKey(const ValueKey<int>(3)).first);
    expect(content.height, moreOrLessEquals(pager.height, epsilon: 1));
  });

  testWidgets('vertical turns pages up and down', (tester) async {
    final tree = swiperTree({'vertical': true}, 3);
    final log = <(int, String?)>[];
    await tester.pumpWidget(render(tree, log));
    await tester.pumpAndSettle();

    await tester.fling(find.byType(PageView), const Offset(0, -80), 800);
    await tester.pumpAndSettle();
    expect(log, [(pageChanged, '1')]);
  });
}
