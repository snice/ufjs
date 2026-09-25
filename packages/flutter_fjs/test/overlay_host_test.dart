// specs/070 D3: `position: fixed` hoisted elements must anchor inside the
// overlay host by their own offsets — `top: 0` at the top of the screen,
// `bottom: 0` at the bottom (vant nav-bar vs tab-bar). The device showed the
// top-anchored bar landing at the BOTTOM, so this pins both anchorings at the
// widget layer, through the same op stream the JS side writes.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/route_anchor.dart';

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

  // specs/133: the root-Overlay layer follows its page's route, and a modal
  // mask holds the back button / gesture.
  group('route ownership', () {
    // page root 1 with an in-flow marker 5 (moves with the route) and the
    // host 2 holding a stuck-sticky-like box 3; [modal] adds the prop the
    // JS side writes while a mask is up
    _W page({bool modal = false}) {
      final w = _W()
        ..node(1, 'view', {'flexGrow': 1})
        ..node(5, 'view', {'width': 40, 'height': 40})
        ..node(2, 'fjs-overlay-host', {
          'position': 'absolute', 'left': 0, 'top': 0, 'right': 0, 'bottom': 0,
        })
        ..node(3, 'view', {
          'position': 'fixed', 'left': 0, 'top': 0, 'width': 40, 'height': 40,
          'backgroundColor': '#ee0a24',
        })
        ..insert(1, 5, 0)
        ..insert(1, 2, 1)
        ..insert(2, 3, 0)
        ..insert(0, 1, 0);
      if (modal) w.props(2, {'modal': true});
      return w;
    }

    final nav = GlobalKey<NavigatorState>();
    var pageTaps = 0;

    Future<void> pumpWithPage(WidgetTester tester, _W w) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 640);
      addTearDown(tester.view.reset);
      final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
      // FjsApp's shape: a Navigator nested under the host's MaterialApp, so
      // the root Overlay the host portals into is NOT the one the pages live
      // in, and the system back button reaches the nested Navigator through
      // a NavigatorPopHandler calling maybePop (fjs_app.dart)
      await tester.pumpWidget(
        MaterialApp(
          home: NavigatorPopHandler(
            onPopWithResult: (_) => nav.currentState?.maybePop(),
            child: Navigator(
              key: nav,
              onGenerateRoute: (_) => MaterialPageRoute<void>(
                builder: (_) => const Scaffold(body: Text('base')),
              ),
            ),
          ),
        ),
      );
      // FjsApp wraps each page in FjsRouteAnchor; a GestureDetector under
      // the page content stands in for a page that takes taps
      nav.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => FjsRouteAnchor(
            child: Scaffold(
              body: Stack(
                children: [
                  Positioned.fill(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => pageTaps++,
                    ),
                  ),
                  FjsNodeRenderer(
                    tree: tree,
                    ids: tree.rootChildren,
                    dispatch: (id, ev, {String? text}) {},
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('a modal host holds maybePop and the system back button',
        (tester) async {
      await pumpWithPage(tester, page(modal: true));
      // maybePop reports a held pop as handled (true); what matters is that
      // the route stays
      await nav.currentState!.maybePop();
      await tester.pumpAndSettle();
      expect(find.text('base'), findsNothing);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey(3)), findsWidgets,
          reason: 'the page and its popup are still up');
      expect(find.text('base'), findsNothing);
    });

    testWidgets('a non-modal host lets back through and leaves nothing behind',
        (tester) async {
      await pumpWithPage(tester, page());
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('base'), findsOneWidget);
      expect(find.byKey(const ValueKey(3)), findsNothing);
    });

    testWidgets('a page pushed on top hides the layer; popping it shows it again',
        (tester) async {
      await pumpWithPage(tester, page());
      nav.currentState!.push(
        MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('top'))),
      );
      await tester.pumpAndSettle();
      // Finders already skip the covered route's element subtree, portal
      // child included — what the user sees is the root Overlay, so ask the
      // hit test whether the box still sits on top of the new page
      final box = tester.renderObject(
        find.byKey(const ValueKey(3), skipOffstage: false).last,
      );
      final hits = tester.hitTestOnBinding(const Offset(20, 20)).path;
      expect(hits.any((e) => identical(e.target, box)), isFalse,
          reason: 'the covered page\'s fixed box must not sit over the new one');
      nav.currentState!.pop();
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey(3)), findsWidgets);
    });

    // a transition builder replayed on the layer (the first cut of this
    // spec) brought CupertinoPageTransition's shadow DecoratedBox along,
    // which hit-tested the whole screen and ate every tap on the page
    testWidgets('the layer takes no taps outside its boxes (iOS)',
        (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      try {
        pageTaps = 0;
        await pumpWithPage(tester, page());
        await tester.tapAt(const Offset(200, 400));
        expect(pageTaps, 1);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });

    testWidgets('during a pop the layer slides with its page (iOS)',
        (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      try {
        await pumpWithPage(tester, page());
        nav.currentState!.pop();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 150));
        final marker = _paintedRect(tester, 5);
        final fixed = _paintedRect(tester, 3);
        expect(marker.left, greaterThan(0), reason: 'the page is mid-slide');
        expect(fixed.left, closeTo(marker.left, 0.5),
            reason: 'the fixed box moves with the page');
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey(3)), findsNothing);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });
  });
}
