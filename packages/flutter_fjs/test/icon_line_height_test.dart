// vant's icon: `<i>` (a paragraph here) with `font: 28px/1 vant-icon` whose
// glyph sits in an inline-block `::before` box. CSS: the line is 28 tall.
// Flutter took the metrics of a line with no glyph of its own from the
// paragraph-level TextHeightBehavior, whose leading distribution defaults
// to proportional, while the glyph run used even — with a font whose
// ascent + descent is not 1em the two baselines disagreed and the line
// grew by the difference (a 30px icon on iOS, specs/131).
//
// Needs fonts with real metrics (the test font's ascent + descent is
// exactly 1em, no line gap): vant-icon itself (test/fixtures, decoded from
// vant's MIT-licensed woff2 — 896/128 per 1024 with a 92 line gap), and
// Roboto from the Flutter SDK (ascent + descent 1.17em), skipped when absent.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
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

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    u16(tag.length);
    b.addAll(utf8.encode(tag));
  }

  void props(int id, Map<String, Object?> style) {
    u8(UiOpCode.setProps);
    u32(id);
    final bytes = utf8.encode(jsonEncode({'style': style}));
    u32(bytes.length);
    b.addAll(bytes);
  }

  void text(int id, String t) {
    u8(UiOpCode.setText);
    u32(id);
    final bytes = utf8.encode(t);
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

File? _roboto() {
  final root = Platform.environment['FLUTTER_ROOT'];
  if (root == null) return null;
  final f = File('$root/bin/cache/artifacts/material_fonts/Roboto-Regular.ttf');
  return f.existsSync() ? f : null;
}

void main() {
  final fonts = {
    'vant-icon': (File('test/fixtures/vant-icon.ttf'), '\ue700'),
    'Roboto': (_roboto(), 'x'),
  };
  for (final MapEntry(key: name, value: (font, text)) in fonts.entries) {
    for (final size in [12, 28, 36]) {
      testWidgets(
        '$name: an icon <i> at ${size}px is max($size, 28) tall',
        (tester) async {
          final family = 'probe-$name';
          final loader = FontLoader(family)
            ..addFont(
              Future.value(ByteData.sublistView(font!.readAsBytesSync())),
            );
          await tester.runAsync(() => loader.load());
          final glyph = {
            'fontFamily': family,
            'fontSize': 28,
            'fontWeight': 'normal',
            'lineHeight': '1',
          };
          final w = _W();
          w.create(1, 'view');
          w.props(1, {
            'width': 300,
            'flexDirection': 'row',
            'alignItems': 'flex-start',
          });
          w.insert(0, 1);
          w.create(2, 'text');
          w.props(2, {...glyph, 'fontSize': size, 'display': 'inline-block'});
          w.insert(1, 2);
          w.create(3, 'view');
          w.props(3, {...glyph, 'display': 'inline-block'});
          w.insert(2, 3);
          w.create(4, 'text');
          w.props(4, glyph);
          w.text(4, text);
          w.insert(3, 4);
          // Vue's empty text anchors around the badge slot
          for (final id in [5, 6]) {
            w.create(id, 'text');
            w.props(id, glyph);
            w.text(id, '');
            w.insert(2, id);
          }
          final tree = MirrorTree()..applyFrame(Uint8List.fromList(w.b));
          await tester.pumpWidget(
            MaterialApp(
              home: Align(
                alignment: Alignment.topLeft,
                child: FjsNodeRenderer(
                  tree: tree,
                  ids: tree.rootChildren,
                  dispatch: (_, __, {text}) {},
                ),
              ),
            ),
          );
          RenderObject? r = tester.renderObject(
            find.byKey(const ValueKey<int>(3)).first,
          );
          while (r != null && r is! RenderParagraph) {
            r = r.parent;
          }
          expect(
            (r! as RenderParagraph).size.height,
            closeTo(size < 28 ? 28 : size, 0.5),
          );
        },
        skip: font == null,
      );
    }
  }
}
