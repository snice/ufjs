// `width: fit-content` (specs/138). Used to read as absent — auto — so a
// box between `left: 0; right: 0` filled the whole line (vant's text Toast,
// the centred Popup) and a column child stretched. Shrink-to-fit is
// min(max-content, available), clamped by min/max-width, and auto margins
// centre the result.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/render/style.dart';
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

  void bytes(List<int> l) {
    u32(l.length);
    b.addAll(l);
  }
}

void _create(_W w, int id, String tag, int parent, {Map? style, String? text}) {
  w.u8(UiOpCode.create);
  w.u32(id);
  final t = utf8.encode(tag);
  w.u16(t.length);
  w.b.addAll(t);
  if (text != null) {
    w.u8(UiOpCode.setText);
    w.u32(id);
    w.bytes(utf8.encode(text));
  }
  if (style != null) {
    w.u8(UiOpCode.setProps);
    w.u32(id);
    w.bytes(utf8.encode(jsonEncode({'style': style})));
  }
  w.u8(UiOpCode.insert);
  w.u32(parent);
  w.u32(id);
  w.u32(0x7fffffff);
}

const _stage = {'width': 400, 'height': 600, 'position': 'relative'};
const _text = {'fontSize': 14, 'lineHeight': '20px'};

/// root(400×600) > box(absolute, left/right 0, margin 0 auto) > text
MirrorTree _positioned(String label, Map<String, Object> extra) {
  final w = _W();
  _create(w, 1, 'view', 0, style: _stage);
  _create(
    w,
    2,
    'view',
    1,
    style: {
      'position': 'absolute',
      'top': 100,
      'left': 0,
      'right': 0,
      'margin': '0 auto',
      'width': 'fit-content',
      'padding': '8px 12px',
      'backgroundColor': '#000000',
      ...extra,
    },
  );
  _create(w, 3, 'text', 2, style: _text, text: label);
  return MirrorTree()
    ..applyFrame(Uint8List.fromList(w.b))
    ..flushDirty();
}

/// root(400×600 column) > box(fit-content, margin 0 auto) > text
MirrorTree _inFlow(String label) {
  final w = _W();
  _create(w, 1, 'view', 0, style: _stage);
  _create(
    w,
    2,
    'view',
    1,
    style: {
      'width': 'fit-content',
      'margin': '0 auto',
      'padding': '8px 12px',
      'backgroundColor': '#000000',
    },
  );
  _create(w, 3, 'text', 2, style: _text, text: label);
  return MirrorTree()
    ..applyFrame(Uint8List.fromList(w.b))
    ..flushDirty();
}

Widget _render(MirrorTree tree) => MaterialApp(
  home: Align(
    alignment: Alignment.topLeft,
    child: FjsNodeRenderer(
      tree: tree,
      ids: tree.rootChildren,
      dispatch: (_, _, {String? text}) {},
    ),
  ),
);

Rect _boxOf(WidgetTester tester, String label) {
  // the box is the nearest painted ancestor of the text that is wider than
  // the text by its horizontal padding
  final text = tester.getRect(find.text(label));
  final boxes = find.ancestor(
    of: find.text(label),
    matching: find.byWidgetPredicate(
      (w) => w is DecoratedBox || w is Container || w is ColoredBox,
    ),
  );
  for (final e in boxes.evaluate()) {
    final r = tester.getRect(find.byWidget(e.widget).first);
    if (r.width >= text.width + 24 - 0.5 && r.width < 400) return r;
  }
  fail('no painted box around "$label"');
}

void main() {
  testWidgets('a positioned fit-content box shrinks to its text and centres', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_positioned('来自 showToast', const {})));
    final text = tester.getRect(find.text('来自 showToast'));
    final box = _boxOf(tester, '来自 showToast');
    expect(box.width, closeTo(text.width + 24, 1));
    expect(box.center.dx, closeTo(200, 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('min-width holds a short positioned fit-content box open', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_positioned('好', const {'minWidth': 96})));
    final box = _boxOf(tester, '好');
    expect(box.width, closeTo(96, 1));
    expect(box.center.dx, closeTo(200, 1));
  });

  testWidgets('a long text wraps at max-width instead of filling the line', (
    tester,
  ) async {
    final long = '很长的提示文字' * 12;
    await tester.pumpWidget(_render(_positioned(long, const {'maxWidth': '70%'})));
    final box = _boxOf(tester, long);
    expect(box.width, closeTo(280, 1));
    expect(box.center.dx, closeTo(200, 1));
    // wrapped onto more than one 20px line
    expect(tester.getRect(find.text(long)).height, greaterThan(21));
  });

  testWidgets('a column child with fit-content is not stretched', (
    tester,
  ) async {
    await tester.pumpWidget(_render(_inFlow('标签')));
    final text = tester.getRect(find.text('标签'));
    final box = _boxOf(tester, '标签');
    expect(box.width, closeTo(text.width + 24, 1));
    expect(box.center.dx, closeTo(200, 1));
  });

  test('unsupported size keywords are named, supported ones are not', () {
    String? bad(Map<String, Object> style) =>
        FjsStyle({'style': style}).unsupportedSizeKeyword;
    expect(bad({'width': 'fit-content'}), isNull);
    expect(bad({'width': '-webkit-fit-content'}), isNull);
    expect(bad({'height': 'fit-content'}), isNull);
    expect(bad({'width': 100}), isNull);
    expect(bad({'width': 'max-content'}), 'width: max-content');
    expect(bad({'minWidth': 'min-content'}), 'min-width: min-content');
    expect(bad({'maxWidth': 'fit-content'}), 'max-width: fit-content');
    expect(bad({'width': 'fit-content(200px)'}), 'width: fit-content(200px)');
    expect(FjsStyle({'style': {'width': 'fit-content'}}).widthFitContent, isTrue);
  });

  // vant's loading Toast: `box-sizing: content-box; width: 88px;
  // min-height: 88px; padding: 16px` between `left: 0; right: 0` with
  // `margin: 0 auto`. The slot and min-height took 88 as the border box:
  // the 120 box was squeezed, its content ran off to the right.
  testWidgets('a positioned content-box box adds its padding to the slot', (
    tester,
  ) async {
    final w = _W();
    _create(w, 1, 'view', 0, style: _stage);
    _create(
      w,
      2,
      'view',
      1,
      style: {
        'position': 'absolute',
        'top': 100,
        'left': 0,
        'right': 0,
        'margin': '0 auto',
        'boxSizing': 'content-box',
        'width': 88,
        'minHeight': 88,
        'padding': 16,
        'alignItems': 'center',
        'backgroundColor': '#000000',
      },
    );
    _create(w, 3, 'text', 2, style: _text, text: '加载中');
    final tree = MirrorTree()
      ..applyFrame(Uint8List.fromList(w.b))
      ..flushDirty();
    await tester.pumpWidget(_render(tree));
    final box = _boxOf(tester, '加载中');
    expect(box.width, closeTo(120, 1));
    expect(box.height, closeTo(120, 1));
    expect(box.center.dx, closeTo(200, 1));
    expect(tester.getRect(find.text('加载中')).center.dx, closeTo(200, 1));
  });
}

