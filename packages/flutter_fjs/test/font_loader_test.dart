// specs/071: `@font-face` fonts on the Flutter side — the `font-family`
// stack as CSS reads it, and `fjs.font.load` registering a TrueType data URL
// so private-use icon glyphs draw from it. The fixture is vant's icon font
// (MIT), decoded from the WOFF2 vant inlines (see packages/fjs
// test/fixtures/README.md).
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/font_loader.dart';
import 'package:flutter_fjs/src/registry/host.dart';
import 'package:flutter_fjs/src/render/style.dart';

/// Dark pixels in a 40×40 render of [text] in [family]: a fallback font's
/// solid box inks nearly all of its em square, an icon outline far less.
Future<int> _ink(WidgetTester tester, String family, String text) async {
  final key = GlobalKey();
  await tester.pumpWidget(
    Directionality(
      textDirection: TextDirection.ltr,
      child: Center(
        child: RepaintBoundary(
          key: key,
          child: Container(
            color: Colors.white,
            width: 40,
            height: 40,
            alignment: Alignment.center,
            child: Text(
              text,
              style: TextStyle(fontFamily: family, fontSize: 32, color: Colors.black, height: 1),
            ),
          ),
        ),
      ),
    ),
  );
  final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  final data = await tester.runAsync(() async {
    final image = await boundary.toImage();
    return image.toByteData(format: ui.ImageByteFormat.rawRgba);
  });
  final bytes = data!.buffer.asUint8List();
  var dark = 0;
  for (var i = 0; i < bytes.length; i += 4) {
    if (bytes[i] < 128) dark++;
  }
  return dark;
}

void main() {
  group('font-family stack', () {
    List<String> stack(String v) => FjsStyle({
          'style': {'fontFamily': v},
        }).fontFamilyStack;

    test('strips quotes and keeps the order', () {
      expect(stack('"vant-icon"'), ['vant-icon']);
      expect(stack("'PingFang SC', \"Helvetica Neue\", Arial"), ['PingFang SC', 'Helvetica Neue', 'Arial']);
      final s = FjsStyle({
        'style': {'fontFamily': '"my-icons", Arial'},
      });
      expect(s.fontFamily, 'my-icons');
      expect(s.fontFamilyFallback, ['Arial']);
    });

    test('a system or generic name ends the stack (platform default)', () {
      // vant's body stack: Safari shows the system font, so must we
      expect(stack('-apple-system-font, helvetica neue, arial, sans-serif'), isEmpty);
      expect(stack('"my-font", system-ui, Arial'), ['my-font']);
      expect(FjsStyle({
        'style': {'fontFamily': 'sans-serif'},
      }).fontFamily, isNull);
    });

    test('monospace ends the stack as a real font name', () {
      expect(stack('Menlo2, monospace, Arial'), hasLength(2));
    });
  });

  group('fjs.font.load', () {
    final ttf = File('test/fixtures/vant-icon.ttf').readAsBytesSync();
    final url = 'data:font/ttf;base64,${base64Encode(ttf)}';

    setUp(FjsFontLoader.resetForTest);

    testWidgets('draws private-use glyphs from the loaded font', (tester) async {
      const arrowLeft = '\ue668'; // .van-icon-arrow-left:before
      final before = await _ink(tester, 'vant-icon-t1', arrowLeft);
      final ok = await tester.runAsync(() => FjsFontLoader.load('vant-icon-t1', url));
      expect(ok, isTrue);
      await tester.pump();
      final after = await _ink(tester, 'vant-icon-t1', arrowLeft);
      expect(after, greaterThan(0));
      // an arrow outline inks a fraction of what the fallback box did
      expect(after, lessThan(before * 0.6));
    });

    testWidgets('is reachable through the host registry', (tester) async {
      final host = HostRegistry();
      final logs = <String>[];
      FjsFontLoader.register(host, log: (_, m) => logs.add(m));
      await tester.runAsync(() async {
        host.invoke('fjs.font.load', ['vant-icon-t2', url]);
        // the handler is fire-and-forget; give the engine a moment
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      expect(logs, isEmpty);
    });

    test('bad input logs, naming the family, and does not throw', () async {
      final logs = <String>[];
      expect(await FjsFontLoader.load('broken', 'data:font/ttf,notbase64', log: (_, m) => logs.add(m)), isFalse);
      expect(await FjsFontLoader.load('broken', 'https://x.test/a.ttf', log: (_, m) => logs.add(m)), isFalse);
      expect(logs, hasLength(2));
      expect(logs.first, contains('"broken"'));
    });
  });
}
