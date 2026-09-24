// A span's own @tap / @click inside a paragraph (specs/128): the run is a
// TextSpan, not a widget, so it needs its own recognizer — vant's
// TextEllipsis "展开" is such a span and did nothing on tap.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show RenderParagraph;
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart' show FjsEvent;
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

  void node(
    int id,
    int parent,
    String tag,
    Map<String, Object?> props, [
    String? text,
  ]) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
    final json = utf8.encode(jsonEncode(props));
    u8(UiOpCode.setProps);
    u32(id);
    u32(json.length);
    raw(json);
    if (text != null) {
      final s = utf8.encode(text);
      u8(UiOpCode.setText);
      u32(id);
      u32(s.length);
      raw(s);
    }
    u8(UiOpCode.insert);
    u32(parent);
    u32(id);
    u32(0x7fffffff);
  }
}

void main() {
  testWidgets('a clickable span in a paragraph dispatches its tap', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 0, 'view', {
        'htmlBlock': true,
        'style': {'width': 300},
      })
      ..node(2, 1, 'text', {}, 'some text ')
      ..node(3, 1, 'text', {'onClick': true}, 'MORE')
      // vant's shape: the clickable span holds its label as a child run
      ..node(4, 1, 'text', {'onClick': true})
      ..node(5, 4, 'text', {}, 'LESS');
    final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
    final log = <(int, int)>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Align(
          alignment: Alignment.topLeft,
          child: FjsNodeRenderer(
            tree: tree,
            ids: tree.rootChildren,
            dispatch: (id, type, {String? text}) => log.add((id, type)),
          ),
        ),
      ),
    );
    expect(find.textContaining('MORE', findRichText: true), findsOneWidget);
    // the span's own glyphs, found through the paragraph's layout
    final paragraph = tester.renderObject<RenderParagraph>(
      find.textContaining('MORE', findRichText: true),
    );
    final start = paragraph.text.toPlainText().indexOf('MORE');
    final glyphs = paragraph.getBoxesForSelection(
      TextSelection(baseOffset: start, extentOffset: start + 4),
    );
    final origin = paragraph.localToGlobal(Offset.zero);
    await tester.tapAt(origin + glyphs.first.toRect().center);
    await tester.pump();
    expect(log, contains((3, FjsEvent.tap)));
  });

  testWidgets('a run inside a clickable span taps the span', (tester) async {
    final w = _W()
      ..node(1, 0, 'view', {
        'htmlBlock': true,
        'style': {'width': 300},
      })
      ..node(2, 1, 'text', {}, 'some text ')
      ..node(4, 1, 'text', {'onClick': true})
      ..node(5, 4, 'text', {}, 'LESS');
    final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
    final log = <(int, int)>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Align(
          alignment: Alignment.topLeft,
          child: FjsNodeRenderer(
            tree: tree,
            ids: tree.rootChildren,
            dispatch: (id, type, {String? text}) => log.add((id, type)),
          ),
        ),
      ),
    );
    final paragraph = tester.renderObject<RenderParagraph>(
      find.textContaining('LESS', findRichText: true),
    );
    final start = paragraph.text.toPlainText().indexOf('LESS');
    final glyphs = paragraph.getBoxesForSelection(
      TextSelection(baseOffset: start, extentOffset: start + 4),
    );
    await tester.tapAt(
      paragraph.localToGlobal(Offset.zero) + glyphs.first.toRect().center,
    );
    await tester.pump();
    expect(log, contains((4, FjsEvent.tap)));
  });
}
