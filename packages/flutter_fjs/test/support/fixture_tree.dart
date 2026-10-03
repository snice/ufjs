// specs/193: a tiny builder for hand-rolled MirrorTree fixtures (parity tests,
// gate tests). Styles are interned like the real op stream does: one
// DEFINE_STYLE per distinct style map.
import 'dart:convert';

import 'package:flutter_fjs/src/mirror_tree.dart';

import 'grid_tree.dart';

class FixtureTree {
  final GridFrameWriter _w = GridFrameWriter();
  final Map<String, int> _styleIds = {};
  int _nextId = 1;
  final List<int> ids = [];

  int _style(Map<String, Object?> style) {
    final json = jsonEncode(style);
    return _styleIds.putIfAbsent(json, () {
      final id = _styleIds.length + 1;
      _w.defineStyle(id, json);
      return id;
    });
  }

  /// Creates a node under [parent] (0 = the host root) and returns its id.
  int node(
    int parent,
    String tag, {
    Map<String, Object?> style = const {},
    String? text,
    Map<String, Object?>? props,
  }) {
    final id = _nextId++;
    _w.create(id, tag);
    if (style.isNotEmpty) _w.setStyle(id, _style(style));
    if (props != null) _w.setProps(id, jsonEncode(props));
    if (text != null) _w.setText(id, text);
    _w.insert(parent, id, ids.where((i) => _parents[i] == parent).length);
    _parents[id] = parent;
    ids.add(id);
    return id;
  }

  final Map<int, int> _parents = {};

  int view(int parent, [Map<String, Object?> style = const {}]) =>
      node(parent, 'view', style: style);

  int text(int parent, String t, [Map<String, Object?> style = const {}]) =>
      node(parent, 'text', style: style, text: t);

  MirrorTree build() => MirrorTree()
    ..applyFrame(_w.frame)
    ..flushDirty();
}
