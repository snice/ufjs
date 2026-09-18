// A `text` nested in a `text` is a span of one paragraph (specs/034-rich-text
// §3.5). The web twin is base-css.ts's `text text { display: inline }`; the
// JS side that builds such trees is covered by fjs-runtime's rich-text tests.
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

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
  }

  void setText(int id, String text) {
    u8(UiOpCode.setText);
    u32(id);
    final t = utf8.encode(text);
    u32(t.length);
    raw(t);
  }

  void setProps(int id, String json) {
    u8(UiOpCode.setProps);
    u32(id);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void defineStyle(int styleId, String json) {
    u8(UiOpCode.defineStyle);
    u32(styleId);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void setStyle(int id, int styleId) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(styleId);
    u32(0);
  }

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }

  Uint8List get frame => Uint8List.fromList(b);
}

Widget _render(MirrorTree tree) => Directionality(
  textDirection: TextDirection.ltr,
  child: FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  ),
);

Future<MirrorTree> _mount(WidgetTester tester, _W w) async {
  final tree = MirrorTree()
    ..applyFrame(w.frame)
    ..flushDirty();
  await tester.pumpWidget(_render(tree));
  return tree;
}

Future<void> _apply(WidgetTester tester, MirrorTree tree, _W w) async {
  tree.applyFrame(w.frame);
  tree.flushDirty();
  await tester.pump();
}

/// The paragraph's own span: Text.rich wraps it in one more TextSpan that
/// carries the DefaultTextStyle.
TextSpan _paragraph(WidgetTester tester) {
  final rich = tester.widget<RichText>(find.byType(RichText).first);
  return (rich.text as TextSpan).children!.single as TextSpan;
}

/// view(1) > text(2) [ "满 "(3), text(4, bold red) [ "199"(5) ], " 减 30"(6) ]
_W _sentence() => _W()
  ..defineStyle(1, '{"color":"#333333","fontSize":14}')
  ..defineStyle(2, '{"color":"#fa5151","fontSize":14,"fontWeight":"bold"}')
  ..create(1, 'view')
  ..insert(0, 1, 0)
  ..create(2, 'text')
  ..setStyle(2, 1)
  ..insert(1, 2, 0)
  ..create(3, 'text')
  ..setText(3, '满 ')
  ..insert(2, 3, 0)
  ..create(4, 'text')
  ..setStyle(4, 2)
  ..insert(2, 4, 1)
  ..create(5, 'text')
  ..setText(5, '199')
  ..insert(4, 5, 0)
  ..create(6, 'text')
  ..setText(6, ' 减 30')
  ..insert(2, 6, 2);

