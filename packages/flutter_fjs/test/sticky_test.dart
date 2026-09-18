// sticky-header / sticky-section (specs/052). A scroll-view whose direct
// children carry the sticky tags takes the sliver route: headers pin,
// sections bound them, and @stickontopchange fires on the pin-state flip —
// the mirror of fjs-runtime/test/web-sticky.test.ts, which drives the same
// three moments through the web substrate.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
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
    ..add((v >> 8) & 0xff);
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

N header(String id) => N(
  'sticky-header',
  props: {'id': id, 'onStickontopchange': true},
  children: [
    N(
      'view',
      props: {
        'style': {'height': 40, 'background-color': '#007aff'},
      },
      children: [N('text', text: id)],
    ),
  ],
);

void main() {
  setUp(resetFjsWarnOnce);

  testWidgets('sticky children take the sliver route', (tester) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {'scrollY': true},
        children: [block('lead'), header('h1'), block('a'), block('b')],
      ),
    ]);
    await tester.pumpWidget(render(built.tree, <(int, int, String?)>[]));
    expect(find.byType(CustomScrollView), findsOneWidget);
    expect(find.byType(SingleChildScrollView), findsNothing);
  });

  testWidgets('a direct header pins and reports the flip; open is silent', (
    tester,
  ) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {'scrollY': true},
        children: [
          block('lead', height: 300),
          header('h1'),
          block('a', height: 600),
        ],
      ),
    ]);
    final h1 = built.ids['sticky-header:h1']!;
    final log = <(int, int, String?)>[];
    await tester.pumpWidget(render(built.tree, log));

    // open: the header sits below the lead block, un-stuck — primed, not
    // reported, like the scroll edge events
    expect(log.where((e) => e.$2 == FjsEvent.stickOnTopChange), isEmpty);

    // scroll past the lead: the header pins at the viewport top. The drag
    // needs to cover the lead (300) plus some of what follows — there is
    // plenty of content below, so nothing clamps.
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -350));
    await tester.pumpAndSettle();
    final flips = log.where((e) => e.$2 == FjsEvent.stickOnTopChange).toList();
    expect(flips, isNotEmpty);
    expect(flips.first.$1, h1);
    expect(jsonDecode(flips.first.$3!) as Map<String, Object?>, {
      'isStickOnTop': true,
    });
  });

  testWidgets('a pushed header unsticks while the next one pins', (
    tester,
  ) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {'scrollY': true},
        children: [
          header('h1'),
          block('a', height: 300),
          header('h2'),
          block('b', height: 900),
        ],
      ),
    ]);
    final h1 = built.ids['sticky-header:h1']!;
    final h2 = built.ids['sticky-header:h2']!;
    final log = <(int, int, String?)>[];
    await tester.pumpWidget(render(built.tree, log));

    // h1 opens at the very top: primed stuck, silent
    expect(log.where((e) => e.$2 == FjsEvent.stickOnTopChange), isEmpty);

    // scroll deep enough that h2 arrives and pushes h1 off the top
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -500));
    await tester.pumpAndSettle();
    final flips = log.where((e) => e.$2 == FjsEvent.stickOnTopChange).toList();
    final byId = {for (final e in flips) e.$1: e};
    expect(byId[h1]!.$3, '{"isStickOnTop":false}');
    expect(byId[h2]!.$3, '{"isStickOnTop":true}');
  });

  testWidgets('a section bounds its header: it leaves with the section', (
    tester,
  ) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {'scrollY': true},
        children: [
          block('lead', height: 300),
          N(
            'sticky-section',
            children: [header('s1'), block('a', height: 300)],
          ),
          header('s2'),
          block('b', height: 1200),
        ],
      ),
    ]);
    final s1 = built.ids['sticky-header:s1']!;
    final log = <(int, int, String?)>[];
    await tester.pumpWidget(render(built.tree, log));

    // s1 pins once its section (starting at content 300) reaches the top…
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -400));
    await tester.pumpAndSettle();
    var flips = log.where((e) => e.$2 == FjsEvent.stickOnTopChange).toList();
    expect(
      flips.where((e) => e.$1 == s1).map((e) => e.$3),
      contains('{"isStickOnTop":true}'),
    );

    // …and is pushed off once the section (300..640) has passed, while the
    // scroll keeps going to 1480.
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -1200));
    await tester.pumpAndSettle();
    flips = log.where((e) => e.$2 == FjsEvent.stickOnTopChange).toList();
    final s1Last = flips.lastWhere((e) => e.$1 == s1);
    expect(s1Last.$3, '{"isStickOnTop":false}');
  });

  testWidgets('style-level position: sticky joins the sliver split', (
    tester,
  ) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {'scrollY': true},
        children: [
          block('lead', height: 300),
          N(
            'view',
            props: {
              'id': 'cap',
              'style': {
                'position': 'sticky',
                'top': '0px',
                'height': 40,
                'background-color': '#007aff',
              },
            },
          ),
          block('a', height: 600),
        ],
      ),
    ]);
    final cap = built.ids['view:cap']!;
    await tester.pumpWidget(render(built.tree, <(int, int, String?)>[]));

    // the style spelling takes the same sliver route as the tag
    expect(find.byType(CustomScrollView), findsOneWidget);
    expect(find.byType(PinnedHeaderSliver), findsOneWidget);

    // drag past the lead: the view is pinned at the viewport's top edge —
    // measured on its box, since style-level sticky fires no event
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -350));
    await tester.pumpAndSettle();
    final ctx = built.tree.existingGlobalKey(cap)!.currentContext!;
    final box = ctx.findRenderObject()! as RenderBox;
    final viewport = tester.renderObject<RenderBox>(find.byType(Viewport));
    final dy = box.localToGlobal(Offset.zero, ancestor: viewport).dy;
    expect(dy.abs() < 0.5, isTrue);
  });

  testWidgets('style-level sticky top becomes the pin line', (tester) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {'scrollY': true},
        children: [
          block('lead', height: 300),
          N(
            'view',
            props: {
              'id': 'cap',
              'style': {
                'position': 'sticky',
                'top': '60px',
                'height': 40,
                'background-color': '#007aff',
              },
            },
          ),
          block('a', height: 600),
        ],
      ),
    ]);
    final cap = built.ids['view:cap']!;
    await tester.pumpWidget(render(built.tree, <(int, int, String?)>[]));

    // scroll well past the pin point: the view holds 60px below the top,
    // the style `top` acting exactly like offset-top
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -400));
    await tester.pumpAndSettle();
    final ctx = built.tree.existingGlobalKey(cap)!.currentContext!;
    final box = ctx.findRenderObject()! as RenderBox;
    final viewport = tester.renderObject<RenderBox>(find.byType(Viewport));
    final dy = box.localToGlobal(Offset.zero, ancestor: viewport).dy;
    expect((dy - 60).abs() < 0.5, isTrue);
  });

  testWidgets('a buried style-level sticky warns and renders as a box', (
    tester,
  ) async {
    final original = debugPrint;
    final logs = <String>[];
    debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
    final built = treeOf([
      N(
        'scroll-view',
        props: {'scrollY': true},
        children: [
          // one level too deep for the sticky split: the outer view is a run
          N(
            'view',
            children: [
              N(
                'view',
                props: {
                  'style': {'position': 'sticky', 'top': '0px', 'height': 40},
                },
              ),
            ],
          ),
          block('a', height: 600),
        ],
      ),
    ]);
    try {
      await tester.pumpWidget(render(built.tree, <(int, int, String?)>[]));
      // the ordinary box route stays (no sticky direct child)
      expect(find.byType(SingleChildScrollView), findsOneWidget);
      expect(logs.join('\n'), contains('position: sticky on node'));
    } finally {
      debugPrint = original;
    }
  });

  testWidgets(
    'scroll-into-view on a buried grouped header lands on its group start (specs/054)',
    (tester) async {
      final built = treeOf([
        N(
          'scroll-view',
          props: {'scrollY': true, 'id': 'sv'},
          children: [
            N(
              'sticky-section',
              children: [header('gA'), block('a', height: 300)],
            ),
            N(
              'sticky-section',
              children: [header('gB'), block('b', height: 900)],
            ),
          ],
        ),
      ]);
      await tester.pumpWidget(render(built.tree, <(int, int, String?)>[]));

      // deep inside group B: group A (header 40 + block 300) has fully passed
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -900));
      await tester.pumpAndSettle();
      final offset = () => tester
          .widget<CustomScrollView>(find.byType(CustomScrollView))
          .controller!
          .offset;
      expect(offset(), greaterThan(400));

      // jumping back to A must land on the GROUP START (0), not on the
      // header's pinned/pushed-out paint position — the same semantic
      // skyline's native scroll-into-view delivers
      final w = _W()
        ..u8(UiOpCode.setProps)
        ..u32(built.ids['scroll-view:sv']!);
      final json = utf8.encode(
        '{"scrollY":true,"id":"sv","scrollIntoView":"gA"}',
      );
      w.u32(json.length);
      w.raw(json);
      built.tree.applyFrame(Uint8List.fromList(w.b));
      built.tree.flushDirty();
      await tester.pumpAndSettle();

      expect(offset(), moreOrLessEquals(0, epsilon: 2));
    },
  );
}
