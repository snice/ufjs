// The page root fills its route, and so does the shell inside it.
//
// The shell every app has is `safe-area > view(flex-grow) > [nav, body
// (flex-grow), tabBar]`, and nothing in that chain asks the *root* for
// space — `safe-area` never says flex-grow. A plain column root therefore
// hands it an unbounded height, the body's flex-grow has nothing to
// resolve against, and the page comes up blank. The web build has the same
// problem and solves it in the stylesheet (`fjs-page-entry > * { flex: 1 1
// 0% }`); this is that rule on the Dart side.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

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

  void props(int id, String json) {
    u8(UiOpCode.setProps);
    u32(id);
    final bytes = utf8.encode(json);
    u32(bytes.length);
    b.addAll(bytes);
  }

  void insert(int parent, int child) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(0x7fffffff);
  }
}

/// examples/hello-fjs's Shell.vue: the router's root element, a safe-area
/// that never asks to grow, and the shell whose middle area does.
MirrorTree _shellTree() {
  final w = _W();
  w.create(1, 'view'); // what flutterRoot() makes
  w.props(1, '{"__navKey":0}');
  w.insert(0, 1);
  w.create(2, 'safe-area');
  w.insert(1, 2);
  w.create(3, 'view'); // .shell { flex-grow: 1 }
  w.props(3, '{"style":{"flexGrow":1,"backgroundColor":"#f4f5f7"}}');
  w.insert(2, 3);
  w.create(4, 'view'); // nav bar
  w.props(4, '{"style":{"height":44}}');
  w.insert(3, 4);
  w.create(5, 'scroll-view'); // .body { flex-grow: 1 }
  w.props(5, '{"style":{"flexGrow":1}}');
  w.insert(3, 5);
  w.create(6, 'view'); // tab bar
  w.props(6, '{"style":{"height":52}}');
  w.insert(3, 6);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

/// A navbar's `safe-area edges="top"` over a bottom `edges="bottom"` strip,
/// with both insets on screen.
MirrorTree _edgesTree() {
  final w = _W();
  w.create(1, 'view');
  w.props(1, '{"__navKey":0}');
  w.insert(0, 1);
  w.create(2, 'safe-area');
  w.props(2, '{"edges":"top"}');
  w.insert(1, 2);
  w.create(3, 'view');
  w.props(3, '{"style":{"height":44}}');
  w.insert(2, 3);
  w.create(4, 'safe-area');
  w.props(4, '{"edges":"bottom"}');
  w.insert(1, 4);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

void main() {
  testWidgets('safe-area edges picks the insets it takes', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(390, 844),
            padding: EdgeInsets.only(top: 47, bottom: 34, left: 5, right: 5),
          ),
          child: Material(
            child: FjsNodeRenderer(
              tree: _edgesTree(),
              ids: [1],
              dispatch: (_, __, {String? text}) {},
            ),
          ),
        ),
      ),
    );
    final areas = tester.widgetList<SafeArea>(find.byType(SafeArea)).toList();
    expect(areas, hasLength(2));
    expect(
      [areas[0].top, areas[0].bottom, areas[0].left, areas[0].right],
      [true, false, false, false],
    );
    expect(
      [areas[1].top, areas[1].bottom, areas[1].left, areas[1].right],
      [false, true, false, false],
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the shell fills the page, top bar and tab bar pinned', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Material(
          child: FjsNodeRenderer(
            tree: _shellTree(),
            ids: [1],
            dispatch: (_, __, {String? text}) {},
          ),
        ),
      ),
    );

    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    final shell = tester.getRect(find.byType(Container).first);
    expect(shell.size, screen);
    // the scrollable body takes what the two bars leave
    final body = tester.getRect(find.byType(SingleChildScrollView));
    expect(body.height, screen.height - 44 - 52);
    expect(tester.takeException(), isNull);
  });
}
