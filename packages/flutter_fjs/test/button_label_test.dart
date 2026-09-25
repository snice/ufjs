// A `button` renders the text of its whole subtree as ONE label on itself
// (widgets/button.dart `_buttonLabel`) instead of building the inner
// wrappers as widgets — van-button is
// `button > div.content(htmlBlock) > span.text > label`. The dirty marking
// (mirror_tree.dart) must reach the button for that label to refresh: the
// inner paragraph roots' views are never mounted, so their signals land
// nowhere. specs/132: a reactive `{{ }}` inside the button left the old
// label on screen until the next press rebuilt it.
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

  void bytes(List<int> l) {
    u32(l.length);
    b.addAll(l);
  }
}

void _create(_W w, int id, String tag, int parent, {Map? props, String? text}) {
  w.u8(UiOpCode.create);
  w.u32(id);
  final t = utf8.encode(tag);
  w.u16(t.length);
  w.b.addAll(t);
  if (text != null) {
    w.u8(UiOpCode.setText);
    w.u32(id);
    w.bytes(utf8.encode(text));
  }
  if (props != null) {
    w.u8(UiOpCode.setProps);
    w.u32(id);
    w.bytes(utf8.encode(jsonEncode(props)));
  }
  w.u8(UiOpCode.insert);
  w.u32(parent);
  w.u32(id);
  w.u32(0x7fffffff);
}

/// root > button > div.content(htmlBlock) > span.text > `label` — the
/// element structure a `{{ }}`-labelled van-button mirrors on the app.
MirrorTree _vanButton(String label) {
  final w = _W();
  _create(w, 1, 'view', 0);
  _create(w, 2, 'button', 1);
  _create(w, 3, 'view', 2, props: {'htmlBlock': true});
  _create(w, 4, 'text', 3);
  _create(w, 5, 'text', 4, text: label);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b))..flushDirty();
}

/// root > row > text — no button above; the button walk must mark nothing.
MirrorTree _plainRow() {
  final w = _W();
  _create(w, 1, 'view', 0);
  _create(w, 2, 'view', 1);
  _create(w, 3, 'text', 2, text: 'row');
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b))..flushDirty();
}

Widget _render(MirrorTree tree) => MaterialApp(
  home: Center(
    child: FjsNodeRenderer(
      tree: tree,
      ids: tree.rootChildren,
      dispatch: (_, __, {String? text}) {},
    ),
  ),
);

/// Applies a setText the way the engine does: mutate, then release the
/// per-node signals in one go, then rebuild.
Future<List<int>> apply(
  WidgetTester tester,
  MirrorTree tree,
  int id,
  String text,
) async {
  final w = _W();
  w.u8(UiOpCode.setText);
  w.u32(id);
  w.bytes(utf8.encode(text));
  tree.applyFrame(Uint8List.fromList(w.b));
  final dirty = tree.flushDirty();
  await tester.pump();
  return dirty;
}

void main() {
  testWidgets('a text change inside the button subtree refreshes the label', (
    tester,
  ) async {
    final tree = _vanButton('top');
    await tester.pumpWidget(_render(tree));
    expect(find.text('top'), findsOneWidget);

    final dirty = await apply(tester, tree, 5, 'bottom');

    expect(find.text('bottom'), findsOneWidget);
    expect(find.text('top'), findsNothing);
    // the button itself must be among the signalled ids: its view is the
    // only one mounted for the label fast path
    expect(dirty, contains(2));
  });

  testWidgets('a text change outside any button marks nothing above its row', (
    tester,
  ) async {
    final tree = _plainRow();
    await tester.pumpWidget(_render(tree));
    expect(find.text('row'), findsOneWidget);

    final dirty = await apply(tester, tree, 3, 'changed');

    expect(find.text('changed'), findsOneWidget);
    // the leaf and its row; the root (and any button walk) stay out
    expect(dirty, everyElement(anyOf(3, 2)));
  });
}
