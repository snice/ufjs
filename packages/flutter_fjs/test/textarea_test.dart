// The Flutter half of specs/012-textarea. The tag itself is a JS component
// (fjs-runtime/src/components/textarea.ts) that renders `<input multiline>`,
// so everything below is asserted on the input widget with the props that
// component sends. The web twin is fjs-runtime/test/web-textarea.test.ts.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart';
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
}

/// One `<input multiline>` as node 1, with the props the textarea component
/// would have sent.
MirrorTree areaTree(Map<String, Object?> props) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  final tag = utf8.encode('input');
  w.u16(tag.length);
  w.raw(tag);
  final json = utf8.encode(jsonEncode({'multiline': true, ...props}));
  w.u8(UiOpCode.setProps);
  w.u32(1);
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0x7fffffff);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

void setAreaProps(MirrorTree tree, Map<String, Object?> props) {
  final w = _W()
    ..u8(UiOpCode.setProps)
    ..u32(1);
  final json = utf8.encode(jsonEncode({'multiline': true, ...props}));
  w.u32(json.length);
  w.raw(json);
  tree.applyFrame(Uint8List.fromList(w.b));
  tree.flushDirty();
}

typedef Events = List<(int, String?)>;

Widget render(MirrorTree tree, Events log, {double width = 200}) => MaterialApp(
  home: Scaffold(
    body: SizedBox(
      width: width,
      height: 600,
      child: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        dispatch: (id, type, {String? text}) => log.add((type, text)),
      ),
    ),
  ),
);

TextField theField(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField));

