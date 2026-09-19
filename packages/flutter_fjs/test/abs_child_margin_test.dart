// CSS margins on an absolutely positioned box offset it from its inset
// without shrinking a declared size — `top: 0; height: 8px; margin-top: 4px`
// puts the border box at 4. The slot therefore has to expand by the margin
// extent (vant's badge dot: `translate(50%,-50%)` over `margin-top: 4px`
// was being squeezed to half height by the tight Positioned slot). This
// pins the shape, the position, and the CSS centering on the wrapper's
// corner.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_test/flutter_test.dart';

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

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    u16(tag.length);
    str(tag);
  }

  void props(int id, String json) {
    u8(UiOpCode.setProps);
    u32(id);
    final bytes = utf8.encode(json);
    u32(bytes.length);
    b.addAll(bytes);
  }

  void insert(int parent, int child) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(0x7fffffff);
  }
}

/// van-tabbar-item's icon in miniature: a relative wrapper (22x28, nudged
/// to x=56) holding an icon and an 8px dot pinned to its top-right corner
/// with `margin-top: 4px` and `translate(50%,-50%)`.
MirrorTree _dotTree() {
  final w = _W();
  w.create(1, 'view');
  w.props(1, '{"style":{"width":134,"height":50,"position":"relative"}}');
  w.insert(0, 1);
  w.create(2, 'view');
  w.props(2, '{"style":{"position":"relative","width":22,"height":28,'
      '"display":"inline-block","marginLeft":56}}');
  w.insert(1, 2);
  w.create(3, 'view');
  w.props(3, '{"style":{"width":22,"height":24}}');
  w.insert(2, 3);
  w.create(4, 'view');
  w.props(
    4,
    '{"style":{"position":"absolute","top":0,"right":0,"marginTop":4,'
    '"width":8,"height":8,"borderRadius":"100%","backgroundColor":"#ee0a24",'
    '"transform":"translate(50%,-50%)"}}',
  );
  w.insert(2, 4);
  final tree = MirrorTree();
  tree.applyFrame(Uint8List.fromList(w.b));
  return tree;
}

Widget _render(MirrorTree tree) {
  return MaterialApp(
    home: Align(
      alignment: Alignment.topLeft,
      child: FjsNodeRenderer(
        tree: tree,
        ids: tree.rootChildren,
        dispatch: (_, __, {text}) {},
      ),
    ),
  );
}

void main() {
  testWidgets('an abs dot keeps its declared size and centers on the corner',
    (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(402, 874);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_render(_dotTree()));

    RenderBox? dot;
    void seek(RenderObject o) {
      if (o is RenderDecoratedBox) {
        final d = o.decoration as BoxDecoration;
        if (d.color == const Color(0xFFEE0A24)) {
          dot = o;
          return;
        }
      }
      o.visitChildren(seek);
    }

    seek(tester.renderObject(find.byKey(const ValueKey(4)).first));
    final d = dot!;
    // the margin does not shrink the declared size
    expect(d.size, const Size(8, 8));
    // wrapper top-right corner = (56 + 22, 0); the dot centers 4px below it
    // (top 0, margin-top 4, translate -50%)
    final center = d.localToGlobal(Offset(4, 4));
    expect(center.dx, closeTo(78, 0.01));
    expect(center.dy, closeTo(4, 0.01));
  });
}
