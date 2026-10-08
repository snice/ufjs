// End-to-end test of specs/211: the global components root. The JS side
// mounts a dedicated `fjs-global-host` root marked `__global` with one small
// absolutely positioned box. FjsApp must paint it ABOVE the Navigator exactly
// once (never also as base-page content), keep it over a pushed page, let
// touches fall through everywhere the box does not paint, and NOT hold the
// system back press (it is always visible — unlike an `__appOverlay` float).
import 'dart:convert';
import 'dart:async';
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

const _jsProgram = r'''
var buf = [];
function u32(v) { buf.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }
function u16(v) { buf.push(v & 255, (v >> 8) & 255); }
function str(s) { for (var i = 0; i < s.length; i++) buf.push(s.charCodeAt(i)); }
function flush() { __fjs.fns.uiOps(new Uint8Array(buf)); buf = []; }
function create(tag) { var n = nextId++; buf.push(1); u32(n); u16(tag.length); str(tag); return n; }
function insert(p, c, i) { buf.push(3); u32(p); u32(c); u32(i); }
function setText(n, t) { buf.push(5); u32(n); u32(t.length); str(t); }
function setProps(n, v) { var json = JSON.stringify(v); buf.push(6); u32(n); u32(json.length); str(json); }

var nextId = 1;
function mountPage(navKey, label) {
  var root = create('view');
  insert(0, root, 0);
  setProps(root, { __navKey: navKey });
  var text = create('text');
  setText(text, label);
  insert(root, text, 0);
  flush();
}
function removeRoot(id) { buf.push(2); u32(id); flush(); }

globalThis.events = [];
globalThis.__fjsDispatchEvent = function (id, type, payload) {
  events.push(type + ':' + id);
  if (type === 10) mountPage(id, 'page-' + id);
};
globalThis.push = function (key) {
  __fjs.fns.invokeHost('fjs.nav.push', key, '/p' + key, 'Page ' + key, '', '');
};
globalThis.popTop = function () { __fjs.fns.invokeHost('fjs.nav.pop'); };

mountPage(0, 'home');

// the global root + one small absolute child: a stand-in floating ball
var appRoot, mark;
globalThis.mountAppRoot = function () {
  appRoot = create('fjs-global-host');
  insert(0, appRoot, 1);
  setProps(appRoot, { __global: true });
  mark = create('view');
  setProps(mark, { style: { position: 'absolute', left: 8, top: 100, width: 60, height: 60 } });
  insert(appRoot, mark, 0);
  var text = create('text');
  setText(text, 'global-mark');
  insert(mark, text, 0);
  flush();
};
mountAppRoot();

globalThis.removeAppRoot = function () { removeRoot(appRoot); };

// a sized mask first, a small item after it (fan-menu shape, specs/211)
globalThis.mountMenu = function (px) {
  var box = px ? { width: 800, height: 600 } : { width: '100%', height: '100%' };
  // the framework's wrapper (global-components.ts) + a component root
  var wrap = create('view');
  setProps(wrap, { style: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: box.width, height: box.height } });
  insert(appRoot, wrap, 1);
  var gb = create('view');
  setProps(gb, { style: { position: 'absolute', left: 0, top: 0, width: box.width, height: box.height } });
  insert(wrap, gb, 0);
  gbId = gb;
  var item = create('view');
  setProps(item, { onTap: true, style: { position: 'absolute', left: 120, top: 200, width: 44, height: 44 } });
  insert(gb, item, 0);
  var t = create('text');
  setText(t, 'M');
  insert(item, t, 0);
  flush();
};

// the mask joins LATER but sits BEFORE the item in tree order (a display
// toggle / v-if): attach order says "mask on top", paint order says "item"
var gbId;
globalThis.showMask = function () {
  var mask = create('view');
  setProps(mask, { onTap: true, style: { position: 'absolute', left: 0, top: 0, width: 300, height: 500, backgroundColor: 'rgba(0,0,0,0.2)' } });
  insert(gbId, mask, 0);
  flush();
};
''';