void main() {
  testWidgets('text with text children is ONE paragraph of spans', (
    tester,
  ) async {
    await _mount(tester, _sentence());

    expect(find.byType(RichText), findsOneWidget);
    final paragraph = _paragraph(tester);
    expect(paragraph.toPlainText(), '满 199 减 30');

    final spans = paragraph.children!.cast<TextSpan>();
    expect(spans, hasLength(3));
    final bold = spans[1];
    expect(bold.style!.fontWeight, FontWeight.bold);
    expect(bold.style!.color, const Color(0xFFFA5151));
    // the bare run inside it has no style of its own and inherits the span's
    // instead of falling back to the grey default
    expect((bold.children!.single as TextSpan).style, isNull);
    expect(spans[0].style?.fontWeight, isNot(FontWeight.bold));
  });

  testWidgets('element text with no child nodes stays a plain Text', (
    tester,
  ) async {
    await _mount(
      tester,
      _W()
        ..create(1, 'text')
        ..setText(1, 'hello')
        ..insert(0, 1, 0),
    );
    final text = tester.widget<Text>(find.byType(Text));
    expect(text.data, 'hello');
    expect(text.textSpan, isNull);
  });

  testWidgets('a non-text child is an inline WidgetSpan on the baseline', (
    tester,
  ) async {
    final w = _sentence()
      ..defineStyle(3, '{"width":12,"height":12,"backgroundColor":"#07c160"}')
      ..create(7, 'view')
      ..setStyle(7, 3)
      ..insert(2, 7, 1);
    await _mount(tester, w);

    final kids = _paragraph(tester).children!;
    expect(kids, hasLength(4));
    final box = kids[1] as WidgetSpan;
    expect(box.alignment, PlaceholderAlignment.baseline);
    expect(box.baseline, TextBaseline.alphabetic);
    // it is still a regular node view, so it keeps its own decoration
    expect(find.byType(RichText), findsOneWidget);
  });

  testWidgets('sub / super are shifted small paragraphs', (tester) async {
    final w = _W()
      ..defineStyle(1, '{"fontSize":14}')
      ..defineStyle(2, '{"fontSize":11.62,"verticalAlign":"super"}')
      ..defineStyle(3, '{"fontSize":11.62,"verticalAlign":"sub"}')
      ..create(1, 'text')
      ..setStyle(1, 1)
      ..insert(0, 1, 0)
      ..create(2, 'text')
      ..setText(2, 'mc')
      ..insert(1, 2, 0)
      ..create(3, 'text')
      ..setStyle(3, 2)
      ..setText(3, '2')
      ..insert(1, 3, 1)
      ..create(4, 'text')
      ..setStyle(4, 3)
      ..setText(4, 'x')
      ..insert(1, 4, 2);
    await _mount(tester, w);

    final kids = _paragraph(tester).children!;
    expect(kids[0], isA<TextSpan>());
    expect(kids[1], isA<WidgetSpan>());
    expect(kids[2], isA<WidgetSpan>());
    final shifts = tester
        .widgetList<Transform>(find.byType(Transform))
        .map((t) => t.transform.getTranslation().y)
        .toList();
    // up by a third of the parent size, down by a fifth
    expect(shifts, [closeTo(-14 / 3, 0.01), closeTo(14 / 5, 0.01)]);
  });

  testWidgets('editing a span two levels down refreshes the paragraph', (
    tester,
  ) async {
    final tree = await _mount(tester, _sentence());
    expect(_paragraph(tester).toPlainText(), '满 199 减 30');

    // node 5 sits inside span 4 inside paragraph 2: before the dirty walk
    // only 5 and 4 were marked, and the paragraph kept the old words
    await _apply(tester, tree, _W()..setText(5, '299'));
    expect(_paragraph(tester).toPlainText(), '满 299 减 30');

    await _apply(
      tester,
      tree,
      _W()
        ..defineStyle(9, '{"color":"#07c160","fontSize":14}')
        ..setStyle(4, 9),
    );
    final span = _paragraph(tester).children![1] as TextSpan;
    expect(span.style!.color, const Color(0xFF07C160));

    await _apply(
      tester,
      tree,
      _W()
        ..create(8, 'text')
        ..setText(8, '!')
        ..insert(4, 8, 1),
    );
    expect(_paragraph(tester).toPlainText(), '满 299! 减 30');
  });

  // specs/035: rich-text sends a paragraph as ONE text node whose runs are
  // the internal `richSpans` prop (fjs-runtime/src/rich-text/spans.ts).

  testWidgets('richSpans: one text node is one paragraph of runs', (
    tester,
  ) async {
    await _mount(
      tester,
      _W()
        ..defineStyle(1, '{"color":"#666666","fontSize":16}')
        ..create(1, 'text')
        ..setStyle(1, 1)
        ..setProps(
          1,
          '{"richSpans":["满 ",{"t":"199","s":{"fontWeight":"bold","color":"#FA5151"}},'
          '{"t":"划","s":{"textDecoration":"underline line-through"}}," 减 30"]}',
        )
        ..insert(0, 1, 0),
    );

    expect(find.byType(RichText), findsOneWidget);
    final paragraph = _paragraph(tester);
    expect(paragraph.toPlainText(), '满 199划 减 30');
    expect(paragraph.style!.color, const Color(0xFF666666));
    expect(paragraph.style!.fontSize, 16);

    final runs = paragraph.children!.cast<TextSpan>();
    expect(runs, hasLength(4));
    expect(runs[0].style, isNull);
    expect(runs[1].style!.fontWeight, FontWeight.bold);
    expect(runs[1].style!.color, const Color(0xFFFA5151));
    // unset fields stay null and inherit the paragraph's 16px, rather than
    // being pinned to the 14px / #333333 node defaults
    expect(runs[1].style!.fontSize, isNull);
    expect(runs[2].style!.color, isNull);
    expect(
      runs[2].style!.decoration,
      TextDecoration.combine([
        TextDecoration.underline,
        TextDecoration.lineThrough,
      ]),
    );
  });

  testWidgets('richSpans: sub / super shift and keep the paragraph style', (
    tester,
  ) async {
    await _mount(
      tester,
      _W()
        ..defineStyle(1, '{"color":"#FA5151","fontSize":14}')
        ..create(1, 'text')
        ..setStyle(1, 1)
        ..setProps(
          1,
          '{"richSpans":["mc",{"t":"2","s":{"fontSize":11.62,"verticalAlign":"super"}}]}',
        )
        ..insert(0, 1, 0),
    );

    final kids = _paragraph(tester).children!;
    expect(kids[0], isA<TextSpan>());
    expect(kids[1], isA<WidgetSpan>());
    final shift = tester
        .widget<Transform>(find.byType(Transform))
        .transform
        .getTranslation()
        .y;
    expect(shift, closeTo(-14 / 3, 0.01));
    // a WidgetSpan does not inherit the outer TextSpan's style, so the run is
    // wrapped in the paragraph's: still red, at its own smaller size
    final inner =
        tester.widgetList<RichText>(find.byType(RichText)).last.text
            as TextSpan;
    final wrapped = inner.children!.single as TextSpan;
    expect(wrapped.style!.color, const Color(0xFFFA5151));
    expect((wrapped.children!.single as TextSpan).style!.fontSize, 11.62);
  });

  testWidgets('richSpans: a malformed run is skipped, not thrown', (
    tester,
  ) async {
    await _mount(
      tester,
      _W()
        ..create(1, 'text')
        ..setProps(1, '{"richSpans":[1,{"t":"ok","s":{}},{"t":2},null]}')
        ..insert(0, 1, 0),
    );
    expect(tester.takeException(), isNull);
    expect(_paragraph(tester).toPlainText(), 'ok');
  });

  testWidgets('richSpans: a new prop repaints the paragraph', (tester) async {
    final tree = await _mount(
      tester,
      _W()
        ..create(1, 'text')
        ..setProps(1, '{"richSpans":["a",{"t":"b","s":{"fontWeight":"bold"}}]}')
        ..insert(0, 1, 0),
    );
    expect(_paragraph(tester).toPlainText(), 'ab');
    await _apply(tester, tree, _W()..setProps(1, '{"richSpans":["c"]}'));
    expect(_paragraph(tester).toPlainText(), 'c');
  });
}
