// CSS transitions for paint-only native wrappers.
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

MirrorTree _treeWith(String propsJson) {
  final w = _W();
  w.u8(UiOpCode.create);
  w.u32(1);
  w.u16(4);
  w.str('view');
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final json = utf8.encode(propsJson);
  w.u32(json.length);
  w.raw(json);
  w.u8(UiOpCode.insert);
  w.u32(0);
  w.u32(1);
  w.u32(0);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

void _setProps(MirrorTree tree, String propsJson) {
  final w = _W();
  w.u8(UiOpCode.setProps);
  w.u32(1);
  final json = utf8.encode(propsJson);
  w.u32(json.length);
  w.raw(json);
  tree.applyFrame(Uint8List.fromList(w.b));
}

Widget _render(MirrorTree tree) {
  return MaterialApp(
    home: Center(
      child: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        dispatch: (_, __, {text}) {},
      ),
    ),
  );
}

Transform _outerTransform(WidgetTester tester) {
  return tester.widget<Transform>(find.byType(Transform).first);
}

void main() {
  testWidgets('transition animates transform style updates', (tester) async {
    final tree = _treeWith(
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear"}}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_outerTransform(tester).transform.storage[12], 0);

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear",'
      '"transform":"translate(100px, 0)"}}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_outerTransform(tester).transform.storage[12], 0);

    await tester.pump(const Duration(milliseconds: 100));
    final mid = _outerTransform(tester).transform.storage[12];
    expect(mid, greaterThan(0));
    expect(mid, lessThan(100));

    await tester.pump(const Duration(milliseconds: 100));
    expect(_outerTransform(tester).transform.storage[12], 100);
  });

  testWidgets('transition animates opacity style updates', (tester) async {
    final tree = _treeWith(
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"opacity 100ms linear","opacity":1}}',
    );
    await tester.pumpWidget(_render(tree));

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"opacity 100ms linear","opacity":0.2}}',
    );
    await tester.pumpWidget(_render(tree));
    await tester.pump(const Duration(milliseconds: 50));
    final mid = tester.widget<Opacity>(find.byType(Opacity).first).opacity;
    expect(mid, greaterThan(0.2));
    expect(mid, lessThan(1));

    await tester.pump(const Duration(milliseconds: 50));
    expect(
      tester.widget<Opacity>(find.byType(Opacity).first).opacity,
      closeTo(0.2, 1e-9),
    );
  });

  testWidgets('removing transform from transition makes transform immediate', (
    tester,
  ) async {
    final tree = _treeWith(
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear"}}',
    );
    await tester.pumpWidget(_render(tree));

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"opacity 100ms linear",'
      '"transform":"translate(100px, 0)"}}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_outerTransform(tester).transform.storage[12], 100);
  });

  testWidgets(
    'transform transition can restart after transition was disabled',
    (tester) async {
      final tree = _treeWith(
        '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
        '"transition":"transform 200ms linear"},'
        '"onTouchstart":true,"onTouchmove":true,'
        '"onTouchend":true,"onTouchcancel":true}',
      );
      await tester.pumpWidget(_render(tree));

      _setProps(
        tree,
        '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
        '"transition":"transform 200ms linear",'
        '"transform":"translate(100px, 0)"}}',
      );
      await tester.pumpWidget(_render(tree));
      await tester.pump(const Duration(milliseconds: 200));
      expect(_outerTransform(tester).transform.storage[12], 100);

      _setProps(
        tree,
        '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
        '"transition":"none","transform":null}}',
      );
      await tester.pumpWidget(_render(tree));
      expect(_outerTransform(tester).transform.storage[12], 0);

      _setProps(
        tree,
        '{"style":{"transition":"transform 200ms linear",'
        '"transform":"translate(100px, 0)"}}',
      );
      await tester.pumpWidget(_render(tree));
      expect(_outerTransform(tester).transform.storage[12], 0);

      await tester.pump(const Duration(milliseconds: 100));
      final mid = _outerTransform(tester).transform.storage[12];
      expect(mid, greaterThan(0));
      expect(mid, lessThan(100));
    },
  );

  testWidgets('disabling transform transition clears stale animation state', (
    tester,
  ) async {
    final tree = _treeWith(
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear"},'
      '"onTouchstart":true,"onTouchmove":true,'
      '"onTouchend":true,"onTouchcancel":true}',
    );
    await tester.pumpWidget(_render(tree));

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear",'
      '"transform":"translate(100px, 0)"}}',
    );
    await tester.pumpWidget(_render(tree));
    await tester.pump(const Duration(milliseconds: 80));
    expect(_outerTransform(tester).transform.storage[12], greaterThan(0));

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"none","transform":null}}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_outerTransform(tester).transform.storage[12], 0);

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear",'
      '"transform":"translate(100px, 0)"}}',
    );
    await tester.pumpWidget(_render(tree));
    expect(_outerTransform(tester).transform.storage[12], 0);

    await tester.pump(const Duration(milliseconds: 80));
    final restarted = _outerTransform(tester).transform.storage[12];
    expect(restarted, greaterThan(0));
    expect(restarted, lessThan(100));
  });

  testWidgets('transform transition retargets from current animated position', (
    tester,
  ) async {
    final tree = _treeWith(
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear"},'
      '"onTouchstart":true,"onTouchmove":true,'
      '"onTouchend":true,"onTouchcancel":true}',
    );
    await tester.pumpWidget(_render(tree));

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear",'
      '"transform":"translate(100px, 0)"}}',
    );
    await tester.pumpWidget(_render(tree));
    await tester.pump(const Duration(milliseconds: 80));
    final firstMid = _outerTransform(tester).transform.storage[12];
    expect(firstMid, greaterThan(0));
    expect(firstMid, lessThan(100));

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear"}}',
    );
    await tester.pumpWidget(_render(tree));
    final returnStart = _outerTransform(tester).transform.storage[12];
    expect(returnStart, closeTo(firstMid, 1e-6));

    await tester.pump(const Duration(milliseconds: 80));
    final returnMid = _outerTransform(tester).transform.storage[12];
    expect(returnMid, greaterThan(0));
    expect(returnMid, lessThan(firstMid));

    _setProps(
      tree,
      '{"style":{"width":100,"height":100,"backgroundColor":"#ffffff",'
      '"transition":"transform 200ms linear",'
      '"transform":"translate(100px, 0)"}}',
    );
    await tester.pumpWidget(_render(tree));
    final secondStart = _outerTransform(tester).transform.storage[12];
    expect(secondStart, closeTo(returnMid, 1e-6));

    await tester.pump(const Duration(milliseconds: 80));
    final secondMid = _outerTransform(tester).transform.storage[12];
    expect(secondMid, greaterThan(secondStart));
    expect(secondMid, lessThan(100));
  });
}