String? _libPath() {
  var dir = Directory.current;
  for (var i = 0; i < 6; i++) {
    final candidate = File(
      '${dir.path}/packages/flutter_fjs/native/build-native/libfjs.dylib',
    );
    if (candidate.existsSync()) return candidate.path;
    final local = File('${dir.path}/native/build-native/libfjs.dylib');
    if (local.existsSync()) return local.path;
    dir = dir.parent;
  }
  return null;
}

void main() {
  final lib = _libPath();
  if (lib == null || !Platform.isMacOS) {
    return;
  }
  ffi.DynamicLibrary.open(lib);

  late FjsEngine engine;

  setUp(() {
    engine = FjsEngine();
    engine.runSource(_jsProgram, filename: 'global-host-test.js');
  });

  tearDown(() => engine.dispose());

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await tester.pumpAndSettle();
  }

  testWidgets('global root paints once, above pushed pages', (tester) async {
    await pumpApp(tester);
    expect(find.text('global-mark'), findsOneWidget);
    expect(find.text('home'), findsOneWidget);

    engine.runSource('push(1)');
    await tester.pumpAndSettle();
    expect(find.text('page-1'), findsOneWidget);
    expect(find.text('global-mark'), findsOneWidget);

    engine.runSource('removeAppRoot()');
    await tester.pumpAndSettle();
    expect(find.text('global-mark'), findsNothing);
  });

  // The layer fills the screen but must not take touches where nothing
  // paints: a hit-test at a blank point reaches the page underneath, and only
  // the mark's own area lands in the global subtree.
  testWidgets('touches fall through where the global box does not paint', (
    tester,
  ) async {
    await pumpApp(tester);
    final markBox = tester.renderObject<RenderBox>(find.text('global-mark'));
    // the global root's render object: the highest ancestor still inside the
    // overlay host's Stack slot (its parent is the RenderStack)
    RenderObject layer = markBox;
    while (layer.parent != null && layer.parent is! RenderStack) {
      layer = layer.parent!;
    }
    bool hitsLayer(Offset at) {
      final result = HitTestResult();
      tester.binding.hitTestInView(result, at, tester.view.viewId);
      return result.path.any((e) => identical(e.target, layer));
    }

    final inside = tester.getCenter(find.text('global-mark'));
    expect(hitsLayer(inside), isTrue);
    final size = tester.view.physicalSize / tester.view.devicePixelRatio;
    expect(hitsLayer(Offset(size.width - 4, size.height - 4)), isFalse);
    expect(hitsLayer(Offset(size.width / 2, 40)), isFalse);
  });

  testWidgets('system back is NOT held by a global root', (tester) async {
    await pumpApp(tester);
    engine.runSource('push(1)');
    await tester.pumpAndSettle();
    expect(find.text('global-mark'), findsOneWidget);

    // ignore: invalid_use_of_protected_member
    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    // the page popped even though the always-visible global box is up
    expect(find.text('page-1'), findsNothing);
    expect(find.text('home'), findsOneWidget);
  });

  // The fan menu (specs/211): an item inserted AFTER a sized mask must be hit
  // before it. Sized by `100%` / inset the layer lays out at height 0 on
  // Flutter (no in-flow content), every child then "hangs outside its parent"
  // and is hit through FjsOverflowHitScope — which used to order by ATTACH time
  // (the mask, shown later, beat the item). It now orders by paint order.
  for (final px in [false, true]) {
    testWidgets(
      'a later absolute sibling is hit before an earlier mask '
      '(${px ? 'px' : '%'} sized layer)',
      (tester) async {
        await pumpApp(tester);
        engine.runSource('mountMenu($px)');
        await tester.pumpAndSettle();
        engine.runSource('showMask()');
        await tester.pumpAndSettle();
        // the synthetic tree's hand-sized boxes trip a 4px debug overflow
        // assertion on the root flex; layout is what matters here
        tester.takeException();
        final itemBox = tester.renderObject<RenderBox>(find.text('M'));
        final at = tester.getCenter(find.text('M'));
        final result = HitTestResult();
        tester.binding.hitTestInView(result, at, tester.view.viewId);
        expect(
          result.path.any((e) => identical(e.target, itemBox)),
          isTrue,
          reason:
              'hit path: ${result.path.map((e) => e.target.runtimeType).toList()}',
        );
      },
    );
  }
}
