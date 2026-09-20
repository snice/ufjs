// `transition: border-color` on dashed / per-side borders (spec 078): those
// sides paint through CustomPaint, not the BoxDecoration, so the tween rides
// the painter — geometry (widths, kinds) always takes the end style, only
// the colours interpolate. The uniform solid stroke is decorationTrack's
// (spec 045) and not re-tested here.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/dashed_border.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/render/style_parse.dart';
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

FjsDashedBorderPainter? _dashedPainter(WidgetTester tester) {
  for (final custom in tester.widgetList<CustomPaint>(
    find.byType(CustomPaint),
  )) {
    if (custom.foregroundPainter is FjsDashedBorderPainter) {
      return custom.foregroundPainter! as FjsDashedBorderPainter;
    }
  }
  return null;
}

FjsSideBorderPainter? _sidePainter(WidgetTester tester) {
  for (final custom in tester.widgetList<CustomPaint>(
    find.byType(CustomPaint),
  )) {
    if (custom.foregroundPainter is FjsSideBorderPainter) {
      return custom.foregroundPainter! as FjsSideBorderPainter;
    }
  }
  return null;
}

Map<String, Object?> _props(String borderColor) => {
  'style': {
    'width': 100,
    'height': 60,
    'border': '4px dashed $borderColor',
    'backgroundColor': '#ffffff',
    'transition': 'border-color 0.3s',
  },
};

void main() {
  testWidgets('a dashed border colour interpolates', (tester) async {
    final tree = _treeWith(_props('#000000'));
    await tester.pumpWidget(_render(tree));
    final start = _dashedPainter(tester)!.color;
    expect(start, const Color(0xFF000000));

    tree.applyFrame(_propsFrame(_props('#ffffff')));
    await tester.pumpWidget(_render(tree));
    // the retargeting frame still paints the start colour
    expect(_dashedPainter(tester)!.color, start);

    await tester.pump(const Duration(milliseconds: 150));
    final mid = _dashedPainter(tester)!.color;
    expect(mid, isNot(const Color(0xFF000000)));
    expect(mid, isNot(const Color(0xFFFFFFFF)));

    await tester.pump(const Duration(seconds: 1));
    expect(_dashedPainter(tester)!.color, const Color(0xFFFFFFFF));
  });

  testWidgets('a per-side (border-bottom + radius) colour interpolates', (
    tester,
  ) async {
    Map<String, Object?> props(String color) => {
      'style': {
        'width': 100,
        'height': 60,
        'borderBottom': '2px solid $color',
        'borderRadius': '8px',
        'transition': 'border-color 0.3s',
      },
    };
    final tree = _treeWith(props('#000000'));
    await tester.pumpWidget(_render(tree));
    final start = _sidePainter(tester)!.borders.bottom!;
    expect(start.color, const Color(0xFF000000));

    tree.applyFrame(_propsFrame(props('#ffffff')));
    await tester.pumpWidget(_render(tree));
    await tester.pump(const Duration(milliseconds: 150));
    final mid = _sidePainter(tester)!.borders.bottom!;
    expect(mid.color, isNot(const Color(0xFF000000)));
    expect(mid.color, isNot(const Color(0xFFFFFFFF)));
    // geometry takes the end style throughout: widths and kinds are the
    // END declaration's, as CSS transitions only the colour
    expect(mid.width, 2);
    expect(mid.kind, FjsBorderStyle.solid);

    await tester.pump(const Duration(seconds: 1));
    expect(
      _sidePainter(tester)!.borders.bottom!.color,
      const Color(0xFFFFFFFF),
    );
  });
}
