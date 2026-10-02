// specs/193 T040: the flat display surface against the ordinary renderer, case
// by case. The harness is support/parity.dart; a style key joins the whitelist
// (flat_style.dart) when a case here pins it.
import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_tree.dart';
import 'support/parity.dart';

void main() {
  tearDown(() => fjsFlatMode = FjsFlatMode.auto);
  main3();
  main2();

  testWidgets('a single column of two texts', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final root = t.view(0, {'backgroundColor': '#ff0000'});
      t.text(root, 'hello', {'fontSize': '14px'});
      t.text(root, 'world', {'fontSize': '14px', 'color': '#0000ff'});
      return t.build();
    });
  });
}

// ---- generated: container x items x surrounding constraints -----------------

const _aligns = [null, 'flex-start', 'center', 'flex-end', 'stretch'];
const _justifies = [null, 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'];

typedef _Wrap = Widget Function(Widget);
final Map<String, _Wrap?> _contexts = {
  'loose': null,
  'tightW': (c) => SizedBox(width: 300, child: c),
  'tightWH': (c) => SizedBox(width: 300, height: 200, child: c),
  'unboundedW': (c) => SingleChildScrollView(scrollDirection: Axis.horizontal, child: c),
  'row-parent': (c) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [c]),
};

void _items(FixtureTree t, int parent, int variant) {
  switch (variant) {
    case 0:
      t.text(parent, 'ab', {'fontSize': '14px'});
      t.view(parent, {'width': '30px', 'height': '20px', 'backgroundColor': '#00aa00'});
      t.text(parent, 'cdefg', {'fontSize': '12px', 'color': '#aa0000'});
    case 1:
      t.text(parent, 'wrap me now', {'fontSize': '14px'});
      t.view(parent, {'height': '10px', 'backgroundColor': '#0000aa', 'flexGrow': 1});
    case 2:
      final inner = t.view(parent, {'flexDirection': 'row', 'backgroundColor': '#dddddd', 'padding': '3px'});
      t.text(inner, 'x', {'fontSize': '10px'});
      t.text(inner, 'yy', {'fontSize': '10px'});
      t.text(parent, 'tail', {'fontSize': '11px', 'margin': '2px'});
    default:
      t.view(parent, {'width': '40px', 'height': '40px', 'backgroundColor': '#ff8800', 'borderRadius': '6px', 'margin': '4px'});
      t.view(parent, {'flexGrow': 2, 'backgroundColor': '#8800ff'});
      t.text(parent, 'zz', {'fontSize': '13px'});
  }
}

void main2() {
  var seed = 1234567;
  int next(int n) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >> 8) % n;
  }

  for (var i = 0; i < 120; i++) {
    final dir = next(2) == 0 ? 'row' : 'column';
    final align = _aligns[next(_aligns.length)];
    final justify = _justifies[next(_justifies.length)];
    final gap = [null, '4px', '0px'][next(3)];
    final sizing = next(3);
    final pad = [null, '6px', '2px 8px'][next(3)];
    final margin = [null, '5px'][next(2)];
    final variant = next(4);
    final ctxName = _contexts.keys.elementAt(next(_contexts.length));
    final style = <String, Object?>{
      'flexDirection': dir,
      'alignItems': ?align,
      'justifyContent': ?justify,
      'gap': ?gap,
      if (sizing == 1) ...{'width': '200px', 'height': '120px'},
      if (sizing == 2) 'width': '200px',
      'padding': ?pad,
      'margin': ?margin,
      'backgroundColor': '#eeeeaa',
    };
    final label = '#$i $dir align=$align justify=$justify gap=$gap size=$sizing pad=$pad margin=$margin items=$variant ctx=$ctxName';
    testWidgets('generated $label', (tester) async {
      await expectParity(
        tester,
        () {
          final t = FixtureTree();
          final r = t.view(0, style);
          _items(t, r, variant);
          return t.build();
        },
        wrap: _contexts[ctxName],
        reason: label,
        allowRejected: true,
      );
    });
  }

  testWidgets('generated cases exercised the engine (not all gated out)', (tester) async {
    // runs after the generated cases (declaration order); a gate that rejected
    // everything would make them all vacuously pass
    // ignore: avoid_print
    print('[flat-parity] generated: container flat=$flatContainers gated=$gatedContainers');
    expect(flatContainers, greaterThan(40), reason: 'the engine barely ran: flat=$flatContainers gated=$gatedContainers');
  });
}

