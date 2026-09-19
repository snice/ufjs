// specs/069 验证期：vant 三页在 iOS 模拟器上与 web 逐屏对拍时修掉的布局缺口，
// 每条对应一个真实组件（注释里标出）。
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_fjs/src/render/style_parse.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'package:flutter_fjs/src/widgets/button.dart' show fjsButtonPressMaskKey;
import 'package:flutter_fjs/src/widgets/svg.dart' show FjsSvg;

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

  void text(int id, String t) {
    final bytes = utf8.encode(t);
    u8(UiOpCode.setText);
    u32(id);
    u32(bytes.length);
    raw(bytes);
  }

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }
}



var _nextStyle = 1000;

extension on _W {
  void props(int id, Map<String, Object?> props) {
    final json = utf8.encode(jsonEncode(props));
    u8(UiOpCode.setProps);
    u32(id);
    u32(json.length);
    raw(json);
  }

  /// create + define + setStyle in one go; [active] is the `:active` variant.
  void node(int id, String tag, Map<String, Object?> style, {Map<String, Object?>? active}) {
    create(id, tag);
    final sid = _nextStyle++;
    define(sid, style);
    var aid = 0;
    if (active != null) {
      aid = _nextStyle++;
      define(aid, active);
    }
    u8(UiOpCode.setStyle);
    u32(id);
    u32(sid);
    u32(aid);
  }
}

typedef _Dispatched = List<String>;

/// The tree's root is the PAGE root, whose children grow to fill it (the
/// `fjs-page-entry > *` rule) — so each test's own box hangs one level down,
/// under a plain column, like a real page's content does.
Future<(MirrorTree, _Dispatched)> _pump(WidgetTester tester, _W w, {double width = 400}) async {
  w
    ..create(99, 'view')
    ..insert(99, 1, 0)
    ..insert(0, 99, 0);
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = Size(width, 640);
  addTearDown(tester.view.reset);
  final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
  final got = <String>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FjsNodeRenderer(
              tree: tree,
              ids: tree.rootChildren,
              dispatch: (id, ev, {String? text}) => got.add('$id:$ev'),
            ),
          ],
        ),
      ),
    ),
  );
  await tester.pump();
  return (tree, got);
}

/// The painted rect of node [id]'s innermost box (after its transforms).
Rect _paintedRect(WidgetTester tester, int id) {
  RenderBox? inner;
  void walk(RenderObject o) {
    if (o is RenderBox) inner = o;
    if (o is RenderDecoratedBox) return;
    o.visitChildren(walk);
  }

  walk(tester.renderObject(find.byKey(ValueKey(id)).first));
  final b = inner!;
  return Rect.fromPoints(
    b.localToGlobal(Offset.zero),
    b.localToGlobal(b.size.bottomRight(Offset.zero)),
  );
}

