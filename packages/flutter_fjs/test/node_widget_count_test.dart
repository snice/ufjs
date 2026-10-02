// specs/157: how many Elements one node costs. On a 4050-element page every
// one of them is allocated, built and later collected — the build and GC
// that dominated the display frame on an iPhone (specs/154). flat-4050's cell
// (a decorated view with a margin, holding a text) was 13 Elements; this pins
// what it is now, so a wrapper added to every node shows up here first.
// specs/191: the margin folds into the background box (FjsBox), 9/6 → 8/5.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets("flat-4050's cell", (tester) async {
    final b = <int>[];
    var next = 1;
    void u32(int v) {
      final d = ByteData(4)..setUint32(0, v, Endian.little);
      b.addAll(d.buffer.asUint8List());
    }

    void s32(String s) {
      final x = utf8.encode(s);
      u32(x.length);
      b.addAll(x);
    }

    int node(int p, String tag, String style, {String? text}) {
      final id = next++;
      final t = utf8.encode(tag);
      b
        ..add(UiOpCode.create)
        ..addAll((ByteData(4)..setUint32(0, id, Endian.little)).buffer.asUint8List())
        ..add(t.length)
        ..add(0)
        ..addAll(t);
      b.add(UiOpCode.setProps);
      u32(id);
      s32('{"style":{$style}}');
      if (text != null) {
        b.add(UiOpCode.setText);
        u32(id);
        s32(text);
      }
      b.add(UiOpCode.insert);
      u32(p);
      u32(id);
      u32(0x7fffffff);
      return id;
    }

    final root = node(0, 'view', '');
    final row = node(root, 'view', '"flexDirection":"row"');
    final cell = node(row, 'view', '"backgroundColor":"#85d8b4","margin":0.5');
    node(cell, 'text', '"fontSize":5,"lineHeight":"5px"', text: '7');
    final tree = MirrorTree()..applyFrame(Uint8List.fromList(b));
    await tester.pumpWidget(
      MaterialApp(
        home: Align(
          alignment: Alignment.topLeft,
          child: FjsNodeRenderer(tree: tree, ids: tree.rootChildren, dispatch: (_, __, {String? text}) {}),
        ),
      ),
    );
    // from the row's item (the cell's shrink marker) down to the glyphs
    final top = find.byKey(ValueKey<int>(cell)).evaluate().first;
    var elements = 0, renderObjects = 0;
    void walk(Element e) {
      elements++;
      if (e is RenderObjectElement) renderObjects++;
      e.visitChildren(walk);
    }

    walk(top);
    expect((elements, renderObjects), (8, 5));
  });
}
