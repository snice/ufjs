// specs/193 T021: who gets a flat surface, and what happens when a subtree
// stops qualifying. Parity of what is drawn lives in flat_parity_test.dart;
// here only the decision is under test.
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/flat/flat_layout.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_tree.dart';
import 'support/grid_tree.dart';

Future<void> mount(WidgetTester tester, MirrorTree tree, {bool grow = false}) async {
  tester.view.physicalSize = const Size(400, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Material(
        child: Align(
          alignment: Alignment.topLeft,
          child: FjsNodeRenderer(
            tree: tree,
            ids: tree.rootChildren,
            grow: grow,
            dispatch: (_, __, {String? text}) {},
          ),
        ),
      ),
    ),
  );
}

int surfaces() => FjsFlatStats.surfaces;

/// A small pure tree: root view > [n] text children. Returns (tree, ids).
(MirrorTree, List<int>) smallTree({int texts = 3, Map<String, Object?>? rootProps}) {
  final t = FixtureTree();
  final r = t.node(0, 'view', props: rootProps);
  final ids = [r];
  for (var i = 0; i < texts; i++) {
    ids.add(t.text(r, 't$i', {'fontSize': '12px'}));
  }
  return (t.build(), ids);
}

void main() {
  setUp(FjsFlatStats.reset);
  tearDown(() {
    fjsFlatMode = FjsFlatMode.auto;
    fjsFlatSemanticsEnabled = () => SemanticsBinding.instance.semanticsEnabled;
  });

  group('mode', () {
    testWidgets('off never makes a surface', (tester) async {
      fjsFlatMode = FjsFlatMode.off;
      await mount(tester, smallTree().$1);
      expect(surfaces(), 0);
    });

    testWidgets('force makes one for a tiny pure tree', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      await mount(tester, smallTree().$1);
      expect(surfaces(), 1);
    });

    testWidgets('auto skips a tree under the node threshold, takes a big one', (tester) async {
      fjsFlatMode = FjsFlatMode.auto;
      fjsFlatSemanticsEnabled = () => false;
      await mount(tester, smallTree(texts: 3).$1);
      expect(surfaces(), 0, reason: '4 nodes < $fjsFlatMinNodes');
      await tester.pumpWidget(const SizedBox());
      FjsFlatStats.reset();
      await mount(tester, smallTree(texts: fjsFlatMinNodes).$1);
      expect(surfaces(), 1);
    });

    testWidgets('auto falls back while a semantics client is attached; force does not', (tester) async {
      fjsFlatSemanticsEnabled = () => true;
      fjsFlatMode = FjsFlatMode.auto;
      await mount(tester, smallTree(texts: fjsFlatMinNodes).$1);
      expect(surfaces(), 0);
      await tester.pumpWidget(const SizedBox());
      fjsFlatMode = FjsFlatMode.force;
      await mount(tester, smallTree(texts: fjsFlatMinNodes).$1);
      expect(surfaces(), 1);
    });

    testWidgets('a page root is never a surface (its children grow by their own rule)', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      await mount(tester, smallTree().$1, grow: true);
      // the page root stays ordinary; its pure text children become surfaces
      expect(FjsFlatStats.rejected, isNot(contains('tag=view')));
      expect(surfaces(), 3);
    });
  });

  group('refusal', () {
    testWidgets('an event prop sends the subtree back', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      final (tree, ids) = smallTree();
      tree.applyFrame((GridFrameWriter()..setProps(ids[2], '{"onTap":true}')).frame);
      tree.flushDirty();
      await mount(tester, tree);
      expect(FjsFlatStats.rejected, contains('prop:onTap'));
      // the root is ordinary; its other pure children are surfaces of their own
      expect(surfaces(), 2);
    });

    testWidgets('an id (scroll-into-view / label target) refuses', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      await mount(tester, smallTree(rootProps: {'id': 'x'}).$1);
      expect(FjsFlatStats.rejected, contains('prop:id'));
    });

    testWidgets('a style key outside the subset is named in the stats', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      final t = FixtureTree();
      final r = t.view(0, {'overflow': 'hidden'});
      t.text(r, 'x');
      await mount(tester, t.build());
      expect(FjsFlatStats.rejected, contains('style:overflow'));
    });

    testWidgets('other tags, a bare string in a view, and children inside text refuse', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      final t = FixtureTree();
      final r = t.view(0);
      t.node(r, 'image');
      await mount(tester, t.build());
      expect(FjsFlatStats.rejected, contains('tag=image'));

      await tester.pumpWidget(const SizedBox());
      FjsFlatStats.reset();
      final t2 = FixtureTree();
      t2.node(0, 'view', text: 'bare');
      await mount(tester, t2.build());
      expect(FjsFlatStats.rejected, contains('view-text'));

      await tester.pumpWidget(const SizedBox());
      FjsFlatStats.reset();
      final t3 = FixtureTree();
      final p = t3.text(0, 'outer');
      t3.text(p, 'inner');
      await mount(tester, t3.build());
      expect(FjsFlatStats.rejected, contains('text-with-children'));
    });

    testWidgets('a cross size under a stretching parent refuses (not modelled)', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      final t = FixtureTree();
      final r = t.view(0); // column, default align stretch
      t.view(r, {'width': '50px', 'height': '20px'});
      await mount(tester, t.build());
      expect(FjsFlatStats.rejected, contains('cross-size-under-stretch'));
    });

    testWidgets('display:none children are skipped, not refused', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      final t = FixtureTree();
      final r = t.view(0);
      t.text(r, 'shown');
      t.view(r, {'display': 'none'});
      await mount(tester, t.build());
      expect(surfaces(), 1);
    });
  });

  group('dynamic', () {
    testWidgets('a subtree that gains an onTap goes back to widgets, and returns when it loses it', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      final (tree, ids) = smallTree();
      await mount(tester, tree);
      expect(surfaces(), 1);
      expect(find.bySubtype<RichText>(), findsNothing, reason: 'painted by the surface, no Text widgets');

      tree.applyFrame((GridFrameWriter()..setProps(ids[1], '{"onTap":true}')).frame);
      tree.flushDirty();
      await tester.pump();
      // ordinary again: the texts are real paragraphs
      expect(find.bySubtype<RichText>(), findsWidgets);

      tree.applyFrame((GridFrameWriter()..setProps(ids[1], '{"onTap":null}')).frame);
      tree.flushDirty();
      await tester.pump();
      expect(find.bySubtype<RichText>(), findsNothing, reason: 'flat again');
    });

    testWidgets('a text change reaches the surface and relays out only the dirty path', (tester) async {
      fjsFlatMode = FjsFlatMode.force;
      final tree = buildGridTree();
      await mount(tester, tree);
      expect(surfaces(), 1);
      FlatStats.reset();
      tree.applyFrame((GridFrameWriter()..setText(4, 'new')).frame);
      tree.flushDirty();
      await tester.pump();
      // text -> its cell -> its row -> the grid, plus the cell's row siblings
      // whose offsets move; far fewer than the 4051 nodes
      expect(FlatStats.relaidNodes, lessThan(40));
      expect(FlatStats.relaidNodes, greaterThan(0));
    });
  });

  group('verdict cache', () {
    test('flatPure is cleared up the parent chain by flushDirty, and only then', () {
      final t = FixtureTree();
      final r = t.view(0);
      final a = t.view(r);
      final b = t.text(a, 'x');
      final tree = t.build();
      fjsFlatMode = FjsFlatMode.force;
      expect(FlatGate.pureSize(tree.node(r)!, tree), 3);
      expect(tree.node(r)!.flatPure, 1);
      expect(tree.node(a)!.flatPure, 1);
      tree.applyFrame((GridFrameWriter()..setText(b, 'y')).frame);
      expect(tree.node(r)!.flatPure, 1, reason: 'not cleared until flushDirty');
      tree.flushDirty();
      expect(tree.node(b)!.flatPure, 0);
      expect(tree.node(a)!.flatPure, 0);
      expect(tree.node(r)!.flatPure, 0);
      fjsFlatMode = FjsFlatMode.auto;
    });
  });
}
