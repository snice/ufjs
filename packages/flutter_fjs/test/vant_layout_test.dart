// specs/069 验证期：vant 三页在 iOS 模拟器上与 web 逐屏对拍时修掉的布局缺口，
// 每条对应一个真实组件（注释里标出）。
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/geometry.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/registry/host.dart';
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
  void node(
    int id,
    String tag,
    Map<String, Object?> style, {
    Map<String, Object?>? active,
  }) {
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
Future<(MirrorTree, _Dispatched)> _pump(
  WidgetTester tester,
  _W w, {
  double width = 400,
}) async {
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
      ..node(1, 'view', {
        'position': 'relative',
        'flexDirection': 'row',
        'padding': '10px 16px',
      })
      ..node(2, 'view', {'flex': 1, 'height': 20})
      ..node(3, 'view', {
        'position': 'absolute',
        'left': 16,
        'right': 16,
        'bottom': 0,
        'height': 1,
        'backgroundColor': '#ebedf0',
      })
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
  testWidgets('percent insets resolve against the laid-out box', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'position': 'relative', 'padding': '16px 8px'})
      ..node(2, 'view', {'height': 40})
      ..node(3, 'view', {
        'position': 'absolute',
        'top': '-50%',
        'right': '-50%',
        'bottom': '-50%',
        'left': '-50%',
        'borderWidth': '0 1px 1px 0',
        'border': '0 solid #ebedf0',
        'transform': 'scale(.5)',
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
  testWidgets('auto margins centre and % translations use the own size', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'position': 'relative', 'height': 400})
      ..node(2, 'view', {
        'position': 'absolute',
        'top': '45%',
        'left': 0,
        'right': 0,
        'width': 320,
        'height': 100,
        'margin': '0 auto',
        'transform': 'translate3d(0, -50%, 0)',
        'backgroundColor': '#fff',
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
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row', 'flexWrap': 'wrap'});
    for (var i = 0; i < 3; i++) {
      w
        ..node(2 + i, 'view', {'flexBasis': '25%', 'height': 10})
        ..insert(1, 2 + i, i);
    }
    await _pump(tester, w);
    for (var i = 0; i < 3; i++) {
      final box = tester.renderObject<RenderBox>(
        find.byKey(ValueKey(2 + i)).first,
      );
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
    final before = tester.renderObject<RenderBox>(
      find.byKey(const ValueKey(2)).first,
    );
    final after = tester.renderObject<RenderBox>(
      find.byKey(const ValueKey(4)).first,
    );
    expect(before.size.width, closeTo(40, 0.01));
    expect(after.size.width, closeTo(400 - 40 - 60, 0.01));
  });

  // .van-nav-bar__title：flex 行里 `margin: 0 auto` 居中（左右按钮是绝对定位）
  testWidgets('main-axis auto margins centre a flex item', (tester) async {
    final w = _W()
      ..node(1, 'view', {
        'position': 'relative',
        'flexDirection': 'row',
        'alignItems': 'center',
        'height': 46,
      })
      ..node(2, 'view', {
        'position': 'absolute',
        'left': 0,
        'top': 0,
        'bottom': 0,
        'width': 60,
      })
      ..node(3, 'view', {
        'maxWidth': '60%',
        'margin': '0 auto',
        'width': 80,
        'height': 20,
      })
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final r = _paintedRect(tester, 3);
    expect(r.left, closeTo(160, 0.01));
    expect(r.width, closeTo(80, 0.01));
  });

  // `margin-left: auto` 把条目推到行尾；有 flex-grow 的兄弟时没有剩余空间
  testWidgets('a single auto margin pushes, a growing sibling wins', (
    tester,
  ) async {
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
  testWidgets('a text-only box shrinks and centres in a centring column', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row', 'height': 50})
      ..node(2, 'view', {
        'display': 'flex',
        'flex': 1,
        'color': '#1989fa',
        'cursor': 'pointer',
        'flexDirection': 'column',
        'alignItems': 'center',
        'justifyContent': 'center',
        'fontSize': 12,
        'lineHeight': 1,
      })
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
    final r = tester.renderObject<RenderBox>(
      find.byKey(const ValueKey(3)).first,
    );
    final at = r.localToGlobal(Offset.zero);
    expect(r.size.width, lessThan(40)); // two 12px glyphs, not the whole line
    expect(at.dx + r.size.width / 2, closeTo(200, 1));
  });

  // .van-field：wrap 行里 label 定宽 + value `flex: 1`，value 里 input 100% +
  // 清除图标——CSS 按基准尺寸 0 断行，value 留在 label 旁边并长满剩余
  testWidgets('a growing item in a wrap row stays on the line', (tester) async {
    final w = _W()
      ..node(1, 'view', {
        'flexDirection': 'row',
        'flexWrap': 'wrap',
        'padding': '10px 16px',
      })
      ..node(2, 'view', {
        'flex': 'none',
        'width': 86.8,
        'marginRight': 12,
        'height': 24,
      })
      ..node(3, 'view', {'flex': 1})
      ..node(4, 'view', {
        'display': 'flex',
        'alignItems': 'center',
        'flexDirection': 'row',
      })
      ..node(5, 'input', {'width': '100%', 'minWidth': 0, 'height': 24})
      ..node(6, 'view', {'flexShrink': 0, 'width': 34, 'height': 24})
      ..insert(4, 5, 0)
      ..insert(4, 6, 1)
      ..insert(3, 4, 0)
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final box = tester.renderObject<RenderBox>(
      find.byKey(const ValueKey(3)).first,
    );
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
    final box = tester.renderObject<RenderBox>(
      find.byKey(const ValueKey(3)).first,
    );
    expect(box.localToGlobal(Offset.zero).dy, closeTo(20, 0.01));
  });

  // .van-tag--plain::before：span 上的绝对定位伪元素不能当行内片段画成一个点
  testWidgets('a paragraph lays absolute children over itself', (tester) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row'})
      ..node(2, 'text', {
        'position': 'relative',
        'padding': '0 4px',
        'color': '#1989fa',
      })
      ..node(3, 'view', {
        'position': 'absolute',
        'top': 0,
        'right': 0,
        'bottom': 0,
        'left': 0,
        'border': '1px solid',
      })
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    w.u8(UiOpCode.setText);
    w.u32(2);
    final t = utf8.encode('朴素');
    w.u32(t.length);
    w.raw(t);
    await _pump(tester, w);
    final tag = tester.renderObject<RenderBox>(
      find.byKey(const ValueKey(2)).first,
    );
    final border = _paintedRect(tester, 3);
    expect(border.width, closeTo(tag.size.width, 0.01));
    expect(border.height, closeTo(tag.size.height, 0.01));
  });

  // van-stepper 的 +：button 上的伪元素竖线/横线；`:active { opacity }` 与
  // `pointer-events: none` 都不能吃掉点击
  testWidgets('a pressed button with an opacity :active still taps', (
    tester,
  ) async {
    final base = {
      'position': 'relative',
      'width': 28,
      'height': 28,
      'padding': 0,
      'background': '#f2f3f5',
      'border': 0,
    };
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row'})
      ..node(2, 'button', base, active: {...base, 'opacity': 0.6})
      ..props(2, {'onClick': true, 'onTouchend': true})
      ..node(3, 'view', {
        'position': 'absolute',
        'top': '50%',
        'left': '50%',
        'width': '50%',
        'height': 1,
        'backgroundColor': '#323233',
        'transform': 'translate(-50%, -50%)',
        'pointerEvents': 'none',
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
      'style': {
        'borderWidth': '1px 0 0',
        'borderColor': '#ebedf0',
        'borderStyle': 'dashed',
      },
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
  testWidgets(
    'click-to-loading swaps in the spinner subtree and drops the press mask',
    (tester) async {
      final buttonStyle = {
        'position': 'relative',
        'width': 140,
        'height': 36,
        'background': '#1989fa',
        'border': 0,
        'color': '#ffffff',
      };
      final w = _W()
        ..node(1, 'view', {'flexDirection': 'row', 'padding': 8})
        ..node(2, 'button', buttonStyle)
        ..props(2, {'onClick': true})
        ..node(3, 'view', {
          'flexDirection': 'row',
          'alignItems': 'center',
          'justifyContent': 'center',
        })
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
      final idle = await tester.startGesture(
        tester.getCenter(find.byType(TextButton)),
      );
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
        ..node(8, 'svg', {
          'width': '100%',
          'height': '100%',
          'display': 'block',
        })
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
      final loading = await tester.startGesture(
        tester.getCenter(find.byType(TextButton)),
      );
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.byKey(fjsButtonPressMaskKey), findsNothing);
      await loading.up();
    },
  );

  // van-skeleton（specs/073）：`.van-skeleton__content { width: 100% }` 与固定
  // 尺寸的 avatar 同行。web 上 div 是原生节点、按 CSS 初始值收缩让位；App 端
  // 映射成 view 后由 JS 映射层把 flexShrink:1 作为元素缺省样式补回——本条锁
  // Dart 侧契约：声明了 shrink 的百分比宽子项必须给固定兄弟让位（此前整行
  // RIGHT OVERFLOWED BY 84px）。
  testWidgets('a percentage-wide row item yields to a fixed sibling', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'flexDirection': 'row', 'padding': '0 16px'})
      ..node(2, 'view', {
        'flexShrink': 0,
        'width': 32,
        'height': 32,
        'marginRight': 16,
      })
      // flexShrink:1 是 JS 映射层补的元素缺省样式，到 Dart 侧就是声明值
      ..node(3, 'view', {'flexShrink': 1, 'width': '100%', 'height': 16})
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final avatar = _paintedRect(tester, 2);
    final content = _paintedRect(tester, 3);
    expect(content.left, avatar.right + 16);
    expect(content.right, 384); // 400 - 16 padding: no overflow past the box
  });

  // van-skeleton 的 title 是一个没有文字的 <h3>（specs/073）：web 上是块盒，
  // width:40% + height:16 + 背景照样画出灰条；App 端映射成 text 后空内容
  // 不能塌成零尺寸，否则灰条消失。
  testWidgets('an empty text with an explicit size paints its box', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'flexDirection': 'row'})
      ..node(3, 'view', {
        'flexShrink': 0,
        'width': 32,
        'height': 32,
        'marginRight': 16,
        'borderRadius': 16,
        'backgroundColor': '#ebedf0',
      })
      ..node(4, 'view', {'flexShrink': 1, 'width': '100%'})
      ..node(5, 'text', {
        'width': '40%',
        'height': 16,
        'backgroundColor': '#ebedf0',
      })
      ..insert(4, 5, 0)
      ..insert(2, 3, 0)
      ..insert(2, 4, 1)
      ..insert(1, 2, 0);
    await _pump(tester, w);
    final r = _paintedRect(tester, 5);
    expect(r.width, greaterThan(50), reason: '40% of the content column');
    expect(r.height, 16);
  });

  // van-card 的 tags（specs/073）：块盒里两个 inline-flex 标签（span→text）
  // 应排成一行、收缩到内容宽——此前被拉伸列撑成通栏、纵向堆叠。
  testWidgets('inline-flex tags flow on one line inside a block box', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'width': '100%'})
      ..props(2, {'htmlBlock': true})
      ..node(3, 'text', {
        'display': 'inline-flex',
        'flexDirection': 'row',
        'flexWrap': 'wrap',
        'padding': '0 4px',
        'backgroundColor': '#ee0a24',
      })
      ..text(3, '免税')
      ..node(4, 'text', {
        'display': 'inline-flex',
        'flexDirection': 'row',
        'flexWrap': 'wrap',
        'padding': '0 4px',
        'backgroundColor': '#1989fa',
      })
      ..text(4, '新品')
      ..insert(2, 3, 0)
      ..insert(2, 4, 1)
      ..insert(1, 2, 0);
    await _pump(tester, w);
    final a = _paintedRect(tester, 3);
    final b = _paintedRect(tester, 4);
    expect(b.top, a.top, reason: 'same line, not stacked');
    expect(b.left, a.right, reason: 'side by side');
    expect(a.width, lessThan(120), reason: 'shrunk to content, not full width');
  });

  // van-card 的 num（specs/073）：`float: right` 把数量钉到块右缘，与
  // 价格同一行顶。
  testWidgets('float:right pins a child to the right edge of the block', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'width': '100%'})
      ..props(2, {'htmlBlock': true})
      ..node(3, 'view', {'backgroundColor': '#ebedf0'})
      ..node(4, 'text', {'display': 'inline-block'})
      ..text(4, '¥2.00')
      ..insert(3, 4, 0)
      ..node(5, 'text', {})
      ..text(5, 'x2')
      ..props(5, {'float': 'right'})
      ..insert(2, 3, 0)
      ..insert(2, 5, 1)
      ..insert(1, 2, 0);
    await _pump(tester, w);
    final num = _paintedRect(tester, 5);
    expect(num.right, 388, reason: 'right edge inside the 12px padding');
    expect(num.top, 12, reason: 'top of the block line');
  });

  // van-card 的 content（specs/073）：flex column + space-between +
  // min-height:88px——顶部（title/desc/tags）与底部（价格行）分居两端，
  // 中间由最小高度撑开。无 thumb 时整卡高度全靠它。
  testWidgets('min-height stretches a space-between column (van-card)', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'flexDirection': 'row'})
      ..node(3, 'view', {
        'display': 'flex',
        'flexDirection': 'column',
        'justifyContent': 'space-between',
        'minHeight': 88,
      })
      ..props(3, {'htmlBlock': true})
      ..node(4, 'view', {})
      ..props(4, {'htmlBlock': true})
      ..node(5, 'text', {})
      ..text(5, '标题')
      ..insert(4, 5, 0)
      ..node(6, 'view', {})
      ..props(6, {'htmlBlock': true})
      ..node(7, 'text', {})
      ..text(7, '¥2.00')
      ..insert(6, 7, 0)
      ..insert(3, 4, 0)
      ..insert(3, 6, 1)
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    await _pump(tester, w);
    // _paintedRect descends to the deepest box in the subtree — wrong for a
    // container; measure each node's own render box instead.
    Rect own(int id) {
      final b =
          tester.renderObject(find.byKey(ValueKey(id)).first) as RenderBox;
      return Rect.fromPoints(
        b.localToGlobal(Offset.zero),
        b.localToGlobal(b.size.bottomRight(Offset.zero)),
      );
    }

    final content = own(3);
    final top = own(4);
    final bottom = own(6);
    expect(content.height, greaterThanOrEqualTo(88), reason: 'min-height');
    expect(top.top, content.top);
    expect(
      bottom.bottom,
      content.bottom,
      reason: 'space-between pins the bottom row',
    );
  });

  // van-card 真实结构（specs/073）：块级 title 之后跟两个 inline-flex 标签
  // （匿名行盒），bottom 里 inline-block 的价格 div（内含块级 div + span）
  // 与原价 div 同一行、数量 float:right——div 带 htmlBlock，但 display
  // 决定它是行内盒。
  testWidgets('inline boxes after a block child share a line (van-card)', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {})
      ..props(2, {'htmlBlock': true})
      ..node(3, 'view', {})
      ..props(3, {'htmlBlock': true})
      ..text(3, '商品标题')
      ..node(4, 'text', {'display': 'inline-flex', 'padding': '0 4px'})
      ..text(4, '免税')
      ..node(5, 'text', {'display': 'inline-flex', 'padding': '0 4px'})
      ..text(5, '新品')
      ..insert(2, 3, 0)
      ..insert(2, 4, 1)
      ..insert(2, 5, 2)
      // bottom
      ..node(10, 'view', {})
      ..props(10, {'htmlBlock': true})
      ..node(11, 'view', {
        'display': 'inline-block',
        'flexDirection': 'row',
        'flexWrap': 'wrap',
      })
      ..props(11, {'htmlBlock': true})
      ..node(12, 'view', {})
      ..props(12, {'htmlBlock': true})
      ..node(13, 'text', {})
      ..text(13, '¥')
      ..node(14, 'text', {'fontSize': 16})
      ..text(14, '2')
      ..insert(12, 13, 0)
      ..insert(12, 14, 1)
      ..insert(11, 12, 0)
      ..node(15, 'view', {
        'display': 'inline-block',
        'flexDirection': 'row',
        'flexWrap': 'wrap',
        'marginLeft': 5,
      })
      ..props(15, {'htmlBlock': true})
      ..node(16, 'text', {})
      ..text(16, '¥ 10.00')
      ..insert(15, 16, 0)
      ..node(17, 'view', {})
      ..props(17, {'htmlBlock': true, 'float': 'right'})
      ..text(17, 'x2')
      ..insert(10, 11, 0)
      ..insert(10, 15, 1)
      ..insert(10, 17, 2)
      ..insert(2, 10, 3)
      ..insert(1, 2, 0);
    await _pump(tester, w);
    Rect own(int id) {
      final b =
          tester.renderObject(find.byKey(ValueKey(id)).first) as RenderBox;
      return Rect.fromPoints(
        b.localToGlobal(Offset.zero),
        b.localToGlobal(b.size.bottomRight(Offset.zero)),
      );
    }

    final title = own(3);
    final a = own(4);
    final b = own(5);
    expect(
      a.top,
      greaterThanOrEqualTo(title.bottom),
      reason: 'tags below the block title',
    );
    expect(b.top, a.top, reason: 'tags on one line');
    expect(b.left, a.right);
    final price = own(11);
    final origin = own(15);
    final num = own(17);
    expect(price.left, 12, reason: 'price starts the line');
    expect(
      price.width,
      lessThan(60),
      reason: 'inline-block shrinks to content',
    );
    // the keyed box includes its margin-left
    expect(origin.left, price.right, reason: 'origin price beside the price');
    expect(origin.bottom, price.bottom, reason: 'same line');
    expect(num.right, 388, reason: 'float:right');
    expect(num.top, price.top);
  });

  // van-notice-bar 静态条（specs/073）：`.van-ellipsis` 的 text-overflow
  // 由 runtime 下传到文本节点；单行（nowrap）才出省略号，换行文字不受影响。
  testWidgets('text-overflow: ellipsis on a nowrap text run', (tester) async {
    final w = _W()
      ..node(1, 'view', {'width': 120})
      ..node(2, 'text', {'whiteSpace': 'nowrap', 'textOverflow': 'ellipsis'})
      ..text(2, '静态长文本：在代码中设置 scrollable 为 false 时截断')
      ..node(3, 'text', {'textOverflow': 'ellipsis'})
      ..text(3, '会换行的长文本不该被截成一行，也不出省略号')
      ..insert(1, 2, 0)
      ..insert(1, 3, 1);
    await _pump(tester, w);
    final texts = tester.widgetList<RichText>(find.byType(RichText)).toList();
    final one = texts.firstWhere((t) => t.text.toPlainText().startsWith('静态'));
    final wrap = texts.firstWhere(
      (t) => t.text.toPlainText().startsWith('会换行'),
    );
    expect(one.overflow, TextOverflow.ellipsis);
    expect(one.maxLines, 1);
    expect(wrap.overflow, isNot(TextOverflow.ellipsis));
  });

  // van-notice-bar 跑马灯（specs/073）：绝对定位 + nowrap 的内容盒按整行
  // 收缩（CSS 最小内容宽 = 整行），溢出 wrap；vant 量它的宽度决定滚多远。
  testWidgets('absolute nowrap box is as wide as its line', (tester) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {
        'position': 'relative',
        'height': 40,
        'overflow': 'hidden',
        'display': 'flex',
        'flexDirection': 'row',
        'alignItems': 'center',
      })
      ..node(3, 'view', {'position': 'absolute', 'whiteSpace': 'nowrap'})
      ..node(4, 'text', {'whiteSpace': 'nowrap', 'fontSize': 14})
      ..text(4, '滚动播放：scrollable 为 true 时，文案超宽会循环滚动（transform 过渡驱动）。')
      ..insert(3, 4, 0)
      ..insert(2, 3, 0)
      // the ellipsis variant: max-width: 100% keeps it inside
      ..node(5, 'view', {
        'position': 'absolute',
        'whiteSpace': 'nowrap',
        'maxWidth': '100%',
      })
      ..node(6, 'text', {'whiteSpace': 'nowrap', 'textOverflow': 'ellipsis'})
      ..text(6, '静态长文本：在代码中设置 scrollable 为 false 时，文案超宽会直接截断。')
      ..insert(5, 6, 0)
      ..insert(2, 5, 1)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    // measured as fjs.ui.rect does: the node's own element (geometry.dart)
    Rect own(int id) {
      final b =
          (tree.node(id)!.element! as Element).findRenderObject() as RenderBox;
      return Rect.fromPoints(
        b.localToGlobal(Offset.zero),
        b.localToGlobal(b.size.bottomRight(Offset.zero)),
      );
    }

    final wrap = own(2);
    final content = own(3);
    expect(wrap.width, 376);
    expect(content.left, wrap.left);
    // static position: the flex bar's align-items: center (web: top + 8)
    final text = own(4);
    expect(text.center.dy, closeTo(wrap.center.dy, 0.5));
    expect(
      content.width,
      greaterThan(wrap.width),
      reason: 'overflows: one line',
    );
    expect(
      own(5).width,
      lessThanOrEqualTo(wrap.width),
      reason: 'max-width clamps',
    );
    expect(tester.takeException(), isNull);
  });

  // van-notice-bar 跑马灯（specs/073）：transform 过渡跑完派发
  // transitionend（42）；中途改目标是取消，不派发。
  testWidgets('a finished transform transition dispatches transitionend', (
    tester,
  ) async {
    const base = {
      'transitionDuration': '0.3s',
      'transitionTimingFunction': 'linear',
    };
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {...base, 'height': 20})
      ..props(2, {'onTransitionend': true})
      ..insert(1, 2, 0);
    final (tree, got) = await _pump(tester, w);
    void restyle(Map<String, Object?> style) {
      final sid = _nextStyle++;
      final f = _W()
        ..define(sid, {...base, 'height': 20, ...style})
        ..style(2, sid);
      tree
        ..applyFrame(Uint8List.fromList(f.b))
        ..flushDirty();
    }

    restyle({'transform': 'translateX(-100px)'});
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    // retarget mid-flight: the first run is cancelled, not ended
    restyle({'transform': 'translateX(-200px)'});
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(got.where((e) => e == '2:42'), isEmpty);
    await tester.pump(const Duration(milliseconds: 200));
    expect(got.where((e) => e == '2:42').length, 1);
  });

  // 同上（specs/073）：vant 初始 `transition-duration: 0s` 且无 transform，
  // 随后一次改动同时设 transform 与时长——应从旧值过渡，而非直接跳到终点。
  testWidgets('transform + duration set together still transition', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'transitionDuration': '0s', 'height': 20})
      ..props(2, {'onTransitionend': true})
      ..insert(1, 2, 0);
    final (tree, got) = await _pump(tester, w);
    final sid = _nextStyle++;
    final f = _W()
      ..define(sid, {
        'transitionDuration': '0.4s',
        'transitionTimingFunction': 'linear',
        'transform': 'translateX(-100px)',
        'height': 20,
      })
      ..style(2, sid);
    tree
      ..applyFrame(Uint8List.fromList(f.b))
      ..flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    final mid = tester
        .widgetList<Transform>(find.byType(Transform))
        .map((t) => t.transform.getTranslation().x)
        .where((x) => x != 0)
        .toList();
    expect(mid, isNotEmpty);
    expect(mid.first, closeTo(-50, 5), reason: 'halfway, not jumped');
    await tester.pump(const Duration(milliseconds: 250));
    expect(got, contains('2:42'));
  });

  // 静态位置（specs/073）的列方向：只给了 top 的绝对定位子项，在
  // `align-items: center` 的 flex 列里水平居中；给了 left 的不受影响。
  testWidgets('absolute child takes the flex column cross alignment', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {
        'position': 'relative',
        'height': 60,
        'display': 'flex',
        'flexDirection': 'column',
        'alignItems': 'center',
      })
      ..node(3, 'view', {
        'position': 'absolute',
        'top': 10,
        'width': 40,
        'height': 20,
      })
      ..node(4, 'view', {
        'position': 'absolute',
        'top': 10,
        'left': 0,
        'width': 40,
        'height': 20,
      })
      ..insert(2, 3, 0)
      ..insert(2, 4, 1)
      // row bar, a sized child with no inset at all
      ..node(5, 'view', {
        'position': 'relative',
        'height': 40,
        'display': 'flex',
        'flexDirection': 'row',
        'alignItems': 'center',
      })
      ..node(6, 'view', {'position': 'absolute', 'width': 40, 'height': 20})
      ..insert(5, 6, 0)
      ..insert(1, 2, 0)
      ..insert(1, 5, 1);
    final (tree, _) = await _pump(tester, w);
    Rect own(int id) {
      final b =
          (tree.node(id)!.element! as Element).findRenderObject() as RenderBox;
      return Rect.fromPoints(
        b.localToGlobal(Offset.zero),
        b.localToGlobal(b.size.bottomRight(Offset.zero)),
      );
    }

    final box = own(2);
    expect(own(3).center.dx, closeTo(box.center.dx, 0.5));
    expect(own(3).top, box.top + 10);
    expect(own(3).size, const Size(40, 20));
    expect(
      own(4).left,
      box.left,
      reason: 'an inset wins over the static position',
    );
    final bar = own(5);
    expect(own(6).size, const Size(40, 20));
    expect(own(6).center.dy, closeTo(bar.center.dy, 0.5));
    expect(own(6).left, bar.left);
    expect(tester.takeException(), isNull);
  });

  // van-collapse-item（specs/073）：wrapper `overflow: hidden` + height 过渡
  // 0 → 内容高。过程中内容按自然高度排、被裁剪（不画溢出条纹）；跑完派发
  // transitionend（vant 据此把高度清回 auto）。
  testWidgets('collapse wrapper height transition clips and ends', (
    tester,
  ) async {
    const wrap = {
      'overflow': 'hidden',
      'transitionProperty': 'height',
      'transitionDuration': '0.3s',
    };
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {...wrap, 'height': 0})
      ..props(2, {'onTransitionend': true, 'htmlBlock': true})
      ..node(3, 'view', {'padding': '12px 16px'})
      ..props(3, {'htmlBlock': true})
      ..node(4, 'text', {'fontSize': 14, 'lineHeight': 21})
      ..text(4, '点标题展开，再点收起。')
      ..insert(3, 4, 0)
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    final (tree, got) = await _pump(tester, w);
    final sid = _nextStyle++;
    final f = _W()
      ..define(sid, {...wrap, 'height': 45})
      ..style(2, sid);
    tree
      ..applyFrame(Uint8List.fromList(f.b))
      ..flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    expect(tester.takeException(), isNull, reason: 'no overflow mid-run');
    final box =
        (tree.node(2)!.element! as Element).findRenderObject() as RenderBox;
    expect(box.size.height, inExclusiveRange(0, 45));
    expect(got, isNot(contains('2:42')));
    await tester.pump(const Duration(milliseconds: 200));
    expect(got, contains('2:42'));
    expect(tester.takeException(), isNull);
  });

  // van-collapse 标题箭头（specs/073）：::before 盒 `transition: transform
  // .3s`，rotate(90deg) → rotate(-90deg)。CSS 按角度插值：中点 0°。
  testWidgets('rotate transition interpolates the angle', (tester) async {
    const base = {'transition': 'transform .3s', 'width': 16, 'height': 16};
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {...base, 'transform': 'rotate(90deg) translateZ(0)'})
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final sid = _nextStyle++;
    final f = _W()
      ..define(sid, {...base, 'transform': 'rotate(-90deg) translateZ(0)'})
      ..style(2, sid);
    tree
      ..applyFrame(Uint8List.fromList(f.b))
      ..flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    final m = _nodeTransform(tester, 2);
    // off the ±90° end points (cos 0) — mid-run, not snapped
    expect(m.storage[0], greaterThan(0.3));
    await tester.pump(const Duration(milliseconds: 200));
  });

  // 同上，但箭头在可点击标题里（`:active` 按下态）：vant 的展开发生在
  // 按下→松开之间，标题整棵子树随按下态重建时，箭头的过渡不能丢。
  testWidgets('rotate transition survives the parent press state', (
    tester,
  ) async {
    const base = {'transition': 'transform .3s', 'width': 16, 'height': 16};
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(
        2,
        'view',
        {'height': 44, 'position': 'relative'},
        active: {'backgroundColor': '#f2f3f5'},
      )
      ..props(2, {'onTap': true})
      ..node(3, 'view', {...base, 'transform': 'rotate(90deg) translateZ(0)'})
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final g = await tester.startGesture(
      tester.getCenter(find.byKey(const ValueKey(2)).first),
    );
    await tester.pump(const Duration(milliseconds: 50));
    await g.up();
    await tester.pump();
    final sid = _nextStyle++;
    // the expanded title also gains its absolute ::after hairline
    final f = _W()
      ..define(sid, {...base, 'transform': 'rotate(-90deg) translateZ(0)'})
      ..style(3, sid)
      ..node(9, 'view', {
        'position': 'absolute',
        'left': 0,
        'right': 0,
        'bottom': 0,
        'height': 1,
      })
      ..insert(2, 9, 1);
    tree
      ..applyFrame(Uint8List.fromList(f.b))
      ..flushDirty();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    final m = _nodeTransform(tester, 3);
    // between +90 (0, 1) and -90 (0, -1): the cosine is off zero mid-run
    expect(m.storage[0], greaterThan(0.3), reason: 'mid-rotation, not snapped');
    await tester.pump(const Duration(milliseconds: 300));
  });

  // van-collapse-item 展开（specs/073）：同一 tick 里先取消 display:none、
  // 再读 offsetHeight。rect 读取要像 DOM 一样强制同步重排，否则拿到上一帧
  // 的 0，vant 直接跳过高度动画。
  testWidgets('a rect read lays out what the ops just changed', (tester) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'display': 'none'})
      ..node(3, 'view', {'height': 45})
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final host = HostRegistry();
    registerGeometryHostModules(host: host, tree: tree);
    final sid = _nextStyle++;
    final f = _W()
      ..define(sid, {})
      ..style(2, sid);
    // no pump: JS reads in the same tick it un-hid the node
    tree.applyFrame(Uint8List.fromList(f.b));
    final rect =
        jsonDecode(host.invoke('fjs.ui.rect', [3]).value! as String) as List;
    expect(rect[3], 45);
  });

  // 同上，但内容是新插入的（vant 懒渲染：第一次展开才创建 wrapper/content），
  // 且父级在 LayoutBuilder 里（百分比宽度）。
  testWidgets('a rect read builds nodes inserted in the same tick', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      // 2's % width wraps its content in a LayoutBuilder; 6 (the parent
      // that gets the new child) is built inside that builder's scope
      ..node(2, 'view', {'width': '100%'})
      ..node(6, 'view', {})
      ..node(5, 'view', {'height': 20})
      ..insert(6, 5, 0)
      ..insert(2, 6, 0)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final host = HostRegistry();
    registerGeometryHostModules(host: host, tree: tree);
    final f = _W()
      ..node(3, 'view', {'overflow': 'hidden'})
      ..node(4, 'view', {'height': 45})
      ..insert(3, 4, 0)
      ..insert(6, 3, 1);
    tree.applyFrame(Uint8List.fromList(f.b));
    final raw = host.invoke('fjs.ui.rect', [4]).value;
    expect(raw, isNotNull, reason: 'built and laid out synchronously');
    final rect = jsonDecode(raw! as String) as List;
    expect(rect[3], 45);
  });

  // specs/086: navMount wraps rect reads so first-paint flushLayout is not
  // paid on the JS stack. A node applied in this tick has no box yet.
  testWidgets('a rect read during navMount does not force reflow', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'height': 20})
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final host = HostRegistry();
    registerGeometryHostModules(host: host, tree: tree);
    final f = _W()
      ..node(3, 'view', {'height': 45})
      ..insert(1, 3, 1);
    tree.applyFrame(Uint8List.fromList(f.b));
    final during = runWithoutGeometryReflow(
      () => host.invoke('fjs.ui.rect', [3]).value,
    );
    expect(during, isNull, reason: 'no box until the next Flutter frame');
    // leaving the window restores specs/073: same-tick unhide still layouts
    final raw = host.invoke('fjs.ui.rect', [3]).value;
    expect(raw, isNotNull, reason: 'forced reflow after navMount');
    final rect = jsonDecode(raw! as String) as List;
    expect(rect[3], 45);
  });

  // A node that already has a box still answers during the defer window —
  // we skip _reflow, not the read. The previous route keeps its size.
  testWidgets('a laid-out node still answers during the defer window', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'height': 20})
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final host = HostRegistry();
    registerGeometryHostModules(host: host, tree: tree);
    final raw = runWithoutGeometryReflow(
      () => host.invoke('fjs.ui.rect', [2]).value,
    );
    expect(raw, isNotNull);
    final rect = jsonDecode(raw! as String) as List;
    expect(rect[3], 20);
  });

  // van-step 图标（specs/073）：`<i>` 映射为 text，里面只有 ::before 的
  // inline-block 盒。段落行高取自身样式（12px × 1），不是 Material 默认
  // 正文的 14px × 1.43（此前 20px 高，圆点容器随之错位）。
  testWidgets('a paragraph holding only a box takes its own line height', (
    tester,
  ) async {
    const txt = {'fontSize': 12, 'lineHeight': '1'};
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'text', {...txt, 'display': 'block'})
      ..node(3, 'view', {
        ...txt,
        'display': 'inline-block',
        'flexDirection': 'row',
        'flexWrap': 'wrap',
      })
      ..node(4, 'text', txt)
      ..text(4, '\ue68d')
      ..insert(3, 4, 0)
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final box =
        (tree.node(2)!.element! as Element).findRenderObject() as RenderBox;
    expect(box.size.height, 12);
  });

  // van-step（specs/073）：圆点容器 `z-index: 1` 白底盖住树序在后的连接线。
  // 同一包含块内的绝对定位子项按 z-index 排序（相等保持树序），负值在
  // 文档流内容之下。
  testWidgets('absolute siblings paint in z-index order', (tester) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'position': 'relative', 'height': 40})
      ..node(3, 'view', {
        'position': 'absolute',
        'top': 0,
        'zIndex': 1,
        'width': 20,
        'height': 20,
      })
      ..node(4, 'view', {
        'position': 'absolute',
        'top': 0,
        'width': 20,
        'height': 20,
      })
      ..node(5, 'view', {
        'position': 'absolute',
        'top': 0,
        'zIndex': -1,
        'width': 20,
        'height': 20,
      })
      ..node(6, 'view', {'height': 10})
      ..insert(2, 3, 0)
      ..insert(2, 4, 1)
      ..insert(2, 5, 2)
      ..insert(2, 6, 3)
      ..insert(1, 2, 0);
    await _pump(tester, w);
    final stack = tester.widget<Stack>(
      find
          .descendant(
            of: find.byKey(const ValueKey(2)),
            matching: find.byType(Stack),
          )
          .first,
    );
    final order = [
      for (final c in stack.children)
        c.key is ValueKey<int> ? (c.key! as ValueKey<int>).value : 0,
    ];
    // -1 under the flow content (0 = the unkeyed flow), then tree order, then 1
    expect(order, [5, 0, 4, 3]);
  });

  // vant-nav 的 Sidebar 行（specs/073）：`flex-wrap: wrap` 的 row 里有
  // flex-grow 子项（单行），`align-items: stretch` 要把内容区拉到侧栏高度。
  testWidgets('a single-line wrap row stretches its items', (tester) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {
        'flexDirection': 'row',
        'flexWrap': 'wrap',
        'alignItems': 'stretch',
        'gap': 8,
      })
      ..node(3, 'view', {'width': 80})
      ..node(4, 'view', {'height': 60})
      ..node(5, 'view', {'height': 60})
      ..node(6, 'view', {
        'flexGrow': 1,
        'justifyContent': 'center',
        'alignItems': 'center',
      })
      ..node(7, 'text', {})
      ..text(7, '第 2 组内容')
      ..insert(3, 4, 0)
      ..insert(3, 5, 1)
      ..insert(6, 7, 0)
      ..insert(2, 3, 0)
      ..insert(2, 6, 1)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    Size own(int id) =>
        ((tree.node(id)!.element! as Element).findRenderObject() as RenderBox)
            .size;
    expect(own(3).height, 120);
    expect(own(6).height, 120, reason: 'stretched to the line');
    // and its own justify-content: center sees that height
    Rect rect(int id) {
      final b =
          (tree.node(id)!.element! as Element).findRenderObject() as RenderBox;
      return b.localToGlobal(Offset.zero) & b.size;
    }

    expect(rect(7).center.dy, closeTo(rect(6).center.dy, 0.5));
  });

  // vant-nav（specs/073）：inline-block 的按钮在 fjs <view>（web 上是 flex
  // 容器）里被块化、随 align-items: stretch 拉满；在 HTML 块 div 里才收缩。
  testWidgets(
    'an inline-block is blockified in a flex view, shrinks in a div',
    (tester) async {
      const btn = {
        'display': 'inline-block',
        'flexDirection': 'row',
        'flexWrap': 'wrap',
        'height': 44,
      };
      final w = _W()
        ..node(1, 'view', {'padding': 12})
        ..node(2, 'view', {})
        ..node(3, 'view', btn)
        ..node(4, 'text', {})
        ..text(4, '选择城市')
        ..insert(3, 4, 0)
        ..insert(2, 3, 0)
        ..node(5, 'view', {})
        ..props(5, {'htmlBlock': true})
        ..node(6, 'view', btn)
        ..node(7, 'text', {})
        ..text(7, '选择城市')
        ..insert(6, 7, 0)
        ..insert(5, 6, 0)
        ..insert(1, 2, 0)
        ..insert(1, 5, 1);
      final (tree, _) = await _pump(tester, w);
      Size own(int id) =>
          ((tree.node(id)!.element! as Element).findRenderObject() as RenderBox)
              .size;
      expect(own(3).width, 376, reason: 'flex item: stretched');
      expect(own(6).width, lessThan(100), reason: 'block flow: shrink-to-fit');
    },
  );

  // vant tabs（specs/073）：`.van-tabs__nav { box-sizing: content-box;
  // height: 100%; padding-bottom: 15px }` 在 44px、overflow:hidden 的 wrap
  // 里——内容区 44（tab 撑满 44），整盒 59 溢出被裁。
  testWidgets('content-box height adds padding and overflows the parent', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {'height': 44, 'overflow': 'hidden'})
      ..node(3, 'view', {
        'display': 'flex',
        'flexDirection': 'row',
        'alignItems': 'stretch',
        'boxSizing': 'content-box',
        'height': '100%',
        'paddingBottom': 15,
      })
      ..node(4, 'view', {'flexGrow': 1})
      ..insert(3, 4, 0)
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    Size own(int id) =>
        ((tree.node(id)!.element! as Element).findRenderObject() as RenderBox)
            .size;
    expect(own(2).height, 44);
    expect(own(4).height, 44, reason: '100% of the wrap is the CONTENT height');
    expect(tester.takeException(), isNull);
  });

  // vant picker 选项（specs/073）：li 是居中的 flex 行，里面是
  // `.van-ellipsis` 的 div（overflow hidden + nowrap + ellipsis），文字是
  // div 自己的元素文本。此前 div 被压成 0×0，选项全部不可见。
  testWidgets('an ellipsis div in a centred flex row keeps its text', (
    tester,
  ) async {
    const ell = {
      'fontSize': 16,
      'overflow': 'hidden',
      'whiteSpace': 'nowrap',
      'textOverflow': 'ellipsis',
    };
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {
        'display': 'flex',
        'flexDirection': 'row',
        'alignItems': 'center',
        'justifyContent': 'center',
        'padding': '0 4px',
        'height': '44px',
      })
      ..node(3, 'view', ell)
      ..props(3, {'htmlBlock': true})
      ..text(3, '杭州')
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w);
    final b =
        (tree.node(3)!.element! as Element).findRenderObject() as RenderBox;
    expect(b.size.width, greaterThan(20));
    expect(b.size.height, greaterThan(10));
  });

  // vant picker 遮罩（specs/073）：两层渐变，各占 100% × 110px，一层贴顶
  // 一层贴底，中间露出选中项。此前只认单层渐变、铺满整块，选项被罩白。
  test('layered background images keep their own size and position', () {
    final layers = parseBackgroundLayers(
      'linear-gradient(180deg, rgba(255, 255, 255, .9), rgba(255, 255, 255, .4)), '
          'linear-gradient(0deg, rgba(255, 255, 255, .9), rgba(255, 255, 255, .4))',
      '100% 110px',
      'top,bottom',
    )!;
    expect(layers, hasLength(2));
    const box = Size(402, 264);
    expect(layers[0].rectIn(box), const Rect.fromLTWH(0, 0, 402, 110));
    expect(layers[1].rectIn(box), const Rect.fromLTWH(0, 154, 402, 110));
    // a single full-box gradient stays on the plain BoxDecoration path
    expect(
      parseBackgroundLayers('linear-gradient(red, blue)', null, null),
      isNull,
    );
  });

  // vant number keyboard（specs/073）：12 个 `flex: 1; flex-basis: 33%` 的键
  // 在 flex-wrap 行里——3 列 4 行，每键占行宽三分之一。此前被当成单行，
  // 12 个键挤在一行溢出。
  testWidgets('percentage flex-basis items wrap into a grid', (tester) async {
    final w = _W()
      ..node(1, 'view', {})
      ..node(2, 'view', {
        'display': 'flex',
        'flexDirection': 'row',
        'flexWrap': 'wrap',
      });
    for (var k = 0; k < 12; k++) {
      w
        ..node(10 + k, 'view', {
          'flex': 1,
          'flexGrow': 1,
          'flexBasis': '33%',
          'height': 54,
        })
        ..insert(2, 10 + k, k);
    }
    w.insert(1, 2, 0);
    final (tree, _) = await _pump(tester, w, width: 300);
    Rect rect(int id) {
      final b =
          (tree.node(id)!.element! as Element).findRenderObject() as RenderBox;
      return b.localToGlobal(Offset.zero) & b.size;
    }

    expect(rect(10).width, closeTo(100, 0.01));
    expect(
      rect(12).right,
      closeTo(300, 0.01),
      reason: 'three to a line, filling it',
    );
    expect(
      rect(13).top,
      rect(10).bottom,
      reason: 'the fourth key starts line two',
    );
    expect(rect(21).top - rect(10).top, 54 * 3.0);
  });

  // vant 底部弹层（specs/073）：`overflow-y: auto` + 顶部圆角。CSS 里非
  // visible 的 overflow 都会裁剪子项；此前只认 hidden，picker 的直角白底
  // 盖住了弹层圆角。
  testWidgets('overflow-y auto clips its content to the rounded box', (
    tester,
  ) async {
    final w = _W()
      ..node(1, 'view', {'padding': 12})
      ..node(2, 'view', {
        'overflowY': 'auto',
        'borderRadius': '16px 16px 0 0',
        'backgroundColor': '#ffffff',
      })
      ..node(3, 'view', {'height': 40, 'backgroundColor': '#ffffff'})
      ..insert(2, 3, 0)
      ..insert(1, 2, 0);
    await _pump(tester, w);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey(2)),
        matching: find.byType(ClipRRect),
      ),
      findsWidgets,
    );
  });
}

/// The transform node [id]'s own transition wrapper paints — not some other
/// Transform in the harness (the Scaffold animates its own).
Matrix4 _nodeTransform(WidgetTester tester, int id) => tester
    .widget<Transform>(
      find
          .descendant(
            of: find.byKey(ValueKey<Object>('fjs-transition-0-$id')),
            matching: find.byType(Transform),
          )
          .first,
    )
    .transform;
