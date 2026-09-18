// The form CONTROLS that are Dart widgets: radio, the two groups, label,
// and input's focus / blur / maxlength — plus the boolean-prop rule they all
// share (a valueless attribute arrives as "").
//
// `<form>` itself is not here: it is a JS component on both platforms
// (fjs-runtime/src/components/form.ts and its web twin), covered by
// flutter-form.test.ts / web-form.test.ts. See
// specs/007-form-components/plan.md §3.8 for why it moved.
//
// The group and label payloads asserted here are asserted verbatim in
// web-form.test.ts too — that pair is the two-ends contract.
//
// Every payload asserted here is asserted verbatim in the web adapter's
// test (fjs-runtime/test/web-form.test.ts). That pair IS the "two ends, one
// contract" check for these tags — if one side's string changes, the other
// side's test has to change with it.
import 'dart:convert';
import 'dart:typed_data';

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

  void str(String s) => b.addAll(utf8.encode(s));
  void raw(List<int> l) => b.addAll(l);
}

/// A node in the little tree description the tests build.
class N {
  N(this.tag, {this.props = const {}, this.text, this.children = const []});

  final String tag;
  final Map<String, Object?> props;
  final String? text;
  final List<N> children;
}

/// Encodes [roots] as one op frame and applies it — the same path the JS
/// writer takes, so these tests exercise real mirror nodes.
MirrorTree treeOf(List<N> roots) {
  final w = _W();
  var next = 1;

  int emit(N node, int parent) {
    final id = next++;
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
    return id;
  }

  for (final root in roots) {
    emit(root, 0);
  }
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

/// (event type, payload) pairs, in dispatch order.
typedef Events = List<(int, String?)>;

Widget render(MirrorTree tree, Events log) {
  return MaterialApp(
    home: Scaffold(
      body: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        dispatch: (id, type, {String? text}) => log.add((type, text)),
      ),
    ),
  );
}

const int valueChanged = 5;
const int focusEvent = 20;
const int blurEvent = 21;

Future<void> tapAt(WidgetTester tester, Finder finder) async {
  await tester.tap(finder, warnIfMissed: false);
  await tester.pump();
}

