// `transition: color` on a paragraph (spec 078): the colour interpolates
// through the same TweenAnimationBuilder trade decorateNode's decorationTrack
// makes. The state-variant half (a pressed colour) rides the same rebuild.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';

/// Minimal op-frame writer (same hand-encoding as active_style_test).
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

/// A single `text` node carrying [props] and [text], mounted under the root.
MirrorTree _treeWith(Map<String, Object?> props, {String text = 'link'}) {
  final w = _W();
  void propsJson(int id, Map<String, Object?> p) {
    final json = utf8.encode(jsonEncode(p));
    w.u8(UiOpCode.setProps);
    w.u32(id);
    w.u32(json.length);
    w.raw(json);
  }

  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('text');
  propsJson(1, props);
  final bytes = utf8.encode(text);
  w.u8(UiOpCode.setText);
  w.u32(1);
  w.u32(bytes.length);
  w.raw(bytes);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

/// A later frame: just the node's props, replaced in place (the same delta
/// a live style change arrives as).
Uint8List _propsFrame(Map<String, Object?> props) {
  final w = _W();
  final json = utf8.encode(jsonEncode(props));
  w.u8(UiOpCode.setProps);
  w.u32(1);
  w.u32(json.length);
  w.raw(json);
  return Uint8List.fromList(w.b);
}

Widget _render(MirrorTree tree) {
  final node = FjsNodeRenderer(
    tree: tree,
    ids: tree.rootChildren,
    dispatch: (_, __, {String? text}) {},
  );
  return MaterialApp(home: Center(child: node));
}

Color? _textColor(WidgetTester tester) =>
    tester.widget<Text>(find.byType(Text)).style?.color;

Map<String, Object?> _props(String color, {bool transition = true}) => {
  'style': {
    'fontSize': 14,
    'color': color,
    if (transition) 'transition': 'color 0.3s',
  },
};

void main() {
  testWidgets('a colour change with transition: color interpolates', (
    tester,
  ) async {
    final tree = _treeWith(_props('#000000'));
    await tester.pumpWidget(_render(tree));
    expect(_textColor(tester), const Color(0xFF000000));

    tree.applyFrame(_propsFrame(_props('#ffffff')));
    // the retargeting frame itself still paints the start colour — the
    // tween begins wherever the previous animation was (here: at rest)
    await tester.pumpWidget(_render(tree));
    expect(_textColor(tester), const Color(0xFF000000));

    await tester.pump(const Duration(milliseconds: 150));
    final mid = _textColor(tester)!;
    expect(mid, isNot(const Color(0xFF000000)));
    expect(mid, isNot(const Color(0xFFFFFFFF)));

    await tester.pump(const Duration(seconds: 1));
    expect(_textColor(tester), const Color(0xFFFFFFFF));
  });

  testWidgets('without transition: color the change snaps', (tester) async {
    final tree = _treeWith(_props('#000000', transition: false));
    await tester.pumpWidget(_render(tree));
    expect(_textColor(tester), const Color(0xFF000000));

    tree.applyFrame(_propsFrame(_props('#ffffff', transition: false)));
    await tester.pumpWidget(_render(tree));
    expect(_textColor(tester), const Color(0xFFFFFFFF));
  });

  testWidgets('a pressed (:active) colour also animates', (tester) async {
    final tree = _treeWith({
      'onTap': true,
      'style': {'fontSize': 14, 'color': '#000000', 'transition': 'color 0.3s'},
      'activeStyle': {'color': '#ffffff'},
    });
    await tester.pumpWidget(_render(tree));
    expect(_textColor(tester), const Color(0xFF000000));

    final press = await tester.startGesture(
      tester.getCenter(find.byType(Text)),
    );
    await tester.pump(); // the pressed style mounts, the tween starts
    expect(_textColor(tester), const Color(0xFF000000));
    await tester.pump(const Duration(milliseconds: 150));
    final mid = _textColor(tester)!;
    expect(mid, isNot(const Color(0xFF000000)));
    expect(mid, isNot(const Color(0xFFFFFFFF)));
    await tester.pump(const Duration(seconds: 1));
    expect(_textColor(tester), const Color(0xFFFFFFFF));
    await press.up();
    await tester.pump();
  });
}