void main() {
  group('auto-height', () {
    testWidgets('off and unsized: three lines, then it scrolls inside', (
      tester,
    ) async {
      final tree = areaTree({});
      await tester.pumpWidget(render(tree, []));
      final field = theField(tester);
      // 3, not null: a TextField at its maxLines scrolls internally instead
      // of growing, which is the mini program's default box.
      expect(field.maxLines, 3);
      expect(field.expands, isFalse);
    });

    testWidgets('on: the field grows without bound', (tester) async {
      final tree = areaTree({'autoHeight': true});
      await tester.pumpWidget(render(tree, []));
      final field = theField(tester);
      expect(field.maxLines, isNull);
      expect(field.expands, isFalse);
    });

    testWidgets('off with a styled height: it fills that box and scrolls', (
      tester,
    ) async {
      final tree = areaTree({
        'style': {'height': 120},
      });
      await tester.pumpWidget(render(tree, []));
      final field = theField(tester);
      expect(field.expands, isTrue);
      expect(field.maxLines, isNull);
      expect(field.minLines, isNull);
      // filling the box only makes sense from the top
      expect(field.textAlignVertical, TextAlignVertical.top);
    });

    testWidgets('a styled height is ignored while auto-height is on', (
      tester,
    ) async {
      final tree = areaTree({
        'autoHeight': true,
        'style': {'height': 120},
      });
      await tester.pumpWidget(render(tree, []));
      expect(theField(tester).expands, isFalse);
    });

    testWidgets('a single-line input is untouched', (tester) async {
      final w = _W();
      w.u8(UiOpCode.create);
      w.u32(1);
      final tag = utf8.encode('input');
      w.u16(tag.length);
      w.raw(tag);
      w.u8(UiOpCode.insert);
      w.u32(0);
      w.u32(1);
      w.u32(0x7fffffff);
      final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
      await tester.pumpWidget(render(tree, []));
      expect(theField(tester).maxLines, 1);
    });
  });

  group('confirm-type', () {
    testWidgets('return is a newline key and reports no confirm', (
      tester,
    ) async {
      final tree = areaTree({'confirmType': 'return'});
      final log = <(int, String?)>[];
      await tester.pumpWidget(render(tree, log));
      expect(theField(tester).textInputAction, TextInputAction.newline);

      await tester.enterText(find.byType(TextField), 'hello');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(
        log.where((e) => e.$1 == FjsEvent.textSubmitted),
        isEmpty,
        reason: 'a newline key is not a confirm',
      );
    });

    testWidgets('every other value maps to its action and reports confirm', (
      tester,
    ) async {
      for (final (name, action) in <(String, TextInputAction)>[
        ('send', TextInputAction.send),
        ('search', TextInputAction.search),
        ('next', TextInputAction.next),
        ('go', TextInputAction.go),
        ('done', TextInputAction.done),
      ]) {
        final tree = areaTree({'confirmType': name});
        final log = <(int, String?)>[];
        await tester.pumpWidget(render(tree, log));
        expect(theField(tester).textInputAction, action, reason: name);

        await tester.enterText(find.byType(TextField), 'hi');
        await tester.testTextInput.receiveAction(action);
        await tester.pump();
        expect(
          log.where((e) => e.$1 == FjsEvent.textSubmitted).length,
          1,
          reason: name,
        );
      }
    });

    testWidgets('an unknown value falls back to newline', (tester) async {
      // The warning is the JS side's job (textarea/props.ts); here the only
      // question is what the widget does with a value it does not know.
      final tree = areaTree({'confirmType': 'shout'});
      await tester.pumpWidget(render(tree, []));
      expect(theField(tester).textInputAction, TextInputAction.newline);
    });
  });

  group('focus', () {
    testWidgets('auto-focus takes the field on the first frame', (
      tester,
    ) async {
      final tree = areaTree({'autoFocus': true});
      await tester.pumpWidget(render(tree, []));
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode!.hasFocus,
        isTrue,
      );
    });

    testWidgets('focus moves on a change and does not grab it back', (
      tester,
    ) async {
      final tree = areaTree({'focus': false});
      final log = <(int, String?)>[];
      await tester.pumpWidget(render(tree, log));
      final node = theField(tester).focusNode!;
      expect(node.hasFocus, isFalse);

      setAreaProps(tree, {'focus': true});
      await tester.pump();
      expect(node.hasFocus, isTrue);

      // the user taps away; the prop is STILL true and must not win it back
      node.unfocus();
      await tester.pump();
      setAreaProps(tree, {'focus': true, 'placeholder': 'x'});
      await tester.pump();
      expect(node.hasFocus, isFalse);

      // going false then true again does move it
      setAreaProps(tree, {'focus': false});
      await tester.pump();
      setAreaProps(tree, {'focus': true});
      await tester.pump();
      expect(node.hasFocus, isTrue);
    });
  });

  group('linechange', () {
    testWidgets('primes once, then reports only when the count changes', (
      tester,
    ) async {
      final tree = areaTree({'autoHeight': true});
      final log = <(int, String?)>[];
      await tester.pumpWidget(render(tree, log, width: 120));
      await tester.pump();

      List<(int, String?)> lines() =>
          log.where((e) => e.$1 == FjsEvent.lineChange).toList();
      // The priming report: the JS component drops this one
      // (components/textarea.ts), so a page never sees it.
      expect(lines().length, 1);
      expect(jsonDecode(lines().first.$2!), {
        'height': anything,
        'lineCount': 1,
      });

      await tester.enterText(find.byType(TextField), 'short');
      await tester.pump();
      await tester.pump();
      expect(lines().length, 1, reason: 'still one line');

      await tester.enterText(
        find.byType(TextField),
        'a much longer piece of text that has to wrap more than once here',
      );
      await tester.pump();
      await tester.pump();
      expect(lines().length, greaterThan(1));
      final detail = jsonDecode(lines().last.$2!) as Map<String, Object?>;
      expect(detail.keys.toList(), ['height', 'lineCount']);
      expect(detail['lineCount'], greaterThan(1));
    });

    testWidgets('a narrower box re-measures the same text', (tester) async {
      final tree = areaTree({'autoHeight': true});
      final log = <(int, String?)>[];
      await tester.pumpWidget(render(tree, log, width: 400));
      await tester.pump();
      await tester.enterText(
        find.byType(TextField),
        'a sentence that fits on one line when the box is wide',
      );
      await tester.pump();
      await tester.pump();
      final before = log.where((e) => e.$1 == FjsEvent.lineChange).length;

      await tester.pumpWidget(render(tree, log, width: 90));
      await tester.pump();
      await tester.pump();
      expect(
        log.where((e) => e.$1 == FjsEvent.lineChange).length,
        greaterThan(before),
      );
    });

    testWidgets('a single-line input never reports', (tester) async {
      final w = _W();
      w.u8(UiOpCode.create);
      w.u32(1);
      final tag = utf8.encode('input');
      w.u16(tag.length);
      w.raw(tag);
      w.u8(UiOpCode.insert);
      w.u32(0);
      w.u32(1);
      w.u32(0x7fffffff);
      final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
      final log = <(int, String?)>[];
      await tester.pumpWidget(render(tree, log));
      await tester.enterText(find.byType(TextField), 'hello');
      await tester.pump();
      await tester.pump();
      expect(log.where((e) => e.$1 == FjsEvent.lineChange), isEmpty);
    });
  });

  group('placeholder-style', () {
    testWidgets('takes the four keys it can honour', (tester) async {
      final tree = areaTree({
        'placeholder': 'say something',
        'placeholderStyle':
            'color: #c0c0c0; font-size: 12px; font-weight: bold; text-shadow: 0 0 2px red',
      });
      await tester.pumpWidget(render(tree, []));
      final hint = theField(tester).decoration!.hintStyle!;
      expect(hint.color, const Color(0xFFC0C0C0));
      expect(hint.fontSize, 12);
      expect(hint.fontWeight, FontWeight.bold);
    });

    testWidgets('without it the hint keeps the shared grey', (tester) async {
      final tree = areaTree({'placeholder': 'say something'});
      await tester.pumpWidget(render(tree, []));
      // the same #999999 base-css.ts pins for ::placeholder
      expect(
        theField(tester).decoration!.hintStyle!.color,
        const Color(0xFF999999),
      );
    });
  });

  group('maxlength', () {
    testWidgets('truncates silently at the limit the component sent', (
      tester,
    ) async {
      final tree = areaTree({'maxlength': 5});
      await tester.pumpWidget(render(tree, []));
      await tester.enterText(find.byType(TextField), 'abcdefghij');
      await tester.pump();
      expect(find.text('abcde'), findsOneWidget);
    });
  });
}
