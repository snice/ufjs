// `transition: padding` / `transition: margin` (spec 078): the resolved
// edge set interpolates — a % side resolved its reference already (inside
// the LayoutBuilder), so EdgeInsets.lerp is the CSS transition per side.
// No transitionend is dispatched here (only width/height have consumers).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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

  void str(String s) => b.addAll(utf8.encode(s));
  void raw(List<int> l) => b.addAll(l);
}

MirrorTree _treeWith(Map<String, Object?> props) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final json = utf8.encode(jsonEncode(props));
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  return MirrorTree()..applyFrame(Uint8List.fromList(w.b));
}

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

// find.byType walks pre-order (parents before children), so .first is the
// OUTERMOST Padding (the margin wrapper) and .last the innermost (the
// padding wrapper). Each fixture here declares exactly one of the two.
EdgeInsets _innermostPadding(WidgetTester tester) =>
    tester.widget<Padding>(find.byType(Padding).last).padding as EdgeInsets;

EdgeInsets _outermostPadding(WidgetTester tester) =>
    tester.widget<Padding>(find.byType(Padding).first).padding as EdgeInsets;

void main() {
  testWidgets('a padding change with transition: padding interpolates', (
    tester,
  ) async {
    final tree = _treeWith({
      'style': {
        'width': 200,
        'height': 100,
        'padding': 8,
        'transition': 'padding 0.3s',
      },
    });
    await tester.pumpWidget(_render(tree));
    expect(_innermostPadding(tester), const EdgeInsets.all(8));

    tree.applyFrame(
      _propsFrame({
        'style': {
          'width': 200,
          'height': 100,
          'padding': 32,
          'transition': 'padding 0.3s',
        },
      }),
    );
    await tester.pumpWidget(_render(tree));
    // the retargeting frame still lays out the start padding
    expect(_innermostPadding(tester), const EdgeInsets.all(8));

    await tester.pump(const Duration(milliseconds: 150));
    final mid = _innermostPadding(tester).left;
    expect(mid, greaterThan(8));
    expect(mid, lessThan(32));

    await tester.pump(const Duration(seconds: 1));
    expect(_innermostPadding(tester), const EdgeInsets.all(32));
  });

  testWidgets('a margin change with transition: margin interpolates', (
    tester,
  ) async {
    final tree = _treeWith({
      'style': {
        'width': 200,
        'height': 100,
        'margin': 8,
        'transition': 'margin 0.3s',
      },
    });
    await tester.pumpWidget(_render(tree));
    expect(_outermostPadding(tester), const EdgeInsets.all(8));

    tree.applyFrame(
      _propsFrame({
        'style': {
          'width': 200,
          'height': 100,
          'margin': 24,
          'transition': 'margin 0.3s',
        },
      }),
    );
    await tester.pumpWidget(_render(tree));
    await tester.pump(const Duration(milliseconds: 150));
    final mid = _outermostPadding(tester).top;
    expect(mid, greaterThan(8));
    expect(mid, lessThan(24));

    await tester.pump(const Duration(seconds: 1));
    expect(_outermostPadding(tester), const EdgeInsets.all(24));
  });

  testWidgets('a % padding interpolates on its resolved pixels', (
    tester,
  ) async {
    final tree = _treeWith({
      'style': {
        'width': 200,
        'height': 100,
        'padding': '10%',
        'transition': 'padding 0.3s',
      },
    });
    await tester.pumpWidget(_render(tree));
    final start = _innermostPadding(tester).left;
    expect(start, greaterThan(0));

    tree.applyFrame(
      _propsFrame({
        'style': {
          'width': 200,
          'height': 100,
          'padding': '20%',
          'transition': 'padding 0.3s',
        },
      }),
    );
    // the retargeting frame still lays out the start padding
    await tester.pumpWidget(_render(tree));
    expect(_innermostPadding(tester).left, start);

    await tester.pump(const Duration(milliseconds: 150));
    final mid = _innermostPadding(tester).left;
    expect(mid, greaterThan(start));

    await tester.pump(const Duration(seconds: 1));
    // the % reference (the incoming max width) does not move between the
    // two frames, so the end padding is exactly twice the start
    final end = _innermostPadding(tester).left;
    expect(end, closeTo(start * 2, 0.5));
    expect(mid, lessThan(end));
  });

  testWidgets('without transition the padding change snaps', (tester) async {
    final tree = _treeWith({
      'style': {'width': 200, 'height': 100, 'padding': 8},
    });
    await tester.pumpWidget(_render(tree));
    expect(_innermostPadding(tester), const EdgeInsets.all(8));

    tree.applyFrame(
      _propsFrame({
        'style': {'width': 200, 'height': 100, 'padding': 32},
      }),
    );
    await tester.pumpWidget(_render(tree));
    expect(_innermostPadding(tester), const EdgeInsets.all(32));
  });
}
