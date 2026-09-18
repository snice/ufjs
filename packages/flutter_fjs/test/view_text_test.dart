// `<view>裸文字</view>`：Vue 把单个字符串子节点交给 setElementText，文字落在
// view 节点自身（web 上是文本节点）。Dart 的 view 适配器要把它合成为一个
// Text 子节点——曾经整段丢弃，页面只剩盒子（spec 041 实机对拍修出）。
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

MirrorTree _tree() {
  final w = _W();
  // root 1 > view 2 (element text on itself) > text 3 (an explicit child, to
  // prove both render and keep their order)
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.create);
  w.u32(2);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.setText);
  w.u32(2);
  final own = utf8.encode('自身文本');
  w.u32(own.length);
  w.raw(own);
  w.u8(UiOpCode.create);
  w.u32(3);
  w.u16(4);
  w.str('text');
  w.u8(UiOpCode.setText);
  w.u32(3);
  final child = utf8.encode('子文本');
  w.u32(child.length);
  w.raw(child);
  w.u8(UiOpCode.insert);
  w.u32(1);
  w.u32(2);
  w.u32(0);
  w.u8(UiOpCode.insert);
  w.u32(2);
  w.u32(3);
  w.u32(0);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

void main() {
  testWidgets('a view with element text renders it', (tester) async {
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
    expect(find.text('自身文本'), findsOneWidget);
    expect(find.text('子文本'), findsOneWidget);
    // order: own text first, then the children
    final ownTop = tester.getTopLeft(find.text('自身文本')).dy;
    final childTop = tester.getTopLeft(find.text('子文本')).dy;
    expect(ownTop, lessThan(childTop));
  });

  testWidgets('whitespace-only element text stays invisible', (tester) async {
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.setText);
    w.u32(1);
    final ws = utf8.encode('  ');
    w.u32(ws.length);
    w.raw(ws);
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));
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
    // no exception, and nothing painted for the blank run
    expect(find.byType(Text), findsNothing);
  });
}
