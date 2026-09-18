// `modal`'s contract, written BEFORE its content stopped being a snapshot
// (specs/008-picker/plan.md §3.2). The first four cases are the behaviour
// that already shipped — they are here to catch a regression while the
// sheet's content changes from a prebuilt widget list to a live subtree.
// The last one is the new behaviour picker needs: a linked column has to be
// replaceable while the sheet is open.
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

  void raw(List<int> l) => b.addAll(l);
}

/// Ops the JS writer would send. Kept explicit (rather than a tree builder)
/// so a test can send a SECOND frame that edits the open sheet.
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

const int modalClosed = 7;

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

/// A modal holding one text child, closed.
(MirrorTree, Events) openable({int rows = 1}) {
  final ops = _Ops()
    ..create(1, 'modal')
    ..props(1, {'visible': false, 'onModalClosed': true})
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

void setVisible(MirrorTree tree, bool visible) {
  final ops = _Ops()..props(1, {'visible': visible, 'onModalClosed': true});
  tree.applyFrame(ops.take());
  tree.flushDirty();
}

void main() {
  testWidgets('visible drives the sheet open and closed', (tester) async {
    final (tree, log) = openable();
    await tester.pumpWidget(render(tree, log));
    expect(find.text('row 0'), findsNothing);

    setVisible(tree, true);
    await tester.pumpAndSettle();
    expect(find.text('row 0'), findsOneWidget);

    setVisible(tree, false);
    await tester.pumpAndSettle();
    expect(find.text('row 0'), findsNothing);
  });

  testWidgets('a native dismissal reports modalClosed once', (tester) async {
    final (tree, log) = openable();
    await tester.pumpWidget(render(tree, log));
    setVisible(tree, true);
    await tester.pumpAndSettle();

    // barrier tap — the sheet's own dismissal path, not a JS-driven close
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    expect(log, [(modalClosed, null)]);
  });

  testWidgets('a JS-driven close reports nothing', (tester) async {
    // Deliberate asymmetry: JS asked for the close, so JS already knows.
    // Only a dismissal the user performed needs reporting back.
    final (tree, log) = openable();
    await tester.pumpWidget(render(tree, log));
    setVisible(tree, true);
    await tester.pumpAndSettle();

    setVisible(tree, false);
    await tester.pumpAndSettle();
    expect(log, isEmpty);

    // and no late event once the route finishes tearing down
    await tester.pump(const Duration(seconds: 1));
    expect(log, isEmpty);
  });

  testWidgets('content added while open shows up in the open sheet', (
    tester,
  ) async {
    // The reason the snapshot had to go: <picker>'s linked columns are
    // replaced while the sheet is up (specs/008-picker/plan.md §3.2).
    final (tree, log) = openable();
    await tester.pumpWidget(render(tree, log));
    setVisible(tree, true);
    await tester.pumpAndSettle();
    expect(find.text('row 1'), findsNothing);

    tree.applyFrame(
      (_Ops()
            ..create(11, 'text')
            ..text(11, 'row 1')
            ..insert(1, 11))
          .take(),
    );
    tree.flushDirty();
    await tester.pumpAndSettle();
    expect(find.text('row 1'), findsOneWidget);
  });

  testWidgets('content removed while open disappears from the open sheet', (
    tester,
  ) async {
    final (tree, log) = openable(rows: 2);
    await tester.pumpWidget(render(tree, log));
    setVisible(tree, true);
    await tester.pumpAndSettle();
    expect(find.text('row 1'), findsOneWidget);

    tree.applyFrame((_Ops()..remove(11)).take());
    tree.flushDirty();
    await tester.pumpAndSettle();
    expect(find.text('row 1'), findsNothing);
    expect(find.text('row 0'), findsOneWidget);
  });

  testWidgets('content taller than the sheet scrolls instead of overflowing', (
    tester,
  ) async {
    final (tree, log) = openable(rows: 40);
    await tester.pumpWidget(render(tree, log));
    setVisible(tree, true);
    await tester.pumpAndSettle();

    expect(find.text('row 0'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.drag(find.text('row 0'), const Offset(0, -200));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
