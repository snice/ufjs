// specs/191: paragraphs share their laid-out painter (render/paragraph.dart).
// A colour change is paint-only for RenderParagraph, but the shared painter
// is only swapped at layout — the hello-fjs mode tabs kept painting their
// old colour (white on white) after a VDOM → Vapor switch.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/paragraph.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

class _W {
  final List<int> b = [];
  void u32(int v) => b.addAll((ByteData(4)..setUint32(0, v, Endian.little)).buffer.asUint8List());
  void s32(String s) {
    final x = utf8.encode(s);
    u32(x.length);
    b.addAll(x);
  }

  void create(int id, String tag) {
    final t = utf8.encode(tag);
    b.add(UiOpCode.create);
    u32(id);
    b
      ..add(t.length)
      ..add(0)
      ..addAll(t);
  }

  void props(int id, String json) {
    b.add(UiOpCode.setProps);
    u32(id);
    s32(json);
  }

  void text(int id, String t) {
    b.add(UiOpCode.setText);
    u32(id);
    s32(t);
  }

  void insert(int p, int c) {
    b.add(UiOpCode.insert);
    u32(p);
    u32(c);
    u32(0x7fffffff);
  }

  Uint8List get frame => Uint8List.fromList(b);
}

Color? _painted(WidgetTester tester, String label) {
  final ro = tester.renderObject<RenderFjsParagraph>(
    find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText() == label),
  );
  return (ro.debugPaintedSpan! as TextSpan).style?.color;
}

void main() {
  testWidgets('a colour-only change repaints with the new colour', (tester) async {
    final tree = MirrorTree()
      ..applyFrame(
        (_W()
              ..create(1, 'text')
              ..props(1, '{"style":{"color":"#ffffff"}}')
              ..text(1, 'VDOM')
              ..insert(0, 1))
            .frame,
      )
      ..flushDirty();
    await tester.pumpWidget(
      MaterialApp(
        home: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, dispatch: (_, __, {String? text}) {}),
      ),
    );
    expect(_painted(tester, 'VDOM'), const Color(0xFFFFFFFF));

    tree
      ..applyFrame((_W()..props(1, '{"style":{"color":"#1677ff"}}')).frame)
      ..flushDirty();
    await tester.pump();
    expect(_painted(tester, 'VDOM'), const Color(0xFF1677FF));
  });

  testWidgets('equal paragraphs paint one shared painter', (tester) async {
    final w = _W()..create(1, 'view')..insert(0, 1);
    for (var id = 2; id < 6; id++) {
      w
        ..create(id, 'text')
        ..text(id, 'same')
        ..insert(1, id);
    }
    final tree = MirrorTree()
      ..applyFrame(w.frame)
      ..flushDirty();
    await tester.pumpWidget(
      MaterialApp(
        home: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, dispatch: (_, __, {String? text}) {}),
      ),
    );
    final spans = tester
        .renderObjectList<RenderFjsParagraph>(
          find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText() == 'same'),
        )
        .map((r) => r.debugPaintedSpan)
        .toList();
    expect(spans, hasLength(4));
    expect(spans.every((s) => identical(s, spans.first)), isTrue);
  });
}
