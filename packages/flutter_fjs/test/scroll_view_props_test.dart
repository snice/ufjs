// scroll-view's properties. The rules are defined in
// fjs-runtime/src/scroll/metrics.ts and mirrored in render/scroll_metrics.dart;
// the same cases are asserted for the web adapter in
// fjs-runtime/test/web-scroll-swiper.test.ts, which is what makes "one
// contract, two platforms" checkable rather than aspirational.
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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

/// Builds a tree and remembers which id each node got, so a test can send a
/// second frame that changes one prop.
class Built {
  Built(this.tree, this.ids);

  final MirrorTree tree;
  final Map<String, int> ids;
}

Built treeOf(List<N> roots, {Map<String, N> named = const {}}) {
  final w = _W();
  final ids = <String, int>{};
  var next = 1;

  void emit(N node, int parent) {
    final id = next++;
    for (final entry in named.entries) {
      if (identical(entry.value, node)) ids[entry.key] = id;
    }
    w.u8(UiOpCode.create);
    w.u32(id);
    final tag = utf8.encode(node.tag);
    w.u16(tag.length);
    w.raw(tag);
    if (node.text != null) {
      w.u8(UiOpCode.setText);
      w.u32(id);
      final t = utf8.encode(node.text!);
      w.u32(t.length);
      w.raw(t);
    }
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

void setProps(MirrorTree tree, int id, Map<String, Object?> props) {
  final w = _W()
    ..u8(UiOpCode.setProps)
    ..u32(id);
  final json = utf8.encode(jsonEncode(props));
  w.u32(json.length);
  w.raw(json);
  tree.applyFrame(Uint8List.fromList(w.b));
  tree.flushDirty();
}

typedef Events = List<(int, String?)>;

Widget render(MirrorTree tree, Events log) => MaterialApp(
  home: Scaffold(
    body: SizedBox(
      height: 400,
      child: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        dispatch: (id, type, {String? text}) => log.add((type, text)),
      ),
    ),
  ),
);

const int scrollEvent = 12;
const int scrollToUpper = 24;
const int scrollToLower = 25;

List<N> rows(int count) => [
  for (var i = 0; i < count; i++)
    N(
      'view',
      props: {
        'id': 'row-$i',
        'style': {'height': 100},
      },
      children: [N('text', text: 'row $i')],
    ),
];

void main() {
  setUp(resetFjsWarnOnce);

  testWidgets('reports the six-field payload, not a bare offset', (
    tester,
  ) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {'scrollY': true, 'onScroll': true},
        children: rows(20),
      ),
    ]);
    final log = <(int, String?)>[];
    await tester.pumpWidget(render(built.tree, log));

    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -200),
    );
    await tester.pumpAndSettle();

    final scrolls = log.where((e) => e.$1 == scrollEvent).toList();
    expect(scrolls, isNotEmpty);
    final detail = jsonDecode(scrolls.last.$2!) as Map<String, Object?>;
    expect(detail.keys.toList(), [
      'scrollTop',
      'scrollLeft',
      'scrollHeight',
      'scrollWidth',
      'deltaX',
      'deltaY',
    ]);
    expect(detail['scrollTop'], greaterThan(0));
    expect(detail['scrollHeight'], greaterThan(0));
  });

  testWidgets('reports an edge on entry, once, and again after leaving', (
    tester,
  ) async {
    final built = treeOf([
      N(
        'scroll-view',
        props: {
          'scrollY': true,
          'onScrolltoupper': true,
          'onScrolltolower': true,
        },
        children: rows(20),
      ),
    ]);
    final log = <(int, String?)>[];
    await tester.pumpWidget(render(built.tree, log));
    // opening at the top is not "the user reached the top": the state is
    // primed, not reported (scroll/metrics.ts)
    expect(log.where((e) => e.$1 == scrollToUpper), isEmpty);

    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -2000),
    );
    await tester.pumpAndSettle();
    expect(log.where((e) => e.$1 == scrollToLower).length, 1);

    // nudging further along the bottom must not report again
    await tester.drag(find.byType(SingleChildScrollView), const Offset(0, -50));
    await tester.pumpAndSettle();
    expect(log.where((e) => e.$1 == scrollToLower).length, 1);

    // leave and come back
    await tester.drag(find.byType(SingleChildScrollView), const Offset(0, 800));
    await tester.pumpAndSettle();
    expect(log.where((e) => e.$1 == scrollToUpper), isEmpty); // still mid-list
    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -2000),
    );
    await tester.pumpAndSettle();
    expect(log.where((e) => e.$1 == scrollToLower).length, 2);
  });

  testWidgets('scroll-top moves the scroller only when the value changes', (
    tester,
  ) async {
    final scroller = N(
      'scroll-view',
      props: {'scrollY': true, 'scrollTop': 0},
      children: rows(20),
    );
    final built = treeOf([scroller], named: {'scroller': scroller});
    await tester.pumpWidget(render(built.tree, []));

    setProps(built.tree, built.ids['scroller']!, {
      'scrollY': true,
      'scrollTop': 300,
    });
    await tester.pumpAndSettle();
    final position = tester
        .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
        .controller!
        .offset;
    expect(position, moreOrLessEquals(300, epsilon: 1));

    // the user scrolls elsewhere; re-sending the SAME prop must not drag
    // them back
    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -150),
    );
    await tester.pumpAndSettle();
    final afterDrag = tester
        .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
        .controller!
        .offset;
    setProps(built.tree, built.ids['scroller']!, {
      'scrollY': true,
      'scrollTop': 300,
    });
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
          .controller!
          .offset,
      moreOrLessEquals(afterDrag, epsilon: 1),
    );
  });

  testWidgets('scroll-into-view lands on the named row', (tester) async {
    final scroller = N(
      'scroll-view',
      props: {'scrollY': true},
      children: rows(20),
    );
    final built = treeOf([scroller], named: {'scroller': scroller});
    await tester.pumpWidget(render(built.tree, []));

    setProps(built.tree, built.ids['scroller']!, {
      'scrollY': true,
      'scrollIntoView': 'row-5',
    });
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
          .controller!
          .offset,
      moreOrLessEquals(500, epsilon: 2), // five 100px rows
    );
  });

  testWidgets(
    'scroll-into-view re-lands on the SAME id after an empty clears it (specs/054)',
    (tester) async {
      final scroller = N(
        'scroll-view',
        props: {'scrollY': true},
        children: rows(20),
      );
      final built = treeOf([scroller], named: {'scroller': scroller});
      await tester.pumpWidget(render(built.tree, []));

      double offset() => tester
          .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
          .controller!
          .offset;

      setProps(built.tree, built.ids['scroller']!, {
        'scrollY': true,
        'scrollIntoView': 'row-5',
      });
      await tester.pumpAndSettle();
      expect(offset(), moreOrLessEquals(500, epsilon: 2));

      // the user scrolls back up; '' must clear the memo so the SAME id can
      // be asked again — the miniprogram re-trigger idiom
      await tester.drag(
        find.byType(SingleChildScrollView),
        const Offset(0, 600),
      );
      await tester.pumpAndSettle();
      setProps(built.tree, built.ids['scroller']!, {
        'scrollY': true,
        'scrollIntoView': '',
      });
      await tester.pumpAndSettle();
      setProps(built.tree, built.ids['scroller']!, {
        'scrollY': true,
        'scrollIntoView': 'row-5',
      });
      await tester.pumpAndSettle();
      expect(offset(), moreOrLessEquals(500, epsilon: 2));
    },
  );

  testWidgets('a scroll-into-view that matches nothing warns', (tester) async {
    final scroller = N(
      'scroll-view',
      props: {'scrollY': true},
      children: rows(5),
    );
    final built = treeOf([scroller], named: {'scroller': scroller});
    await tester.pumpWidget(render(built.tree, []));

    final logs = <String>[];
    final original = debugPrint;
    debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
    try {
      setProps(built.tree, built.ids['scroller']!, {
        'scrollY': true,
        'scrollIntoView': 'nope',
      });
      await tester.pumpAndSettle();
    } finally {
      // the harness asserts foundation debug vars are back where they were
      debugPrint = original;
    }

    expect(logs.where((l) => l.contains('scroll-into-view')), isNotEmpty);
  });
}
