// End-to-end test of specs/136: the app-level overlay host. The JS side
// (hand-written against the raw op protocol, as in nav_router_test.dart)
// mounts a dedicated `fjs-app-overlay-host` root with a `__appOverlay` marker
// and one fixed child; FjsApp must paint that subtree ABOVE the Navigator —
// a pushed page does not cover it — exactly once (never also as base-page
// content), and drop it when the JS side removes the root.
import 'dart:convert';
import 'dart:async';
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter/material.dart';
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

// the app overlay root + one fixed child: a stand-in watermark
var appRoot, mark;
globalThis.mountAppRoot = function () {
  appRoot = create('fjs-app-overlay-host');
  insert(0, appRoot, 1);
  setProps(appRoot, { __appOverlay: true });
  mark = create('view');
  setProps(mark, { style: { position: 'fixed', left: 8, top: 8 } });
  insert(appRoot, mark, 0);
  var text = create('text');
  setText(text, 'global-mark');
  insert(mark, text, 0);
  flush();
};
mountAppRoot();

globalThis.removeAppRoot = function () { removeRoot(appRoot); };
// the root outlives its last element (one per VM): an empty root must not
// hold anything
globalThis.removeMark = function () { removeRoot(mark); };
// a closed teleported popup stays in the root, hidden by v-show
globalThis.hideMark = function () {
  setProps(mark, { style: { position: 'fixed', left: 8, top: 8, display: 'none' } });
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
    engine.runSource(_jsProgram, filename: 'app-overlay-test.js');
  });

  tearDown(() => engine.dispose());

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: FjsApp(engine: engine),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('app overlay paints once, above pushed pages', (tester) async {
    await pumpApp(tester);
    // exactly one: the base page must NOT double-render the marked root
    expect(find.text('global-mark'), findsOneWidget);
    expect(find.text('home'), findsOneWidget);

    engine.runSource('push(1)');
    await tester.pumpAndSettle();

    // the pushed page is on top, and the app-level float still shows
    expect(find.text('page-1'), findsOneWidget);
    expect(find.text('global-mark'), findsOneWidget);

    engine.runSource('popTop()');
    await tester.pumpAndSettle();
    expect(find.text('home'), findsOneWidget);
    expect(find.text('global-mark'), findsOneWidget);
  });

  testWidgets('removing the JS root takes the app overlay down', (
    tester,
  ) async {
    await pumpApp(tester);
    expect(find.text('global-mark'), findsOneWidget);

    engine.runSource('removeAppRoot()');
    await tester.pumpAndSettle();
    expect(find.text('global-mark'), findsNothing);
    expect(find.text('home'), findsOneWidget);
  });

  // System back is held while an app-level element is up (specs/136): on a
  // pushed page (maybePop through NavigatorPopHandler) and on the base page
  // (where back would otherwise leave the app). Emptying the root releases
  // it; a JS-driven pop is never held. The float appearing AFTER a push is
  // the case that once rebuilt NavigatorPopHandler (unstable widget shape).
  testWidgets('system back is held while an app-level element is up', (
    tester,
  ) async {
    await pumpApp(tester);
    engine.runSource('removeAppRoot()');
    await tester.pumpAndSettle();
    engine.runSource('push(1)');
    await tester.pumpAndSettle();
    engine.runSource('mountAppRoot()');
    await tester.pumpAndSettle();
    expect(find.text('global-mark'), findsOneWidget);

    // ignore: invalid_use_of_protected_member
    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(find.text('page-1'), findsOneWidget);

    // JS-driven navigation is not the system back: it still pops
    engine.runSource('popTop()');
    await tester.pumpAndSettle();
    expect(find.text('home'), findsOneWidget);

    // base page: held too, the app is not left
    // ignore: invalid_use_of_protected_member
    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(find.text('home'), findsOneWidget);

    engine.runSource('push(2)');
    await tester.pumpAndSettle();
    engine.runSource('hideMark()');
    await tester.pumpAndSettle();
    // ignore: invalid_use_of_protected_member
    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(find.text('page-2'), findsNothing);

    engine.runSource('push(3)');
    await tester.pumpAndSettle();
    engine.runSource('removeMark()');
    await tester.pumpAndSettle();
    expect(find.text('global-mark'), findsNothing);
    // ignore: invalid_use_of_protected_member
    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(find.text('page-3'), findsNothing);
    expect(find.text('home'), findsOneWidget);
  });
}
