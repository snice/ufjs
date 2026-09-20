// The input widget's control props (specs/077): readonly / disabled reach
// the TextField (both used to be ignored and stayed editable), the box is
// never filled by the host app's InputDecorationTheme, `rows` sizes a
// multiline field, and the DOM-shaped el.focus()/el.blur() find the field
// through the global by-node registry.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart';
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

MirrorTree inputTree(int id, Map<String, Object?> props) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(id);
  final tag = utf8.encode('input');
  w.u16(tag.length);
  w.raw(tag);
  final json = utf8.encode(jsonEncode(props));
  w.u8(UiOpCode.setProps);
  w.u32(id);
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(id);
  w.u32(0x7fffffff);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

typedef Events = List<(int, String?)>;

Widget render(
  MirrorTree tree,
  Events log, {
  ThemeData? theme,
  double width = 200,
}) => MaterialApp(
  theme: theme,
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
  testWidgets('readonly: the field accepts focus but not text', (tester) async {
    final tree = inputTree(1, {'value': 'locked', 'readonly': true});
    await tester.pumpWidget(render(tree, []));
    final field = theField(tester);
    expect(field.readOnly, isTrue);
    expect(field.enabled, isTrue);
    await tester.enterText(find.byType(TextField), 'edited');
    await tester.pump();
    expect(field.controller!.text, 'locked');
  });

  testWidgets('disabled: the field cannot take focus or text', (tester) async {
    final tree = inputTree(1, {'value': 'off', 'disabled': true});
    await tester.pumpWidget(render(tree, []));
    final field = theField(tester);
    expect(field.enabled, isFalse);
    expect(field.readOnly, isFalse);
  });

  testWidgets('a plain input stays editable', (tester) async {
    final tree = inputTree(1, {'value': 'free'});
    await tester.pumpWidget(render(tree, []));
    final field = theField(tester);
    expect(field.readOnly, isFalse);
    expect(field.enabled, isTrue);
    await tester.enterText(find.byType(TextField), 'typed');
    expect(field.controller!.text, 'typed');
  });

  testWidgets('the host theme cannot fill the field box', (tester) async {
    // fjs go's theme sets InputDecorationTheme(filled: true), which painted
    // a gray pill over every vant field on white cards (specs/077).
    final tree = inputTree(1, {});
    await tester.pumpWidget(
      render(
        tree,
        [],
        theme: ThemeData(
          inputDecorationTheme: const InputDecorationTheme(
            filled: true,
            fillColor: Color(0xFFF2F2F5),
          ),
        ),
      ),
    );
    expect(theField(tester).decoration!.filled, isFalse);  });

  testWidgets('rows sizes a multiline field without auto-height', (
    tester,
  ) async {
    final tree = inputTree(1, {'multiline': true, 'rows': 2});
    await tester.pumpWidget(render(tree, []));
    expect(theField(tester).maxLines, 2);
  });

  testWidgets('el.focus()/el.blur() find the field by node id', (
    tester,
  ) async {
    final tree = inputTree(1, {});
    await tester.pumpWidget(render(tree, []));
    final field = theField(tester);
    expect(fjsControlFocus(1), isTrue);
    await tester.pump();
    expect(field.focusNode!.hasFocus, isTrue);
    expect(fjsControlBlur(1), isTrue);
    await tester.pump();
    expect(field.focusNode!.hasFocus, isFalse);
    // an id with no live control answers false, not crashes
    expect(fjsControlFocus(999), isFalse);
  });

  testWidgets('the by-node registry entry leaves with the widget', (
    tester,
  ) async {
    final tree = inputTree(1, {});
    await tester.pumpWidget(render(tree, []));
    expect(controlsByNode.containsKey(1), isTrue);
    await tester.pumpWidget(const SizedBox.shrink());
    expect(controlsByNode.containsKey(1), isFalse);
  });

  testWidgets('typing emits the line-change payload with a content height', (
    tester,
  ) async {
    final tree = inputTree(1, {'multiline': true, 'autoHeight': true});
    final Events log = [];
    await tester.pumpWidget(render(tree, log));
    await tester.enterText(find.byType(TextField), 'one two three four');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    final lineChange = log.where((e) => e.$1 == FjsEvent.lineChange);
    expect(lineChange, isNotEmpty);
    final payload = jsonDecode(lineChange.last.$2!) as Map<String, dynamic>;
    expect(payload['height'], greaterThan(0));
  });
}
