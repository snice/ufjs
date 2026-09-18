// pseudo.vue 悬停面板的布局回归：`.row.gap`（flexDirection row + flexWrap
// wrap）里的普通 view 盒子应当按内容收紧、横向排布，而不是拉满宽度竖着堆。
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

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    u16(tag.length);
    str(tag);
  }

  void style(int id, int sid) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(sid);
    u32(0);
  }

  void define(int id, Map<String, Object?> style) {
    final json = utf8.encode(jsonEncode(style));
    u8(UiOpCode.defineStyle);
    u32(id);
    u32(json.length);
    raw(json);
  }

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }
}

MirrorTree _tree() {
  final w = _W();
  final box = <String, Object?>{
    'backgroundColor': '#ffffff',
    'borderWidth': 1,
    'borderColor': '#dddddd',
    'borderRadius': 8,
    'padding': '10 16',
  };
  w.create(1, 'view');
  w.define(10, {'padding': 16});
  w.style(1, 10);
  w.create(2, 'view');
  w.define(11, {'flexDirection': 'row', 'flexWrap': 'wrap', 'gap': 8});
  w.style(2, 11);
  w.create(3, 'view');
  w.define(12, box);
  w.style(3, 12);
  w.create(4, 'text');
  w.u8(UiOpCode.setText);
  w.u32(4);
  final t1 = utf8.encode('hover 我');
  w.u32(t1.length);
  w.raw(t1);
  w.create(5, 'view');
  w.style(5, 12);
  w.create(6, 'text');
  w.u8(UiOpCode.setText);
  w.u32(6);
  final t2 = utf8.encode('hover + active');
  w.u32(t2.length);
  w.raw(t2);
  w.insert(1, 2, 0);
  w.insert(2, 3, 0);
  w.insert(3, 4, 0);
  w.insert(2, 5, 1);
  w.insert(5, 6, 0);
  w.insert(0, 1, 0);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

void main() {
  testWidgets('boxes in a wrapping row hug their content and sit inline', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(500, 640);
    addTearDown(tester.view.reset);
    final tree = _tree();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FjsNodeRenderer(
            tree: tree,
            ids: tree.rootChildren,
            dispatch: (_, __, {String? text}) {},
          ),
        ),
      ),
    );
    await tester.pump();

    final box1 = tester.renderObject<RenderBox>(find.byKey(ValueKey(3)));
    final box2 = tester.renderObject<RenderBox>(find.byKey(ValueKey(5)));
    debugPrint('box1 size: ${box1.size}, box2 size: ${box2.size}');
    final wraps = tester.widgetList<Wrap>(find.byType(Wrap));
    for (final w in wraps) {
      debugPrint(
        'wrap direction: ${w.direction}, alignment: ${w.alignment}, cross: ${w.crossAxisAlignment}',
      );
    }
    debugPrint('wrap count: ${wraps.length}');
    final boxes = tester.renderObjectList<RenderBox>(find.byType(Flex));
    for (final b in boxes) {
      debugPrint('flex size: ${b.size}');
    }
    // 盒子按内容收紧（文字 + 左右 32 padding + 2 边框），不是拉满 328
    expect(box1.size.width, lessThan(150));
    expect(box2.size.width, lessThan(250));
    // 横向排布：两个盒子的顶端齐平
    expect(
      (box1.localToGlobal(Offset.zero).dy - box2.localToGlobal(Offset.zero).dy)
          .abs(),
      lessThan(1),
    );
  });
}
