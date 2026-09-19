// `height: 100%` inside a flex box, and on an absolutely-positioned child.
//
// Both used to fall back to auto even when the containing box had a perfectly
// definite size, because neither child can read that size from the
// constraints it is handed: Flutter's Flex lays children out with an
// unbounded main axis, and RenderStack lays a positioned child out with
// `BoxConstraints()` unless it was given both edges or an explicit size. The
// parent knows in both cases, so the parent resolves it (render/flex.dart).
//
// The wrong size was not even the worst of it: a child that fell back to auto
// and had a flex of its own inside — a <canvas>, a nested column — tripped
// "RenderFlex children have non-zero flex but incoming height constraints are
// unbounded" and took the page down with a red screen.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

/// Writes the op frame a page would send.
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

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    u16(tag.length);
    b.addAll(utf8.encode(tag));
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

MirrorTree _tree(void Function(_W w) build) {
  final w = _W();
  build(w);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

/// The shape both game pages have: a box with a definite height, a child that
/// asks for all of it with `height: 100%`, and inside that child something
/// with a flex of its own (the canvas surface).
MirrorTree _fillTree({String outer = '"width":200,"height":300'}) => _tree((w) {
  // node 1 is only there to be the root: a ROOT child is expanded by the
  // page-root rule whether or not it asked (see buildFlex's growChildren),
  // which would hide what these tests are about
  w.create(1, 'view');
  w.props(1, '{"style":{}}');
  w.insert(0, 1);
  w.create(2, 'view');
  w.props(2, '{"style":{$outer}}');
  w.insert(1, 2);
  w.create(3, 'view');
  w.props(
    3,
    '{"style":{"width":"100%","height":"100%","backgroundColor":"#eef4ff"}}',
  );
  w.insert(2, 3);
  w.create(4, 'view');
  w.props(4, '{"style":{"flexGrow":1,"backgroundColor":"#dd524d"}}');
  w.insert(3, 4);
});

/// A relative box with a full-cover overlay over its content — the pause mask.
MirrorTree _overlayTree() => _tree((w) {
  w.create(1, 'view');
  w.props(1, '{"style":{}}');
  w.insert(0, 1);
  w.create(2, 'view');
  w.props(2, '{"style":{"width":120,"height":80,"position":"relative"}}');
  w.insert(1, 2);
  w.create(3, 'view');
  w.props(3, '{"style":{"height":20,"backgroundColor":"#eef4ff"}}');
  w.insert(2, 3);
  w.create(4, 'view');
  w.props(
    4,
    '{"style":{"position":"absolute","left":0,"top":0,'
    '"width":"100%","height":"100%","backgroundColor":"#dd524d"}}',
  );
  w.insert(2, 4);
});

Widget _render(
  MirrorTree tree, {
  bool scrollable = false,
  Axis scrollAxis = Axis.vertical,
}) {
  final node = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  );
  return MaterialApp(
    home: Align(
      alignment: Alignment.topLeft,
      // a scroller hands its content an unbounded main axis, which is the
      // one case where a percentage really has nothing to resolve against
      child: scrollable
          ? SingleChildScrollView(scrollDirection: scrollAxis, child: node)
          : node,
    ),
  );
}

Rect _colored(WidgetTester tester, Color color) => tester.getRect(
  find.byWidgetPredicate(
    (w) => w is Container && (w.decoration as BoxDecoration?)?.color == color,
  ),
);