void main() {
  // .van-cell::after：`left/right: 16px; bottom: 0` 相对 padding 盒，不是内容盒
  testWidgets('absolute offsets measure from the padding edge', (tester) async {
    final w = _W()
      ..node(1, 'view', {'position': 'relative', 'flexDirection': 'row', 'padding': '10px 16px'})
      ..node(2, 'view', {'flex': 1, 'height': 20})
      ..node(3, 'view', {'position': 'absolute', 'left': 16, 'right': 16, 'bottom': 0, 'height': 1, 'backgroundColor': '#ebedf0'})
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final r = _paintedRect(tester, 3);
    expect(r.left, 16);
    expect(r.right, 384);
    expect(r.bottom, 40);
  });

  // [class*=van-hairline]::after：`inset: -50%` 再 `scale(.5)`，要按盒子
  // 实际尺寸解析百分比（收缩的列盒里 constraints.maxHeight 不是它的高度）
  testWidgets('percent insets resolve against the laid-out box', (tester) async {
    final w = _W()
      ..node(1, 'view', {'position': 'relative', 'padding': '16px 8px'})
      ..node(2, 'view', {'height': 40})
      ..node(3, 'view', {
        'position': 'absolute', 'top': '-50%', 'right': '-50%', 'bottom': '-50%', 'left': '-50%',
        'borderWidth': '0 1px 1px 0', 'border': '0 solid #ebedf0', 'transform': 'scale(.5)',
      })
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final r = _paintedRect(tester, 3);
    // the padding box: 400 × (16 + 40 + 16)
    expect(r.left, closeTo(0, 0.01));
    expect(r.top, closeTo(0, 0.01));
    expect(r.right, closeTo(400, 0.01));
    expect(r.bottom, closeTo(72, 0.01));
  });

  // .van-dialog：`left: 0; right: 0; width: 320px; margin: 0 auto` 居中，
  // `translate3d(0, -50%, 0)` 按自身高度上移
  testWidgets('auto margins centre and % translations use the own size', (tester) async {
    final w = _W()
      ..node(1, 'view', {'position': 'relative', 'height': 400})
      ..node(2, 'view', {
        'position': 'absolute', 'top': '45%', 'left': 0, 'right': 0, 'width': 320, 'height': 100,
        'margin': '0 auto', 'transform': 'translate3d(0, -50%, 0)', 'backgroundColor': '#fff',
      })
      ..insert(1, 2, 0);
    await _pump(tester, w);
    final r = _paintedRect(tester, 2);
    expect(r.left, closeTo(40, 0.01)); // (400 - 320) / 2
    expect(r.top, closeTo(180 - 50, 0.01)); // 45% of 400, minus half of 100
    expect(r.width, closeTo(320, 0.01));
  });

  // .van-grid-item：`flex-basis: 33.333%` 三列
  testWidgets('flex-basis sizes wrapped items', (tester) async {
    final w = _W()..node(1, 'view', {'flexDirection': 'row', 'flexWrap': 'wrap'});
    for (var i = 0; i < 3; i++) {
      w
        ..node(2 + i, 'view', {'flexBasis': '25%', 'height': 10})
        ..insert(1, 2 + i, i);
    }
    await _pump(tester, w);
    for (var i = 0; i < 3; i++) {
      final box = tester.renderObject<RenderBox>(find.byKey(ValueKey(2 + i)).first);
      expect(box.size.width, closeTo(100, 0.01));
      expect(box.localToGlobal(Offset.zero).dx, closeTo(100.0 * i, 0.01));
    }
  });

  // .van-divider--content-left::before：`flex: 1; max-width: 10%`，余下的给 ::after
  testWidgets('a capped growing item stops at its cap', (tester) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row', 'alignItems': 'center'})
      ..node(2, 'view', {'flex': 1, 'maxWidth': '10%', 'height': 1})
      ..node(3, 'view', {'width': 60, 'height': 20})
      ..node(4, 'view', {'flex': 1, 'height': 1})
      ..insert(1, 2, 0)
      ..insert(1, 3, 1)
      ..insert(1, 4, 2);
    await _pump(tester, w);
    final before = tester.renderObject<RenderBox>(find.byKey(const ValueKey(2)).first);
    final after = tester.renderObject<RenderBox>(find.byKey(const ValueKey(4)).first);
    expect(before.size.width, closeTo(40, 0.01));
    expect(after.size.width, closeTo(400 - 40 - 60, 0.01));
  });

  // .van-nav-bar__title：flex 行里 `margin: 0 auto` 居中（左右按钮是绝对定位）
  testWidgets('main-axis auto margins centre a flex item', (tester) async {
    final w = _W()
      ..node(1, 'view', {'position': 'relative', 'flexDirection': 'row', 'alignItems': 'center', 'height': 46})
      ..node(2, 'view', {'position': 'absolute', 'left': 0, 'top': 0, 'bottom': 0, 'width': 60})
      ..node(3, 'view', {'maxWidth': '60%', 'margin': '0 auto', 'width': 80, 'height': 20})
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final r = _paintedRect(tester, 3);
    expect(r.left, closeTo(160, 0.01));
    expect(r.width, closeTo(80, 0.01));
  });

  // `margin-left: auto` 把条目推到行尾；有 flex-grow 的兄弟时没有剩余空间
  testWidgets('a single auto margin pushes, a growing sibling wins', (tester) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row'})
      ..node(2, 'view', {'width': 50, 'height': 10})
      ..node(3, 'view', {'width': 50, 'height': 10, 'marginLeft': 'auto'})
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    expect(_paintedRect(tester, 3).left, closeTo(350, 0.01));

    final g = _W()
      ..node(1, 'view', {'flexDirection': 'row'})
      ..node(2, 'view', {'flex': 1, 'height': 10})
      ..node(3, 'view', {'width': 50, 'height': 10, 'marginLeft': 'auto'})
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, g);
    expect(_paintedRect(tester, 2).width, closeTo(350, 0.01));
    expect(_paintedRect(tester, 3).left, closeTo(350, 0.01));
  });

  // 块级居中：列容器里 `width: 300px; margin: 0 auto`
  testWidgets('cross-axis auto margins centre a sized item', (tester) async {
    final w = _W()
      ..node(1, 'view', {})
      ..node(2, 'view', {'width': 300, 'height': 10, 'margin': '0 auto'})
      ..insert(1, 2, 0);
    await _pump(tester, w);
    expect(_paintedRect(tester, 2).left, closeTo(50, 0.01));
  });

  // .van-tabbar-item__text：align-items: center 的列里，只含文字的 div 收缩居中
  testWidgets('a text-only box shrinks and centres in a centring column', (tester) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row', 'height': 50})
      ..node(2, 'view', {'display': 'flex', 'flex': 1, 'color': '#1989fa', 'cursor': 'pointer', 'flexDirection': 'column', 'alignItems': 'center', 'justifyContent': 'center', 'fontSize': 12, 'lineHeight': 1})
      ..node(3, 'view', {'color': '#1989fa', 'fontSize': 12, 'lineHeight': '1'})
      // a slot renders as a fragment: two empty text anchors around the text
      ..create(5, 'text')
      ..create(4, 'text')
      ..text(4, '首页')
      ..create(6, 'text')
      ..insert(3, 5, 0)
      ..insert(3, 4, 1)
      ..insert(3, 6, 2)
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    await _pump(tester, w);
    final r = tester.renderObject<RenderBox>(find.byKey(const ValueKey(3)).first);
    final at = r.localToGlobal(Offset.zero);
    expect(r.size.width, lessThan(40)); // two 12px glyphs, not the whole line
    expect(at.dx + r.size.width / 2, closeTo(200, 1));
  });

  // .van-field：wrap 行里 label 定宽 + value `flex: 1`，value 里 input 100% +
  // 清除图标——CSS 按基准尺寸 0 断行，value 留在 label 旁边并长满剩余
  testWidgets('a growing item in a wrap row stays on the line', (tester) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row', 'flexWrap': 'wrap', 'padding': '10px 16px'})
      ..node(2, 'view', {'flex': 'none', 'width': 86.8, 'marginRight': 12, 'height': 24})
      ..node(3, 'view', {'flex': 1})
      ..node(4, 'view', {'display': 'flex', 'alignItems': 'center', 'flexDirection': 'row'})
      ..node(5, 'input', {'width': '100%', 'minWidth': 0, 'height': 24})
      ..node(6, 'view', {'flexShrink': 0, 'width': 34, 'height': 24})
      ..insert(4, 5, 0)
      ..insert(4, 6, 1)
      ..insert(3, 4, 0)
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final box = tester.renderObject<RenderBox>(find.byKey(const ValueKey(3)).first);
    final at = box.localToGlobal(Offset.zero);
    expect(at.dy, closeTo(10, 0.01)); // same line as the label
    expect(at.dx, closeTo(16 + 86.8 + 12, 0.01));
    expect(at.dx + box.size.width, closeTo(400 - 16, 0.01));
  });

  // 占满整行的条目（vant label-top：label `width: 100%`）仍然强制换行
  testWidgets('a full-width item still breaks the wrap row', (tester) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row', 'flexWrap': 'wrap'})
      ..node(2, 'view', {'width': '100%', 'height': 20})
      ..node(3, 'view', {'flex': 1})
      // min-content 50px: no room beside a full line, so it wraps (CSS too)
      ..node(4, 'view', {'width': 50, 'height': 20})
      ..insert(3, 4, 0)
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final box = tester.renderObject<RenderBox>(find.byKey(const ValueKey(3)).first);
    expect(box.localToGlobal(Offset.zero).dy, closeTo(20, 0.01));
  });

  // .van-tag--plain::before：span 上的绝对定位伪元素不能当行内片段画成一个点
  testWidgets('a paragraph lays absolute children over itself', (tester) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row'})
      ..node(2, 'text', {'position': 'relative', 'padding': '0 4px', 'color': '#1989fa'})
      ..node(3, 'view', {'position': 'absolute', 'top': 0, 'right': 0, 'bottom': 0, 'left': 0, 'border': '1px solid'})
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    w.u8(UiOpCode.setText);
    w.u32(2);
    final t = utf8.encode('朴素');
    w.u32(t.length);
    w.raw(t);
    await _pump(tester, w);
    final tag = tester.renderObject<RenderBox>(find.byKey(const ValueKey(2)).first);
    final border = _paintedRect(tester, 3);
    expect(border.width, closeTo(tag.size.width, 0.01));
    expect(border.height, closeTo(tag.size.height, 0.01));
  });

  // van-stepper 的 +：button 上的伪元素竖线/横线；`:active { opacity }` 与
  // `pointer-events: none` 都不能吃掉点击
  testWidgets('a pressed button with an opacity :active still taps', (tester) async {
    final base = {'position': 'relative', 'width': 28, 'height': 28, 'padding': 0, 'background': '#f2f3f5', 'border': 0};
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row'})
      ..node(2, 'button', base, active: {...base, 'opacity': 0.6})
      ..props(2, {'onClick': true, 'onTouchend': true})
      ..node(3, 'view', {
        'position': 'absolute', 'top': '50%', 'left': '50%', 'width': '50%', 'height': 1,
        'backgroundColor': '#323233', 'transform': 'translate(-50%, -50%)', 'pointerEvents': 'none',
      })
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    final (_, got) = await _pump(tester, w);
    final line = _paintedRect(tester, 3);
    expect(line.center.dx, closeTo(14, 0.01));
    expect(line.width, closeTo(14, 0.01));
    // a real tap: the press frame (the :active rebuild) lands before the up
    final g = await tester.startGesture(const Offset(14, 14));
    await tester.pump(const Duration(milliseconds: 50));
    await g.up();
    await tester.pump(const Duration(milliseconds: 400));
    expect(got, contains('2:1'));
  });

  test('border shorthands: per-side values and currentColor', () {
    final divider = FjsStyle({
      'style': {'borderWidth': '1px 0 0', 'borderColor': '#ebedf0', 'borderStyle': 'dashed'},
    }).boxBorders()!;
    expect(divider.top?.width, 1);
    expect(divider.top?.kind, FjsBorderStyle.dashed);
    expect(divider.right, isNull);
    expect(divider.bottom, isNull);
    final tag = FjsStyle({
      'style': {'border': '1px solid', 'color': '#1989fa'},
    }).boxBorders()!;
    expect(tag.top?.color, const Color(0xFF1989FA));
  });

  // 点击后才进入 loading 的按钮（vant 的提交流）：转圈 svg 挂载时按钮要从
  // label 快速路径切到真实子树，loading 期间 `cursor: default` 要收掉按压
  // 遮罩——两件事都发生在同一次重渲染里。
  testWidgets('click-to-loading swaps in the spinner subtree and drops the press mask', (
    tester,
  ) async {
    final buttonStyle = {
      'position': 'relative', 'width': 140, 'height': 36,
      'background': '#1989fa', 'border': 0, 'color': '#ffffff',
    };
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row', 'padding': 8})
      ..node(2, 'button', buttonStyle)
      ..props(2, {'onClick': true})
      ..node(3, 'view', {'flexDirection': 'row', 'alignItems': 'center', 'justifyContent': 'center'})
      ..node(4, 'text', {})
      ..text(4, '提交')
      ..insert(3, 4, 0)
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final frame1 = w.b.length;
    expect(find.byType(FjsSvg), findsNothing);
    expect(find.text('提交'), findsOneWidget);

    // idle: pressing darkens (no cursor rule — the app-side default)
    final idle = await tester.startGesture(tester.getCenter(find.byType(TextButton)));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byKey(fjsButtonPressMaskKey), findsOneWidget);
    await idle.up();
    await tester.pump(const Duration(milliseconds: 50));

    // loading on: cursor goes default, the spinner svg mounts under the
    // van-loading div ahead of the label
    w
      ..define(900, {...buttonStyle, 'cursor': 'default'})
      ..style(2, 900)
      ..node(6, 'view', {'flexDirection': 'row', 'alignItems': 'center'})
      ..node(7, 'view', {'width': 20, 'height': 20})
      ..node(8, 'svg', {'width': '100%', 'height': '100%', 'display': 'block'})
      ..props(8, {'viewBox': '25 25 50 50'})
      ..node(9, 'circle', {})
      ..props(9, {'cx': '50', 'cy': '50', 'r': '20', 'fill': 'none'})
      ..insert(8, 9, 0)
      ..insert(7, 8, 0)
      ..insert(6, 7, 0)
      ..insert(3, 6, 0);
    tree.applyFrame(Uint8List.fromList(w.b.sublist(frame1)));
    // the engine flushes after draining a JS event's frames; the test drives
    // the tree directly
    tree.flushDirty();
    await tester.pump(const Duration(milliseconds: 50));

    // the svg subtree reached the widget tree through the button's rich path
    expect(find.byType(FjsSvg), findsOneWidget);
    // and pressing no longer darkens (cursor: default = not clickable)
    final loading = await tester.startGesture(tester.getCenter(find.byType(TextButton)));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byKey(fjsButtonPressMaskKey), findsNothing);
    await loading.up();
  });
}
