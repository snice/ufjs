// CSS positioning: a box that says `position: relative` is the containing
// block for its `position: absolute` children, which is all it takes to
// build a badge, an overlay or a drag canvas — there is no `stack` tag any
// more. What these pin down:
//   * relative + absolute places the child by top/right/bottom/left
//   * the child may hang outside the box (Flutter's Stack clips by
//     default, CSS boxes do not, and the corner badge every app has was
//     being sliced off)
//   * in-flow children of a relative box still lay out as flex
//   * without a positioned parent an absolute child stays in flow
//   * relative offsets move the paint, not the layout
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

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

  void str(String s) => b.addAll(utf8.encode(s));

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    u16(tag.length);
    str(tag);
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

/// A 56x56 box holding an avatar and a badge hung off the corner —
/// examples/hello-fjs/src/pages/comp/container/position.vue in miniature.
MirrorTree _badgeTree({
  String boxStyle = '"width":56,"height":56,"position":"relative"',
}) {
  final w = _W();
  w.create(1, 'view');
  w.props(1, '{"style":{$boxStyle}}');
  w.insert(0, 1);
  w.create(2, 'view');
  w.props(2, '{"style":{"width":56,"height":56,"backgroundColor":"#eef4ff"}}');
  w.insert(1, 2);
  w.create(3, 'view');
  w.props(
    3,
    '{"style":{"position":"absolute","top":-4,"right":-4,'
    '"width":20,"height":20,"backgroundColor":"#dd524d"}}',
  );
  w.insert(1, 3);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

/// A column of two 20px rows, the second nudged with `position: relative`.
MirrorTree _relativeShiftTree({
  String thirdStyle =
      '"height":20,"backgroundColor":"#eef4ff","position":"relative","left":8,"top":4',
}) {
  final w = _W();
  w.create(1, 'view');
  w.props(1, '{"style":{"width":100}}');
  w.insert(0, 1);
  for (var id = 2; id <= 3; id++) {
    w.create(id, 'view');
    w.props(
      id,
      id == 3
          ? '{"style":{$thirdStyle}}'
          : '{"style":{"height":20,"backgroundColor":"#eef4ff"}}',
    );
    w.insert(1, id);
  }
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
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

Rect _badgeRect(WidgetTester tester) => tester.getRect(
  find.byWidgetPredicate(
    (w) =>
        w is Container &&
        (w.decoration as BoxDecoration?)?.color == const Color(0xFFDD524D),
  ),
);

void main() {
  testWidgets('a relative box holds its absolute children, overhang and all', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_badgeTree()));

    final stack = tester.widget<Stack>(find.byType(Stack).first);
    expect(stack.clipBehavior, Clip.none);

    final box = tester.getRect(find.byType(Stack).first);
    expect(box.size, const Size(56, 56));
    // the badge sits 4px past the top-right corner, all 20px of it
    final badge = _badgeRect(tester);
    expect(badge.size, const Size(20, 20));
    expect(badge.right, box.right + 4);
    expect(badge.top, box.top - 4);
  });

  testWidgets('without a positioned parent an absolute child stays in flow', (
    tester,
  ) async {
    // CSS would hand it to some ancestor; this side does not chase that, so
    // the page has to say `relative` — which is what it would write anyway.
    // No height either, so the badge lands under the avatar in the column.
    await tester.pumpWidget(_render(_badgeTree(boxStyle: '"width":56')));

    // no containing block of its own: the badge lays out in the column,
    // under the avatar (its own Stack only hosts its own content)
    final avatar = tester.getRect(
      find.byWidgetPredicate(
        (w) =>
            w is Container &&
            (w.decoration as BoxDecoration?)?.color == const Color(0xFFEEF4FF),
      ),
    );
    expect(_badgeRect(tester).top, greaterThanOrEqualTo(avatar.bottom));
  });

  group('style', () {
    FjsStyle styled(Map<String, Object?> style) => FjsStyle({'style': style});

    test('only a positioned box is a containing block', () {
      expect(styled({'position': 'relative'}).isPositioningContext, isTrue);
      expect(styled({'position': 'absolute'}).isPositioningContext, isTrue);
      expect(styled({'position': 'fixed'}).isPositioningContext, isTrue);
      expect(styled({'position': 'static'}).isPositioningContext, isFalse);
      expect(styled({}).isPositioningContext, isFalse);
    });

    test('relative offsets read like CSS, in both directions', () {
      expect(
        styled({'position': 'relative', 'left': 8, 'top': 4}).relativeOffset,
        const Offset(8, 4),
      );
      // right / bottom are the same shift the other way
      expect(
        styled({
          'position': 'relative',
          'right': 6,
          'bottom': '2px',
        }).relativeOffset,
        const Offset(-6, -2),
      );
      // left wins over right, as in CSS (ltr)
      expect(
        styled({'position': 'relative', 'left': 3, 'right': 9}).relativeOffset,
        const Offset(3, 0),
      );
    });

    test('offsets belong to relative only', () {
      // an absolute box's top/left are the Positioned's job
      expect(
        styled({'position': 'absolute', 'left': 8, 'top': 4}).relativeOffset,
        Offset.zero,
      );
      expect(styled({'left': 8, 'top': 4}).relativeOffset, Offset.zero);
      expect(styled({'position': 'relative'}).relativeOffset, Offset.zero);
    });
  });

  testWidgets('relative offsets move the paint, not the layout', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_relativeShiftTree()));

    final rows = tester.widgetList<Container>(find.byType(Container));
    expect(rows.length, 2);
    final first = tester.getRect(find.byType(Container).first);
    final second = tester.getRect(find.byType(Container).last);
    // laid out as a plain column (second row right under the first), then
    // shifted 8 right / 4 down when painted
    expect(second.left, first.left + 8);
    expect(second.top, first.bottom + 4);
  });
  // ---- spec 044: % offsets ----------------------------------------------

  /// A 200x100 relative box with a full-cover overlay positioned at
  /// `left: 50%` / `top: 50%` — the centered-mask pattern.
  MirrorTree _centeredOverlayTree({String left = '"left":"50%"'}) {
    final w = _W();
    w.create(1, 'view');
    w.props(1, '{"style":{}}');
    w.insert(0, 1);
    w.create(2, 'view');
    w.props(2, '{"style":{"width":200,"height":100,"position":"relative"}}');
    w.insert(1, 2);
    w.create(3, 'view');
    w.props(
      3,
      '{"style":{"position":"absolute","top":"50%",$left,'
      '"width":20,"height":20,"backgroundColor":"#dd524d"}}',
    );
    w.insert(2, 3);
    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));
    return tree;
  }

  testWidgets('absolute % offsets resolve against the positioned box', (
    tester,
  ) async {
    // top measures the box's HEIGHT, left its WIDTH (CSS containing block
    // axes); the overlay starts at the box's center
    await tester.pumpWidget(_render(_centeredOverlayTree()));
    final box = tester.getRect(find.byType(Stack).first);
    final overlay = tester.getRect(
      find.byWidgetPredicate(
        (w) =>
            w is Container &&
            (w.decoration as BoxDecoration?)?.color == const Color(0xFFDD524D),
      ),
    );
    expect(overlay.left, box.left + 100);
    expect(overlay.top, box.top + 50);
  });

  testWidgets('absolute % offsets follow the box when it moves', (
    tester,
  ) async {
    // same tree shifted 30px right by an outer margin: the resolved offset
    // must track the box, not the screen
    final w = _W();
    w.create(1, 'view');
    w.props(1, '{"style":{"marginLeft":30}}');
    w.insert(0, 1);
    w.create(2, 'view');
    w.props(2, '{"style":{"width":200,"height":100,"position":"relative"}}');
    w.insert(1, 2);
    w.create(3, 'view');
    w.props(
      3,
      '{"style":{"position":"absolute","top":"50%","left":"50%",'
      '"width":20,"height":20,"backgroundColor":"#dd524d"}}',
    );
    w.insert(2, 3);
    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));
    await tester.pumpWidget(_render(tree));
    final box = tester.getRect(find.byType(Stack).first);
    final overlay = tester.getRect(
      find.byWidgetPredicate(
        (w) =>
            w is Container &&
            (w.decoration as BoxDecoration?)?.color == const Color(0xFFDD524D),
      ),
    );
    expect(overlay.left, box.left + 100);
  });

  testWidgets('relative % offsets move the paint like px ones', (tester) async {
    // `left: 50%` of the 100px column shifts the paint 50 right while the
    // slot stays put — the sibling does not move
    await tester.pumpWidget(
      _render(
        _relativeShiftTree(
          thirdStyle:
              '"height":20,"backgroundColor":"#eef4ff",'
              '"position":"relative","left":"50%"',
        ),
      ),
    );
    final first = tester.getRect(find.byType(Container).first);
    final second = tester.getRect(find.byType(Container).last);
    expect(second.left, first.left + 50);
    // the layout slot is unchanged: the second row still sits right below
    expect(second.top, first.bottom);
  });
}
