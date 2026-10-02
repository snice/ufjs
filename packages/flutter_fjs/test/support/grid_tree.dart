// Shared by the specs/192 benches: the flat-4050 grid as a MirrorTree, same
// shape as mount_bench_test.dart (50 rows x 40 x (cell view + text), three
// interned styles). Copied rather than imported: that file's helpers are
// private and the probe is throwaway.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/ui_ops.dart';

class GridFrameWriter {
  final List<int> b = [];
  void u8(int v) => b.add(v & 0xff);
  void u16(int v) => b
    ..add(v & 0xff)
    ..add((v >> 8) & 0xff);
  void u32(int v) {
    final d = ByteData(4)..setUint32(0, v, Endian.little);
    b.addAll(d.buffer.asUint8List());
  }

  void raw(List<int> l) => b.addAll(l);
  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
  }

  void defineStyle(int id, String json) {
    u8(UiOpCode.defineStyle);
    u32(id);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void setStyle(int id, int sid) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(sid);
    u32(0);
  }

  void setProps(int id, String json) {
    u8(UiOpCode.setProps);
    u32(id);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void setText(int id, String t) {
    u8(UiOpCode.setText);
    u32(id);
    final j = utf8.encode(t);
    u32(j.length);
    raw(j);
  }

  void insert(int p, int c, int i) {
    u8(UiOpCode.insert);
    u32(p);
    u32(c);
    u32(i);
  }

  Uint8List get frame => Uint8List.fromList(b);
}

const gridRows = 50, gridCols = 40;

MirrorTree buildGridTree() {
  final w = GridFrameWriter()
    ..create(1, 'view')
    ..insert(0, 1, 0)
    ..defineStyle(1, '{"flexDirection":"row"}')
    ..defineStyle(2, '{"backgroundColor":"#85d8b4","margin":"0.5px"}')
    ..defineStyle(3, '{"fontSize":"5px","lineHeight":"5px"}');
  var id = 2;
  for (var r = 0; r < gridRows; r++) {
    final row = id++;
    w
      ..create(row, 'view')
      ..setStyle(row, 1)
      ..insert(1, row, r);
    for (var c = 0; c < gridCols; c++) {
      final cell = id++;
      w
        ..create(cell, 'view')
        ..setStyle(cell, 2)
        ..insert(row, cell, c);
      final text = id++;
      w
        ..create(text, 'text')
        ..setStyle(text, 3)
        ..setText(text, '$c')
        ..insert(cell, text, 0);
    }
  }
  return MirrorTree()
    ..applyFrame(w.frame)
    ..flushDirty();
}

