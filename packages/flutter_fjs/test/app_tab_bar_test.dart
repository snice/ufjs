// End-to-end test of specs/210's Dart half: the global tab bar is a
// dedicated `fjs-tab-bar-host` root the BASE view floats at the bottom of a
// Stack over the page area (the TabGroup). It must take NO page height (the
// page keeps its full size and scrolls under the bar), be covered whole by
// a pushed route, and vanish without a trace when the JS side hides it
// (display:none → the renderer's SizedBox.shrink). The JS side is
// hand-written against the raw op protocol, as in app_overlay_host_test.dart.
import 'dart:ffi' as ffi;
import 'dart:io';

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

// the tab bar host root + an inner surface the JS side can hide
var barRoot, surface;
globalThis.mountBar = function () {
  barRoot = create('fjs-tab-bar-host');
  insert(0, barRoot, 1);
  setProps(barRoot, { __tabBar: true });
  surface = create('view');
  setProps(surface, { style: { height: 60 } });
  insert(barRoot, surface, 0);
  var barText = create('text');
  setText(barText, 'tab-bar');
  insert(surface, barText, 0);
  flush();
};
globalThis.hideBar = function () {
  setProps(surface, { style: { height: 60, display: 'none' } });
  flush();
};
globalThis.showBar = function () {
  setProps(surface, { style: { height: 60 } });
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
    engine.runSource(_jsProgram, filename: 'app-tab-bar-test.js');
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

  testWidgets('the bar floats at the bottom and takes no page height', (
    tester,
  ) async {
    await pumpApp(tester);
    final homeTopBefore = tester.getTopLeft(find.text('home')).dy;

    engine.runSource('mountBar();');
    await tester.pumpAndSettle();

    expect(find.text('tab-bar'), findsOneWidget);
    expect(find.text('home'), findsOneWidget);
    // the bar sits over the page content's lower edge, not beside it: the
    // page keeps its full height (its content did not move up) and the bar
    // paints at the bottom of the view
    expect(
      tester.getTopLeft(find.text('home')).dy,
      homeTopBefore,
    );
    final view = tester.viewOf(find.text('tab-bar'));
    final viewHeight = view.physicalSize.height / view.devicePixelRatio;
    final barBottom = tester.getBottomRight(find.text('tab-bar')).dy;
    expect(viewHeight - barBottom < 120, isTrue);
  });

  testWidgets('a pushed route covers the whole group, bar included', (
    tester,
  ) async {
    await pumpApp(tester);
    engine.runSource('mountBar();');
    await tester.pumpAndSettle();
    engine.runSource('push(1);');
    await tester.pumpAndSettle();

    expect(find.text('page-1'), findsOneWidget);
    // the bar stays mounted under the pushed route (the group is the base
    // page) but takes no touches: an opaque route puts the covered one
    // offstage, and offstage subtrees are not hit-tested
    expect(find.text('tab-bar', skipOffstage: false), findsOneWidget);
    final result = HitTestResult();
    tester.binding.hitTestInView(
      result,
      tester.getCenter(find.text('tab-bar', skipOffstage: false)),
      tester.viewOf(find.text('tab-bar', skipOffstage: false)).viewId,
    );
    expect(
      result.path
          .map((entry) => entry.target)
          .contains(tester.renderObject<RenderParagraph>(
            find.text('tab-bar', skipOffstage: false),
          )),
      isFalse,
    );

    engine.runSource('popTop();');
    await tester.pumpAndSettle();
    expect(find.text('home'), findsOneWidget);
    expect(find.text('tab-bar'), findsOneWidget);
  });

  testWidgets('hiding the bar collapses its slot', (tester) async {
    await pumpApp(tester);
    engine.runSource('mountBar();');
    await tester.pumpAndSettle();

    engine.runSource('hideBar();');
    await tester.pumpAndSettle();
    // display:none renders SizedBox.shrink: no text, no reserved height
    expect(find.text('tab-bar'), findsNothing);

    engine.runSource('showBar();');
    await tester.pumpAndSettle();
    expect(find.text('tab-bar'), findsOneWidget);
  });
}