void main() {
  setUp(resetFjsWarnOnce);

  group('radio-group', () {
    testWidgets('is exclusive and reports the selected name', (tester) async {
      final log = <(int, String?)>[];
      final tree = treeOf([
        N(
          'radio-group',
          props: {'onValueChanged': true},
          children: [
            N('radio', props: {'name': 'a'}),
            N('radio', props: {'name': 'b'}),
          ],
        ),
      ]);
      await tester.pumpWidget(render(tree, log));

      await tapAt(tester, find.byType(GestureDetector).at(1));
      expect(log, [(valueChanged, '1'), (valueChanged, 'b')]);

      log.clear();
      await tapAt(tester, find.byType(GestureDetector).at(0));
      // the radio that lost is turned off silently — one change, not two
      expect(log, [(valueChanged, '1'), (valueChanged, 'a')]);
    });

    testWidgets('tapping the selected radio again changes nothing', (
      tester,
    ) async {
      final log = <(int, String?)>[];
      final tree = treeOf([
        N(
          'radio-group',
          children: [
            N('radio', props: {'name': 'a', 'value': true}),
          ],
        ),
      ]);
      await tester.pumpWidget(render(tree, log));
      await tapAt(tester, find.byType(GestureDetector).first);
      expect(log, isEmpty);
    });
  });

  group('checkbox-group', () {
    testWidgets('emits the selected names as a JSON array in document order', (
      tester,
    ) async {
      final log = <(int, String?)>[];
      final tree = treeOf([
        N(
          'checkbox-group',
          children: [
            N('checkbox', props: {'name': 'a'}),
            N('checkbox', props: {'name': 'b'}),
            N('checkbox', props: {'name': 'c'}),
          ],
        ),
      ]);
      await tester.pumpWidget(render(tree, log));
      final boxes = find.byType(Checkbox);

      await tapAt(tester, boxes.at(2));
      await tapAt(tester, boxes.at(0));
      final groupPayloads = log
          .where((e) => e.$2 != '1' && e.$2 != '0')
          .map((e) => e.$2)
          .toList();
      expect(groupPayloads, ['["c"]', '["a","c"]']);
    });
  });

  group('label', () {
    testWidgets('forwards a tap to the control named by `for`', (tester) async {
      final log = <(int, String?)>[];
      final tree = treeOf([
        N(
          'label',
          props: {'for': 'agree'},
          children: [
            N('text', text: '同意'),
            N('checkbox', props: {'id': 'agree', 'onValueChanged': true}),
          ],
        ),
      ]);
      await tester.pumpWidget(render(tree, log));
      await tapAt(tester, find.text('同意'));
      expect(log, [(valueChanged, '1')]);
    });

    testWidgets('without `for`, takes the first control under it', (
      tester,
    ) async {
      final log = <(int, String?)>[];
      final tree = treeOf([
        N(
          'label',
          children: [
            N('text', text: '开关'),
            N('switch', props: {'onValueChanged': true}),
          ],
        ),
      ]);
      await tester.pumpWidget(render(tree, log));
      await tapAt(tester, find.text('开关'));
      expect(log, [(valueChanged, '1')]);
    });

    testWidgets('focuses an input instead of toggling it', (tester) async {
      final log = <(int, String?)>[];
      final tree = treeOf([
        N(
          'label',
          children: [
            N('text', text: '昵称'),
            N('input', props: {'onFocus': true}),
          ],
        ),
      ]);
      await tester.pumpWidget(render(tree, log));
      await tapAt(tester, find.text('昵称'));
      expect(log, [(focusEvent, '')]);
    });

    testWidgets('does not double-toggle when the control itself is tapped', (
      tester,
    ) async {
      // The web side has to suppress this explicitly (a click bubbles to the
      // label); here the arena hands the tap to the inner detector and the
      // label's never fires. Asserted on both sides so the pair stays honest.
      final log = <(int, String?)>[];
      final tree = treeOf([
        N(
          'label',
          children: [
            N('text', text: '开关'),
            N('switch', props: {'onValueChanged': true}),
          ],
        ),
      ]);
      await tester.pumpWidget(render(tree, log));
      await tapAt(tester, find.byType(Switch));
      expect(log, [(valueChanged, '1')]);
    });

    testWidgets('renders its own text when it has no element children', (
      tester,
    ) async {
      // Before this tag existed, <label> was mapped to `text` by the HTML
      // compat table. Dropping the host text here would make it silently
      // vanish (constitution V).
      final tree = treeOf([N('label', text: '昵称')]);
      await tester.pumpWidget(render(tree, []));
      expect(find.text('昵称'), findsOneWidget);
    });
  });

  group('boolean props', () {
    testWidgets('a valueless attribute counts as true', (tester) async {
      // `<button plain>` reaches the mirror tree as "" — Vue only casts it
      // to a boolean on the web side. Found on the simulator: plain buttons
      // rendered filled there and outlined on web.
      final log = <(int, String?)>[];
      final tree = treeOf([
        N('button', props: {'onTap': true, 'disabled': ''}, text: 'go'),
      ]);
      await tester.pumpWidget(render(tree, log));
      await tapAt(tester, find.text('go'));
      expect(log, isEmpty);
      expect(tester.widget<Opacity>(find.byType(Opacity)).opacity, 0.5);
    });

    testWidgets('an explicit false stays false', (tester) async {
      final log = <(int, String?)>[];
      final tree = treeOf([
        N('button', props: {'onTap': true, 'disabled': 'false'}, text: 'go'),
      ]);
      await tester.pumpWidget(render(tree, log));
      await tapAt(tester, find.text('go'));
      expect(log, [(1, null)]);
    });
  });

  group('input', () {
    testWidgets('emits focus and blur with the current text', (tester) async {
      final log = <(int, String?)>[];
      final tree = treeOf([
        N('input', props: {'value': 'hi', 'onFocus': true, 'onBlur': true}),
      ]);
      await tester.pumpWidget(render(tree, log));

      await tester.tap(find.byType(TextField));
      await tester.pump();
      expect(log, [(focusEvent, 'hi')]);

      // Route-level focus loss, the same path a keyboard dismiss takes.
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump();
      expect(log, [(focusEvent, 'hi'), (blurEvent, 'hi')]);
    });

    testWidgets('caps the text at maxlength and treats -1 as no limit', (
      tester,
    ) async {
      final capped = treeOf([
        N('input', props: {'maxlength': 5, 'onTextChanged': true}),
      ]);
      final log = <(int, String?)>[];
      await tester.pumpWidget(render(capped, log));
      await tester.enterText(find.byType(TextField), '1234567890');
      await tester.pump();
      expect(log.last.$2, '12345');

      final free = treeOf([
        N('input', props: {'maxlength': -1, 'onTextChanged': true}),
      ]);
      final log2 = <(int, String?)>[];
      await tester.pumpWidget(render(free, log2));
      await tester.enterText(find.byType(TextField), '1234567890');
      await tester.pump();
      expect(log2.last.$2, '1234567890');
    });
  });
}