// ---- hand-written cases: one per supported thing, so a failure names it ------

void main3() {
  testWidgets('4050 grid, 5 x 8', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final g = t.view(0);
      for (var r = 0; r < 5; r++) {
        final row = t.view(g, {'flexDirection': 'row'});
        for (var c = 0; c < 8; c++) {
          final cell = t.view(row, {'backgroundColor': '#85d8b4', 'margin': '0.5px'});
          t.text(cell, '$c', {'fontSize': '5px', 'lineHeight': '5px'});
        }
      }
      return t.build();
    });
  });

  testWidgets('multi-line wrapping, centred, in a narrow column', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final r = t.view(0, {'width': '120px', 'backgroundColor': '#eeeeee', 'padding': '4px'});
      t.text(r, 'wrap this text over several lines please', {'fontSize': '14px', 'textAlign': 'center'});
      t.text(r, 'second paragraph that also wraps around', {'fontSize': '12px', 'color': '#336699'});
      return t.build();
    }, viewport: const Size(400, 600));
  });

  testWidgets('ellipsis and nowrap', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final r = t.view(0, {'width': '100px'});
      t.text(r, 'this one is cut with an ellipsis', {'fontSize': '14px', 'whiteSpace': 'nowrap', 'textOverflow': 'ellipsis'});
      t.text(r, 'two lines at most for this longer sentence here', {'fontSize': '14px', 'maxLines': 2, 'textOverflow': 'ellipsis'});
      return t.build();
    }, viewport: const Size(400, 600));
  });

  testWidgets('text style family', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final r = t.view(0);
      t.text(r, 'bold', {'fontSize': '16px', 'fontWeight': 'bold'});
      t.text(r, 'italic', {'fontSize': '16px', 'fontStyle': 'italic'});
      t.text(r, 'spaced', {'fontSize': '16px', 'letterSpacing': '3px'});
      t.text(r, 'tall', {'fontSize': '16px', 'lineHeight': '30px'});
      t.text(r, 'multiplier', {'fontSize': '16px', 'lineHeight': '2'});
      t.text(r, 'under', {'fontSize': '16px', 'textDecoration': 'underline'});
      t.text(r, 'upper', {'fontSize': '16px', 'textTransform': 'uppercase'});
      t.text(r, 'shadow', {'fontSize': '16px', 'textShadow': '1px 1px 2px #888888'});
      return t.build();
    });
  });

  testWidgets('box on a text node: size, background, radius, padding', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final r = t.view(0, {'alignItems': 'flex-start'});
      t.text(r, 'chip', {'fontSize': '12px', 'backgroundColor': '#ffcc00', 'borderRadius': '9px', 'padding': '2px 8px', 'margin': '3px'});
      t.text(r, 'sized', {'fontSize': '12px', 'width': '80px', 'height': '30px', 'backgroundColor': '#99ccff'});
      return t.build();
    });
  });

  testWidgets('flex-grow ratios in a row and in a sized column', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final row = t.view(0, {'flexDirection': 'row', 'width': '300px', 'height': '40px', 'alignItems': 'stretch'});
      t.view(row, {'flexGrow': 1, 'backgroundColor': '#ff0000'});
      t.view(row, {'flexGrow': 2, 'backgroundColor': '#00ff00'});
      t.view(row, {'width': '30px', 'backgroundColor': '#0000ff'});
      return t.build();
    });
    await expectParity(tester, () {
      final t = FixtureTree();
      final col = t.view(0, {'width': '100px', 'height': '200px', 'alignItems': 'flex-start'});
      t.view(col, {'width': '20px', 'height': '20px', 'backgroundColor': '#555555'});
      t.view(col, {'flexGrow': 1, 'width': '30px', 'backgroundColor': '#ff00ff'});
      t.view(col, {'flexGrow': 3, 'width': '40px', 'backgroundColor': '#00ffff'});
      return t.build();
    });
  });

  testWidgets('row default align-items is center (not CSS stretch)', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final row = t.view(0, {'flexDirection': 'row', 'backgroundColor': '#eeeeee'});
      t.view(row, {'width': '20px', 'height': '60px', 'backgroundColor': '#cc0000'});
      t.view(row, {'width': '20px', 'height': '20px', 'backgroundColor': '#00cc00'});
      t.text(row, 'mid', {'fontSize': '12px'});
      return t.build();
    });
  });

  testWidgets('nested four deep with margin and padding', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final a = t.view(0, {'padding': '6px', 'backgroundColor': '#f0f0ff'});
      final b = t.view(a, {'flexDirection': 'row', 'margin': '4px', 'gap': '5px', 'backgroundColor': '#e0ffe0'});
      final c = t.view(b, {'padding': '3px', 'backgroundColor': '#ffe0e0', 'alignItems': 'flex-start'});
      final d = t.view(c, {'flexDirection': 'row', 'justifyContent': 'space-between', 'width': '120px'});
      t.text(d, 'L', {'fontSize': '12px'});
      t.text(d, 'R', {'fontSize': '12px'});
      t.text(b, 'sib', {'fontSize': '12px'});
      return t.build();
    });
  });

  testWidgets('display:none children vanish; an empty sized view still paints', (tester) async {
    await expectParity(tester, () {
      final t = FixtureTree();
      final r = t.view(0);
      t.text(r, 'one', {'fontSize': '12px'});
      t.view(r, {'display': 'none'});
      t.text(r, 'two', {'fontSize': '12px', 'display': 'none'});
      t.view(r, {'width': '0px'}); // zero-width cross size: still counts for parity
      t.text(r, 'three', {'fontSize': '12px'});
      return t.build();
    }, allowRejected: true);
    await expectParity(tester, () {
      final t = FixtureTree();
      final r = t.view(0, {'alignItems': 'flex-start'});
      t.view(r, {'width': '40px', 'height': '40px', 'backgroundColor': '#123456', 'borderRadius': '20px'});
      return t.build();
    });
  });

  testWidgets('gap with justify-content space-* (spacers count as items)', (tester) async {
    for (final j in ['space-between', 'space-around', 'space-evenly', 'center', 'flex-end']) {
      await expectParity(tester, () {
        final t = FixtureTree();
        final row = t.view(0, {'flexDirection': 'row', 'width': '300px', 'justifyContent': j, 'gap': '6px'});
        for (var i = 0; i < 3; i++) {
          t.view(row, {'width': '30px', 'height': '20px', 'backgroundColor': '#44aa44'});
        }
        return t.build();
      }, reason: j);
    }
  });

  testWidgets('percentages, auto margins, wrap and positioned boxes are refused, not approximated', (tester) async {
    for (final style in [
      {'width': '50%'},
      {'margin': '0 auto'},
      {'flexWrap': 'wrap'},
      {'position': 'absolute'},
      {'minWidth': '10px'},
      {'opacity': '0.5'},
      {'border': '1px solid #000000'},
    ]) {
      MirrorTree build() {
        final t = FixtureTree();
        final r = t.view(0, style);
        t.text(r, 'x', {'fontSize': '12px'});
        return t.build();
      }

      // the container itself must be refused ...
      fjsFlatMode = FjsFlatMode.force;
      final tree = build();
      expect(FlatGate.pureSize(tree.node(1)!, tree), -1, reason: 'container with $style went flat');
      // ... and the page must still be drawn exactly as before
      await expectParity(tester, build, allowRejected: true, reason: '$style');
    }
  });
}
