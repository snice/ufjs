// nested-scroll-header / nested-scroll-body (specs/208). A scroll-view whose
// direct children carry the nested tags takes the nested route: headers ride
// out with the scroll, the last one holds an offset-top tail once the
// collapse point passes, and the scroller directly inside the body is
// absorbed — its rows join the SAME scroll, which is the mirror of
// fjs-runtime/test/web-nested-scroll.test.ts.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show RenderBox;
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart' show FjsEvent;
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/control_scope.dart';

class _W {
  final List<int> b = [];
  void u8(int v) => b.add(v & 0xff);
  void u16(int v) => b
    ..add(v & 0xff)
    ..add(v >> 8 & 0xff);
  void u32(int v) {
    final d = ByteData(4)..setUint32(0, v, Endian.little);
    b.addAll(d.buffer.asUint8List());
  }

  void raw(List<int> l) => b.addAll(l);
}

class N {
  N(this.tag, {this.props = const {}, this.text, this.children = const []});

  final String tag;
  final Map<String, Object?> props;
  final String? text;
  final List<N> children;
}

class Built {
  Built(this.tree, this.ids);

  final MirrorTree tree;
  final Map<String, int> ids;
}

Built treeOf(List<N> roots) {
  final w = _W();
  final ids = <String, int>{};
  var next = 1;

  void emit(N node, int parent) {
    final id = next++;
    ids['${node.tag}:${node.props['id'] ?? ids.length}'] = id;
    w.u8(UiOpCode.create);
    w.u32(id);
    final tag = utf8.encode(node.tag);
    w.u16(tag.length);
    w.raw(tag);
    if (node.props.isNotEmpty) {
      w.u8(UiOpCode.setProps);
      w.u32(id);
      final json = utf8.encode(jsonEncode(node.props));
      w.u32(json.length);
      w.raw(json);
    }
    w.u8(UiOpCode.insert);
    w.u32(parent);
    w.u32(id);
    w.u32(0x7fffffff);
    for (final child in node.children) {
      emit(child, id);
    }
  }

  for (final root in roots) {
    emit(root, 0);
  }
  final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
  return Built(tree, ids);
}

typedef Events = List<(int, int, String?)>;

Widget render(MirrorTree tree, Events log) => MaterialApp(
  home: Scaffold(
    body: SizedBox(
      height: 400,
      child: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        dispatch: (id, type, {String? text}) => log.add((id, type, text)),
      ),
    ),
  ),
);

N block(String id, {double height = 100}) => N(
  'view',
  props: {
    'id': id,
    'style': {'height': height, 'background-color': '#eeeeee'},
  },
);

/// A nested scroll page: header (height h) over a body whose scroller holds
/// [rows] rows of 100px. The scroller's height style is the kind of thing a
/// page writes — absorption ignores it.
N nestedPage({
  required String heroText,
  double heroHeight = 300,
  num? offsetTop,
  int rows = 20,
  bool outerOnScroll = true,
}) =>
    N(
      'scroll-view',
      props: {
        'id': 'page',
        'type': 'nested',
        'scrollY': true,
        if (outerOnScroll) 'onScroll': true,
        'style': {'height': 400},
      },
      children: [
        N(
          'nested-scroll-header',
          props: {'id': 'hero'},
          children: [
            N(
              'view',
              props: {
                'id': 'hero-inner',
                'style': {
                  'height': heroHeight,
                  'background-color': '#007aff',
                },
              },
              children: [N('text', text: heroText)],
            ),
            // wx renders the FIRST child only — this must never appear
            N('text', props: {'id': 'hero-extra'}, text: 'second-child'),
          ],
        ),
        N(
          'nested-scroll-body',
          props: {'id': 'body', if (offsetTop != null) 'offsetTop': offsetTop},
          children: [
            // a JS comment anchor mirrors to an empty view — the real
            // first child sits after it (specs/208)
            N('view', props: {'fjsAnchor': true, 'style': {'display': 'none'}}),
            N(
              'scroll-view',
              props: {
                'id': 'inner',
                'scrollY': true,
                'style': {'height': 400},
              },
              children: [
                for (var i = 1; i <= rows; i++)
                  N(
                    'view',
                    props: {
                      'id': 'row-$i',
                      'style': {'height': 100, 'background-color': '#eeeeee'},
                    },
                    children: [N('text', text: 'row $i')],
                  ),
              ],
            ),
          ],
        ),
      ],
    );

