// specs/193 T030: incremental layout must give exactly what a full layout
// gives. A fixed-seed random sequence of edits (text, style swaps, inserts,
// removals, hide/show) is applied to one tree twice — once through the ordinary
// renderer, once through a flat surface that stays mounted across all of them,
// so it takes the incremental path — and every step's node rects and pixels
// are compared. A cache invalidation missed anywhere in flat_layout.dart shows
// up here as a rect that stayed where it used to be.
import 'dart:typed_data';
import 'dart:ui' show Size;

import 'package:flutter_fjs/src/flat/flat_gate.dart';
import 'package:flutter_fjs/src/flat/flat_layout.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/grid_tree.dart';
import 'support/parity.dart' show renderSequence;


// style pools (all inside the flat subset)
const _boxStyles = <Map<String, Object?>>[
  {'flexDirection': 'row', 'alignItems': 'flex-start', 'gap': '3px'},
  {'alignItems': 'center', 'padding': '4px', 'backgroundColor': '#ddeedd'},
  {},
  {'flexDirection': 'row', 'justifyContent': 'space-between', 'margin': '2px', 'backgroundColor': '#eeddee'},
  {'alignItems': 'flex-end', 'padding': '2px 6px', 'borderRadius': '5px', 'backgroundColor': '#ccddff'},
];
const _textStyles = <Map<String, Object?>>[
  {'fontSize': '12px'},
  {'fontSize': '16px', 'color': '#aa0000', 'margin': '1px'},
  {'fontSize': '10px', 'backgroundColor': '#ffee99', 'padding': '1px 3px'},
  {'fontSize': '14px', 'fontWeight': 'bold'},
];
const _hidden = {'display': 'none'};

class _Model {
  final kids = <int, List<int>>{};
  final isText = <int, bool>{};
  int next = 2;
}

class _Rng {
  _Rng(this.s);
  int s;
  int next(int n) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >> 8) % n;
  }
}

String _json(Map<String, Object?> m) {
  final b = StringBuffer('{');
  var first = true;
  m.forEach((k, v) {
    if (!first) b.write(',');
    first = false;
    b.write('"$k":${v is num ? v : '"$v"'}');
  });
  b.write('}');
  return b.toString();
}

/// style id for pool [i]: boxes 100.., texts 200.., hidden 300
int _boxId(int i) => 100 + i;
int _textId(int i) => 200 + i;
const _hiddenId = 300;

final List<String> _labels = [];

