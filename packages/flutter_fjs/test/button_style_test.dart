// The button's default look, including its pressed state. The reference is
// WeUI's `--weui-BTN-ACTIVE-MASK` / the web adapter's `.fjs-button:active`
// rule: 10% black over the button the instant the finger is down — not
// Material's tap-arena overlay, which waits `kPressTimeout` and misses a
// quick tap, and not its foreground-tinted ripple, which lightens a
// filled button instead of darkening it.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/button.dart';

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
  void raw(List<int> l) => b.addAll(l);
}

/// A `button` node with [propsJson], holding the text "tap".
MirrorTree _buttonTree(String propsJson) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(6);
  w.str('button');
  w.u8(UiOpCode.setText);
  w.u32(1);
  w.u32(3);
  w.str('tap');
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final json = utf8.encode(propsJson);
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

Widget _render(MirrorTree tree, {bool scrollable = false}) {
  final node = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  );
  return MaterialApp(
    home: scrollable ? ListView(children: [node]) : Center(child: node),
  );
}

Finder get _mask => find.byKey(fjsButtonPressMaskKey);

/// A fade (`opacity < 1`). State-tracking nodes keep an Opacity wrapper at
/// 1.0 so a press/hover can change it without remounting their gesture
/// detectors (renderer.dart), so "is there an Opacity" is not the question.
final _faded = find.byWidgetPredicate((w) => w is Opacity && w.opacity < 1);