void main() {
  testWidgets('height: 100% fills a column with a definite height', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_fillTree()));
    expect(tester.takeException(), isNull);
    expect(
      _colored(tester, const Color(0xFFEEF4FF)).size,
      const Size(200, 300),
    );
    // and the flex inside it got a bounded box to expand into
    expect(
      _colored(tester, const Color(0xFFDD524D)).size,
      const Size(200, 300),
    );
  });

  testWidgets('calc() on the main axis resolves against the same box', (
    tester,
  ) async {
    await tester.pumpWidget(
      _render(
        _tree((w) {
          w.create(1, 'view');
          w.props(1, '{"style":{}}');
          w.insert(0, 1);
          w.create(2, 'view');
          w.props(2, '{"style":{"width":200,"height":300}}');
          w.insert(1, 2);
          w.create(3, 'view');
          w.props(
            3,
            '{"style":{"height":"calc(100% - 60px)","backgroundColor":"#eef4ff"}}',
          );
          w.insert(2, 3);
        }),
      ),
    );
    expect(_colored(tester, const Color(0xFFEEF4FF)).height, 240);
  });

  testWidgets('inside a scroller it still falls back to auto, as in CSS', (
    tester,
  ) async {
    // No definite height to be a fraction of. The box takes its content's
    // height instead of throwing — and the flex inside must not assert.
    await tester.pumpWidget(
      _render(_fillTree(outer: '"width":200'), scrollable: true),
    );
    expect(
      tester.takeException(),
      isNull,
      reason: 'a flex child in a shrink-wrapping column must not assert',
    );
    expect(_colored(tester, const Color(0xFFEEF4FF)).height, 0);
  });

  testWidgets('an absolute child covers the box it is positioned in', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_overlayTree()));
    final box = tester.getRect(find.byType(Stack).first);
    expect(box.size, const Size(120, 80));
    expect(_colored(tester, const Color(0xFFDD524D)), box);
  });
  // ---- spec 044: % margin/padding in flex -------------------------------

  /// A row of a definite width with one child that spaces itself in `%`.
  MirrorTree _rowSpacingTree(String rowWidth, String childMargin) => _tree((w) {
    w.create(1, 'view');
    w.props(1, '{"style":{}}');
    w.insert(0, 1);
    w.create(2, 'view');
    w.props(2, '{"style":{"width":$rowWidth}}');
    w.insert(1, 2);
    w.create(3, 'view');
    w.props(
      3,
      '{"style":{"margin":"$childMargin","height":20,'
      '"backgroundColor":"#dd524d"}}',
    );
    w.insert(2, 3);
  });

  testWidgets('a row child with % margin follows the container width', (
    tester,
  ) async {
    // CSS: % margin measures the containing block WIDTH on every side, and
    // the row's main axis is unbounded for the child — _flexChild hands the
    // container's width down so the resolver has something to read.
    await tester.pumpWidget(_render(_rowSpacingTree('200', '0 5%')));
    expect(_colored(tester, const Color(0xFFDD524D)).left, 10);

    await tester.pumpWidget(_render(_rowSpacingTree('400', '0 5%')));
    expect(_colored(tester, const Color(0xFFDD524D)).left, 20);
  });

  testWidgets(
    'a column child with % padding measures the width, not the height',
    (tester) async {
      // CSS box model: vertical padding percentages ALSO reference the width.
      await tester.pumpWidget(
        _render(
          _tree((w) {
            w.create(1, 'view');
            w.props(1, '{"style":{}}');
            w.insert(0, 1);
            w.create(2, 'view');
            w.props(2, '{"style":{"width":200,"height":300}}');
            w.insert(1, 2);
            w.create(3, 'view');
            w.props(
              3,
              '{"style":{"padding":"10%","backgroundColor":"#dd524d"}}',
            );
            w.insert(2, 3);
            w.create(4, 'view');
            w.props(
              4,
              '{"style":{"width":20,"height":20,'
              '"backgroundColor":"#eef4ff"}}',
            );
            w.insert(3, 4);
          }),
        ),
      );
      // the red box is the padding area: its content starts 20px in — 10% of
      // the 200px width — on both axes
      expect(
        _colored(tester, const Color(0xFFEEF4FF)).left,
        _colored(tester, const Color(0xFFDD524D)).left + 20,
      );
      expect(
        _colored(tester, const Color(0xFFEEF4FF)).top,
        _colored(tester, const Color(0xFFDD524D)).top + 20,
      );
    },
  );

  testWidgets(
    'an unbounded width (horizontal scroller) resolves % padding to 0',
    (tester) async {
      // a VERTICAL scroller bounds the width — % padding resolves normally
      // there, exactly as in a browser. The genuinely indefinite case is the
      // horizontal axis: no box to be a fraction of, so the side is 0 rather
      // than throwing or being treated as a pixel value
      await tester.pumpWidget(
        _render(
          _tree((w) {
            w.create(1, 'view');
            w.props(1, '{"style":{}}');
            w.insert(0, 1);
            w.create(2, 'view');
            w.props(
              2,
              '{"style":{"padding":"10%","backgroundColor":"#dd524d"}}',
            );
            w.insert(1, 2);
            w.create(3, 'view');
            w.props(
              3,
              '{"style":{"width":20,"height":20,'
              '"backgroundColor":"#eef4ff"}}',
            );
            w.insert(2, 3);
          }),
          scrollable: true,
          scrollAxis: Axis.horizontal,
        ),
      );
      expect(
        _colored(tester, const Color(0xFFEEF4FF)).left,
        _colored(tester, const Color(0xFFDD524D)).left,
      );
    },
  );

  testWidgets('a vertical scroller bounds the width, so % padding resolves', (
    tester,
  ) async {
    await tester.pumpWidget(
      _render(
        _tree((w) {
          w.create(1, 'view');
          w.props(1, '{"style":{}}');
          w.insert(0, 1);
          w.create(2, 'view');
          w.props(2, '{"style":{"padding":"10%","backgroundColor":"#dd524d"}}');
          w.insert(1, 2);
          w.create(3, 'view');
          w.props(
            3,
            '{"style":{"width":20,"height":20,'
            '"backgroundColor":"#eef4ff"}}',
          );
          w.insert(2, 3);
        }),
        scrollable: true,
      ),
    );
    // 10% of the test viewport's 800px width
    expect(
      _colored(tester, const Color(0xFFEEF4FF)).left,
      _colored(tester, const Color(0xFFDD524D)).left + 80,
    );
  });
}