void main() {
  setUp(resetFjsWarnOnce);

  double topOf(Built built, String key) {
    final ctx = built.tree.existingGlobalKey(built.ids[key]!)?.currentContext;
    final box = ctx!.findRenderObject() as RenderBox;
    return box.localToGlobal(Offset.zero).dy;
  }

  testWidgets('nested children take the nested route; second child is gone', (
    tester,
  ) async {
    final built = treeOf([nestedPage(heroText: 'hero')]);
    await tester.pumpWidget(render(built.tree, <(int, int, String?)>[]));
    expect(find.byType(CustomScrollView), findsOneWidget);
    // the body's scroller is absorbed: no second Scrollable exists
    expect(find.byType(SingleChildScrollView), findsNothing);
    // the header rendered its first child; the comment anchor and the
    // second child were never mistaken for content
    expect(
      built.tree
          .existingGlobalKey(built.ids['scroll-view:inner']!)
          ?.currentContext,
      isNotNull,
    );
    expect(
      built.tree
          .existingGlobalKey(built.ids['view:hero-inner']!)
          ?.currentContext,
      isNotNull,
    );
    expect(
      built.tree
          .existingGlobalKey(built.ids['text:hero-extra']!)
          ?.currentContext,
      isNull,
    );
  });

  testWidgets('offset-top 0: the header scrolls out completely', (
    tester,
  ) async {
    final built = treeOf([nestedPage(heroText: 'hero')]);
    final log = <(int, int, String?)>[];
    await tester.pumpWidget(render(built.tree, log));

    // header is 300 tall: drag past it and its bottom edge is above the top
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -500));
    await tester.pumpAndSettle();
    expect(topOf(built, 'view:hero-inner') + 300, lessThanOrEqualTo(0.5));
    // rows scrolled with the same single scroll position:
    // row 5 starts at 300 (header) + 400 (rows 1-4); at s = 500 it sits at 200
    expect(topOf(built, 'view:row-5'), closeTo(200, 0.5));
    // the outer scroll-view reports @scroll for the whole thing
    final scrolls = log.where((e) => e.$2 == FjsEvent.scroll).toList();
    expect(scrolls, isNotEmpty);
    expect(scrolls.first.$1, built.ids['scroll-view:page']);
    final payload =
        jsonDecode(scrolls.last.$3!) as Map<String, Object?>;
    expect((payload['scrollTop'] as num).toDouble(), closeTo(500, 1.0));
  });

  testWidgets('offset-top holds the tail; rows slide beneath it', (
    tester,
  ) async {
    final built = treeOf([nestedPage(heroText: 'hero', offsetTop: 88)]);
    await tester.pumpWidget(render(built.tree, <(int, int, String?)>[]));

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -800));
    await tester.pumpAndSettle();
    // past the collapse point (300 - 88 = 212) the header's bottom edge
    // stays at 88 — the pinned tail
    expect(topOf(built, 'view:hero-inner') + 300, closeTo(88, 0.5));
    // s = 800: row 8 starts at 300 + 700 and sits at 200 — rows kept
    // scrolling beneath the held tail
    expect(topOf(built, 'view:row-8'), closeTo(200, 0.5));
  });

  testWidgets('a plain header between runs stays out of the way', (
    tester,
  ) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {'id': 'page', 'type': 'nested', 'scrollY': true},
        children: [
          block('lead', height: 50),
          N(
            'nested-scroll-header',
            props: {'id': 'hero'},
            children: [block('hero-inner', height: 200)],
          ),
          N(
            'nested-scroll-body',
            props: {'id': 'body', 'offsetTop': 60},
            children: [block('row-1', height: 800)],
          ),
        ],
      ),
    ]);
    await tester.pumpWidget(render(built.tree, <(int, int, String?)>[]));
    // at rest the run before the header keeps its place
    expect(topOf(built, 'view:lead'), closeTo(0, 0.5));
    expect(topOf(built, 'view:hero-inner'), closeTo(50, 0.5));
    expect(topOf(built, 'view:row-1'), closeTo(250, 0.5));

    // drag deep: the lead runs off, the header holds a 60px tail, the body
    // row keeps scrolling (s = 400: row top = 250 - 400 = -150 → visible
    // rows fill from 0; the tail occupies 0..60 over it)
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -400));
    await tester.pumpAndSettle();
    expect(topOf(built, 'view:hero-inner') + 200, closeTo(60, 0.5));
  });
}