void main() {
  const filled =
      '{"onTap":true,"style":{"backgroundColor":"#007aff","color":"#ffffff"}}';

  testWidgets('idle has no mask; Material overlay stays inert', (tester) async {
    await tester.pumpWidget(_render(_buttonTree(filled)));
    expect(_mask, findsNothing);

    final style = tester.widget<TextButton>(find.byType(TextButton)).style!;
    expect(style.padding!.resolve(<WidgetState>{}), EdgeInsets.zero);
    expect(
      style.overlayColor!.resolve(<WidgetState>{WidgetState.pressed}),
      Colors.transparent,
    );
    expect(style.splashFactory, NoSplash.splashFactory);
    expect(style.animationDuration, Duration.zero);
  });

  testWidgets('explicit border color still paints a CSS border', (
    tester,
  ) async {
    await tester.pumpWidget(
      _render(
        _buttonTree(
          '{"onTap":true,"style":{"backgroundColor":"#007aff",'
          '"color":"#ffffff","borderColor":"#ff0000"}}',
        ),
      ),
    );

    final decorated = tester.widgetList<Container>(find.byType(Container)).last;
    final decoration = decorated.decoration as BoxDecoration;
    expect(decoration.border, Border.all(color: const Color(0xFFFF0000)));
  });

  // The hairline is the host's own default now (fjsButtonDefaultBorder): a
  // filled variant must not have one, and a border injected from the JS side
  // would arrive here indistinguishable from one the page wrote. These are
  // the resolution rules a page relies on to keep, recolor or drop it.
  group('the default hairline', () {
    const hairline = '"border":"1px solid rgba(0,0,0,0.16)"';

    Future<Border?> borderOf(WidgetTester tester, String style) async {
      await tester.pumpWidget(
        _render(_buttonTree('{"onTap":true,"style":{$style}}')),
      );
      final containers = tester.widgetList<Container>(find.byType(Container));
      if (containers.isEmpty) return null;
      return (containers.last.decoration as BoxDecoration?)?.border as Border?;
    }

    testWidgets('is drawn without the page saying anything', (tester) async {
      expect(
        await borderOf(tester, '"color":"#007aff"'),
        Border.all(color: const Color(0x29000000)),
      );
    });

    testWidgets('is painted as the shorthand asks', (tester) async {
      expect(
        await borderOf(tester, hairline),
        Border.all(color: const Color(0x29000000)),
      );
    });

    testWidgets('border-color alone recolors it', (tester) async {
      expect(
        await borderOf(tester, '$hairline,"borderColor":"#007aff"'),
        Border.all(color: const Color(0xFF007AFF)),
      );
    });

    testWidgets('border: none and border-width: 0 drop it', (tester) async {
      expect(await borderOf(tester, '"border":"none"'), isNull);
      expect(await borderOf(tester, '$hairline,"borderWidth":0'), isNull);
    });

    testWidgets('a page border replaces it', (tester) async {
      expect(
        await borderOf(tester, '"border":"2px solid red"'),
        Border.all(color: const Color(0xFFFF0000), width: 2),
      );
    });
  });

  // Two ways to be non-interactive, and they look different on purpose:
  // `disabled` is a state the page asked for (faded, inert), while a button
  // with no handler at all is just a static label with normal chrome.
  group('disabled and loading', () {
    testWidgets('disabled does not dispatch and shows no press mask', (
      tester,
    ) async {
      final events = <int>[];
      final tree = _buttonTree('{"onTap":true,"disabled":true}');
      await tester.pumpWidget(
        MaterialApp(
          home: Center(
            child: FjsNodeRenderer(
              tree: tree,
              ids: tree.rootChildren,
              dispatch: (_, type, {String? text}) => events.add(type),
            ),
          ),
        ),
      );
      final press = await tester.startGesture(
        tester.getCenter(find.byType(TextButton)),
      );
      await tester.pump();
      expect(_mask, findsNothing);
      await press.up();
      await tester.pump();
      expect(events, isEmpty);
      expect(tester.widget<Opacity>(_faded).opacity, 0.5);
    });

    testWidgets('loading is inert but not faded', (tester) async {
      final events = <int>[];
      final tree = _buttonTree('{"onTap":true,"loading":true}');
      await tester.pumpWidget(
        MaterialApp(
          home: Center(
            child: FjsNodeRenderer(
              tree: tree,
              ids: tree.rootChildren,
              dispatch: (_, type, {String? text}) => events.add(type),
            ),
          ),
        ),
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.tap(find.byType(TextButton), warnIfMissed: false);
      await tester.pump();
      expect(events, isEmpty);
      expect(_faded, findsNothing);
    });

    testWidgets('a button with no handler stays a plain static button', (
      tester,
    ) async {
      await tester.pumpWidget(_render(_buttonTree('{}')));
      expect(_faded, findsNothing);
      final press = await tester.startGesture(
        tester.getCenter(find.byType(TextButton)),
      );
      await tester.pump();
      expect(_mask, findsNothing);
      await press.up();
    });
  });

  // The cursor is how a stylesheet says "not clickable" on both ends —
  // vant's loading button is `cursor: default`, its disabled one
  // `not-allowed`, and web shows no press feedback for either. The chrome
  // mask follows suit; a pointer cursor (or no cursor rule at all) keeps it.
  group('cursor-gated press mask', () {
    testWidgets('default (vant loading) takes no mask', (tester) async {
      await tester.pumpWidget(
        _render(
          _buttonTree(
            '{"onTap":true,"style":{"backgroundColor":"#007aff",'
            '"color":"#ffffff","cursor":"default"}}',
          ),
        ),
      );
      final press = await tester.startGesture(
        tester.getCenter(find.byType(TextButton)),
      );
      await tester.pump();
      expect(_mask, findsNothing);
      await press.up();
      await tester.pump();
    });

    testWidgets('not-allowed (vant disabled) takes no mask', (tester) async {
      await tester.pumpWidget(
        _render(
          _buttonTree(
            '{"onTap":true,"style":{"backgroundColor":"#007aff",'
            '"color":"#ffffff","cursor":"not-allowed"}}',
          ),
        ),
      );
      final press = await tester.startGesture(
        tester.getCenter(find.byType(TextButton)),
      );
      await tester.pump();
      expect(_mask, findsNothing);
      await press.up();
      await tester.pump();
    });

    testWidgets('pointer keeps the mask', (tester) async {
      await tester.pumpWidget(
        _render(
          _buttonTree(
            '{"onTap":true,"style":{"backgroundColor":"#007aff",'
            '"color":"#ffffff","cursor":"pointer"}}',
          ),
        ),
      );
      final press = await tester.startGesture(
        tester.getCenter(find.byType(TextButton)),
      );
      await tester.pump();
      expect(_mask, findsOneWidget);
      await press.up();
      await tester.pump();
    });
  });

  testWidgets('pointer down paints the 10% mask on the next frame', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_buttonTree(filled)));

    final press = await tester.startGesture(
      tester.getCenter(find.byType(TextButton)),
    );
    await tester.pump(); // the very next frame, not one kPressTimeout later
    expect(_mask, findsOneWidget);
    final box = tester.widget<Container>(_mask);
    expect(
      (box.foregroundDecoration as BoxDecoration).color,
      const Color(0x1A000000),
    );
    final maskSize = tester.getSize(_mask);
    final buttonSize = tester.getSize(find.byType(TextButton));
    expect(maskSize.width, greaterThan(buttonSize.width));
    expect(maskSize.height, greaterThan(buttonSize.height));

    await press.up();
    await tester.pump();
    expect(_mask, findsNothing);
  });

  testWidgets('shows on pointer down inside a scrollable', (tester) async {
    // Same regression as `:active`: a tap recognizer inside a list only
    // reports onTapDown once it wins the arena — a quick tap is over by
    // then and Material's overlay never paints.
    await tester.pumpWidget(_render(_buttonTree(filled), scrollable: true));
    final press = await tester.startGesture(
      tester.getCenter(find.byType(TextButton)),
    );
    await tester.pump();
    expect(_mask, findsOneWidget);
    await press.up();
    await tester.pump();
    expect(_mask, findsNothing);
  });

  testWidgets('press mask stays the button size inside a stretch column', (
    tester,
  ) async {
    // The regression from wrapping with Stack+Positioned.fill: the stack
    // took the column's stretched width, the button shrink-wrapped, and
    // the mask painted a full-width grey bar beside it.
    final tree = _buttonTree(filled);
    await tester.pumpWidget(
      MaterialApp(
        home: Center(
          child: SizedBox(
            width: 300,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                FjsNodeRenderer(
                  tree: tree,
                  ids: tree.rootChildren,
                  dispatch: (_, __, {String? text}) {},
                ),
              ],
            ),
          ),
        ),
      ),
    );
    final inner = tester.getSize(find.byType(TextButton));
    expect(inner.width, lessThan(300));

    final press = await tester.startGesture(
      tester.getCenter(find.byType(TextButton)),
    );
    await tester.pump();
    expect(tester.getSize(find.byType(TextButton)), inner);
    final maskSize = tester.getSize(_mask);
    expect(maskSize.width, 300);
    expect(maskSize.height, greaterThan(inner.height));

    await press.up();
    await tester.pump();
    expect(tester.getSize(find.byType(TextButton)), inner);
    expect(_mask, findsNothing);
  });

  testWidgets('a disabled button never paints the mask', (tester) async {
    await tester.pumpWidget(
      _render(_buttonTree('{"style":{"backgroundColor":"#007aff"}}')),
    );
    final press = await tester.startGesture(
      tester.getCenter(find.byType(TextButton)),
    );
    await tester.pump();
    expect(_mask, findsNothing);
    await press.up();
  });

  // The label a component library leaves: van-button renders
  // `<button><span class="van-button__text">label</span></button>`, so the
  // text lives one shape deeper than a page's own
  // `<button>label</button>` — a text node that has no text of its own,
  // holding a child text node (specs/068-demo-vant).
  group('label extraction', () {
    testWidgets('reads a string child off the node itself', (tester) async {
      await tester.pumpWidget(_render(_buttonTree('{"onTap":true}')));
      expect(find.text('tap'), findsOneWidget);
    });

    testWidgets('follows the slot wrapper a library button adds', (
      tester,
    ) async {
      await tester.pumpWidget(_render(_vanButtonTree()));
      expect(find.text('主要'), findsOneWidget);
    });
  });
}

/// The label a component library leaves: van-button renders
/// `<button><div class="van-button__content"><span class="van-button__text">
/// label</span></div></button>`, so the text lives under a `view` and a
/// text node that has no text of its own (specs/068-demo-vant).
MirrorTree _vanButtonTree() {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(6);
  w.str('button');
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0x7fffffff);
  w.u8(UiOpCode.create);
  w.u32(4);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.insert);
  w.u32(1);
  w.u32(4);
  w.u32(0x7fffffff);
  w.u8(UiOpCode.create);
  w.u32(2);
  w.u16(4);
  w.str('text');
  w.u8(UiOpCode.insert);
  w.u32(4);
  w.u32(2);
  w.u32(0x7fffffff);
  w.u8(UiOpCode.create);
  w.u32(3);
  w.u16(4);
  w.str('text');
  w.u8(UiOpCode.setText);
  w.u32(3);
  final t = utf8.encode('主要');
  w.u32(t.length);
  w.raw(t);
  w.u8(UiOpCode.insert);
  w.u32(2);
  w.u32(3);
  w.u32(0x7fffffff);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