List<Uint8List> _script(int seed, int steps) {
  _labels.clear();
  _labels.add('initial');
  final rng = _Rng(seed);
  final m = _Model();
  final frames = <Uint8List>[];
  // frame 0: styles, a root box with three rows of three leaves
  final w = GridFrameWriter();
  for (var i = 0; i < _boxStyles.length; i++) {
    w.defineStyle(_boxId(i), _json(_boxStyles[i]));
  }
  for (var i = 0; i < _textStyles.length; i++) {
    w.defineStyle(_textId(i), _json(_textStyles[i]));
  }
  w.defineStyle(_hiddenId, _json(_hidden));
  w
    ..create(1, 'view')
    ..setStyle(1, _boxId(2))
    ..insert(0, 1, 0);
  m.kids[1] = [];
  m.isText[1] = false;
  void addNode(GridFrameWriter w, int parent, bool text, {int? index}) {
    final id = m.next++;
    w.create(id, text ? 'text' : 'view');
    w.setStyle(id, text ? _textId(rng.next(_textStyles.length)) : _boxId(rng.next(_boxStyles.length)));
    if (text) w.setText(id, '${rng.next(1000)}');
    final list = m.kids[parent]!;
    final at = index ?? list.length;
    w.insert(parent, id, at);
    list.insert(at, id);
    m.isText[id] = text;
    if (!text) m.kids[id] = [];
  }

  for (var r = 0; r < 3; r++) {
    addNode(w, 1, false);
    final row = m.kids[1]!.last;
    for (var c = 0; c < 3; c++) {
      addNode(w, row, true);
    }
  }
  frames.add(w.frame);

  final boxes = () => [for (final e in m.isText.entries) if (!e.value) e.key];
  for (var step = 0; step < steps; step++) {
    final f = GridFrameWriter();
    final all = m.isText.keys.where((k) => k != 1).toList();
    switch (rng.next(6)) {
      case 0 || 1: // text edit
        final texts = [for (final k in all) if (m.isText[k]!) k];
        if (texts.isEmpty) continue;
        final tid = texts[rng.next(texts.length)];
        f.setText(tid, 'v${rng.next(100000)}');
        _labels.add('text edit node $tid');
      case 2: // style swap
        if (all.isEmpty) continue;
        final id = all[rng.next(all.length)];
        final ns = m.isText[id]! ? _textId(rng.next(_textStyles.length)) : _boxId(rng.next(_boxStyles.length));
        f.setStyle(id, ns);
        _labels.add('style swap node $id -> $ns');
      case 3: // insert a leaf or a box with a leaf
        final bs = boxes();
        final p = bs[rng.next(bs.length)];
        final at = rng.next(m.kids[p]!.length + 1);
        if (rng.next(3) == 0) {
          addNode(f, p, false, index: at);
          addNode(f, m.kids[p]![at], true);
          _labels.add('insert box+leaf under $p at $at');
        } else {
          addNode(f, p, true, index: at);
          _labels.add('insert leaf under $p at $at');
        }
      case 4: // remove a node (and its subtree)
        if (all.isEmpty) continue;
        final id = all[rng.next(all.length)];
        void drop(int n) {
          for (final k in List<int>.of(m.kids[n] ?? const [])) {
            drop(k);
          }
          m.kids.remove(n);
          m.isText.remove(n);
        }

        for (final l in m.kids.values) {
          l.remove(id);
        }
        drop(id);
        f.u8(2);
        f.u32(id);
        _labels.add('remove node $id');
      default: // hide / show
        if (all.isEmpty) continue;
        final id = all[rng.next(all.length)];
        final hide = rng.next(2) == 0;
        f.setStyle(id, hide ? _hiddenId : (m.isText[id]! ? _textId(0) : _boxId(2)));
        _labels.add('${hide ? 'hide' : 'show'} node $id');
    }
    if (f.b.isNotEmpty) frames.add(f.frame);
  }
  return frames;
}

void main() {
  tearDown(() => fjsFlatMode = FjsFlatMode.auto);

  for (final seed in [7, 21, 99, 12345, 777, 4242, 31337, 5, 88, 2024, 1001, 65535]) {
    testWidgets('incremental == ordinary over a random edit sequence (seed $seed)', (tester) async {
      addTearDown(tester.view.reset);
      final frames = _script(seed, 100);
      final ordinary = await renderSequence(tester, frames, FjsFlatMode.off, viewport: const Size(2400, 3000));
      FlatStats.reset();
      final flat = await renderSequence(tester, frames, FjsFlatMode.force, viewport: const Size(2400, 3000));
      expect(flat.length, ordinary.length);
      for (var i = 0; i < ordinary.length; i++) {
        final a = ordinary[i], b = flat[i];
        expect(b.rects.keys.toSet(), a.rects.keys.toSet(), reason: 'step $i (${_labels[i]}): node sets differ');
        for (final id in a.rects.keys) {
          final x = a.rects[id]!, y = b.rects[id]!;
          expect(
            (x.left - y.left).abs() < 0.01 &&
                (x.top - y.top).abs() < 0.01 &&
                (x.width - y.width).abs() < 0.01 &&
                (x.height - y.height).abs() < 0.01,
            isTrue,
            reason: 'step $i (${_labels[i]}) node $id: ordinary $x vs flat $y',
          );
        }
        if (a.overflowed || b.overflowed) continue; // debug overflow stripes, no flat equivalent
        var diff = 0;
        for (var j = 0; j < a.pixels.length; j++) {
          if (a.pixels[j] != b.pixels[j]) diff++;
        }
        expect(diff, 0, reason: 'step $i (${_labels[i]}): $diff differing pixel bytes');
      }
    });
  }
}
