// Tab keep-alive on the host side: the JS router parks a tab page by
// marking its root `__navHidden` instead of unmounting it. A parked root
// must stay in the widget tree — offstage, so it neither shows nor takes
// space — and come back with its state (here a list-view's scroll offset)
// intact. The JS half is hand-written against the raw op protocol, like
// nav_router_test.dart.
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

const _program = r'''
var buf = [];
function u32(v) { buf.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }
function u16(v) { buf.push(v & 255, (v >> 8) & 255); }
function str(s) { for (var i = 0; i < s.length; i++) buf.push(s.charCodeAt(i)); }
function flush() { __fjs.fns.uiOps(new Uint8Array(buf)); buf = []; }
var id = 1;
function create(tag) { var n = id++; buf.push(1); u32(n); u16(tag.length); str(tag); return n; }
function insert(parent, child, index) { buf.push(3); u32(parent); u32(child); u32(index); }
function remove(node) { buf.push(2); u32(node); }
function setText(node, text) { buf.push(5); u32(node); u32(text.length); str(text); }
function setProps(node, value) {
  var json = JSON.stringify(value);
  buf.push(6); u32(node); u32(json.length); str(json);
}

// one tab page: a root holding a scrollable list of labelled rows
function mountTab(prefix) {
  var root = create('view');
  insert(0, root, 0);
  setProps(root, { __navKey: 0 });
  var list = create('list-view');
  setProps(list, { style: { height: 100 } });
  insert(root, list, 0);
  for (var i = 0; i < 40; i++) {
    var text = create('text');
    setText(text, prefix + '-' + i);
    setProps(text, { style: { height: 20 } });
    insert(list, text, i);
  }
  flush();
  return root;
}

globalThis.tabs = {};
globalThis.mount = function (name) { tabs[name] = mountTab(name); };
globalThis.park = function (name) { setProps(tabs[name], { __navHidden: true }); flush(); };
globalThis.unpark = function (name) { setProps(tabs[name], { __navHidden: false }); flush(); };
globalThis.drop = function (name) { remove(tabs[name]); delete tabs[name]; flush(); };
mount('home');
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
  if (lib == null || !Platform.isMacOS) return;
  ffi.DynamicLibrary.open(lib);

  late FjsEngine engine;

  setUp(() {
    engine = FjsEngine();
    engine.runSource(_program, filename: 'tab-keepalive-test.js');
  });

  tearDown(() => engine.dispose());

  testWidgets('a parked tab page stays mounted, offstage, with its scroll', (
    tester,
  ) async {
    await tester.pumpWidget(MaterialApp(home: FjsView(engine: engine)));
    await tester.pumpAndSettle();
    expect(find.text('home-0'), findsOneWidget);

    await tester.drag(find.text('home-0'), const Offset(0, -200));
    await tester.pumpAndSettle();
    final scrolled = tester.state<ScrollableState>(find.byType(Scrollable));
    final offset = scrolled.position.pixels;
    expect(offset, greaterThan(0));

    // switch tabs: the leaving page is parked, the arriving one mounted
    engine.runSource("park('home'); mount('api');");
    await tester.pumpAndSettle();

    expect(find.text('api-0'), findsOneWidget);
    // parked: not painted, but still in the tree (home-10 is the row the
    // scroll above left at the top of the viewport)
    expect(find.text('home-10'), findsNothing);
    expect(find.text('home-10', skipOffstage: false), findsOneWidget);

    engine.runSource("park('api'); unpark('home');");
    await tester.pumpAndSettle();

    expect(find.text('api-0'), findsNothing);
    expect(find.text('home-10'), findsOneWidget);
    // the same scrollable, still where the drag left it
    final back = tester.state<ScrollableState>(find.byType(Scrollable).first);
    expect(back.position.pixels, offset);
  });

  testWidgets('dropping a parked page leaves the visible one alone', (
    tester,
  ) async {
    await tester.pumpWidget(MaterialApp(home: FjsView(engine: engine)));
    await tester.pumpAndSettle();

    engine.runSource("park('home'); mount('api');");
    await tester.pumpAndSettle();
    engine.runSource("drop('home');");
    await tester.pumpAndSettle();

    expect(find.text('home-0', skipOffstage: false), findsNothing);
    expect(find.text('api-0'), findsOneWidget);
  });
}
