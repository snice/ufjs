// Single-side borders (spec 041): per-side cascade in [FjsStyle.boxBorders],
// the three painting routes in [decorateNode], and the side painter's
// geometry.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/render/dashed_border.dart';
import 'package:flutter_fjs/src/render/decoration.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_fjs/src/render/style_parse.dart';
import 'package:flutter_test/flutter_test.dart';

FjsStyle styled(Map<String, Object?> style) => FjsStyle({'style': style});

Widget box(Map<String, Object?> style, {Color? defaultBorderColor}) =>
    Directionality(
      textDirection: TextDirection.ltr,
      child: Center(
        child: SizedBox(
          width: 100,
          height: 40,
          child: decorateNode(
            styled(style),
            const SizedBox.expand(),
            defaultBorderColor: defaultBorderColor,
          ),
        ),
      ),
    );

void main() {
  group('per-side cascade', () {
    test('a side shorthand styles exactly that side', () {
      final b = styled({'borderBottom': '1px solid #ff0000'}).boxBorders()!;
      expect(b.bottom!.width, 1);
      expect(b.bottom!.color, const Color(0xFFFF0000));
      expect(b.top, isNull);
      expect(b.right, isNull);
      expect(b.left, isNull);
    });

    test(
      'side longhand > side shorthand > global longhand > global shorthand',
      () {
        final b = styled({
          'border': '1px solid #000000',
          'borderBottom': '2px solid #111111',
          'borderBottomWidth': 4,
        }).boxBorders()!;
        // bottom: the side longhand width wins, the side shorthand color stays
        expect(b.bottom!.width, 4);
        expect(b.bottom!.color, const Color(0xFF111111));
        // the other sides only saw the global shorthand
        expect(b.top!.width, 1);
        expect(b.top!.color, const Color(0xFF000000));
      },
    );

    test('a lone side style implies the 1px hairline, a lone color nothing', () {
      // border-style's initial value is none: a color alone paints nothing,
      // as on web (NutUI's divider takes an inline border-color for its
      // pseudo lines only)
      expect(styled({'borderBottomColor': '#123456'}).boxBorders(), isNull);
      expect(styled({'borderColor': '#123456'}).boxBorders(), isNull);
      // a width from border-width makes the color draw
      final b = styled({
        'borderWidth': '1px',
        'borderBottomColor': '#123456',
      }).boxBorders()!;
      expect(b.bottom!.color, const Color(0xFF123456));
      expect(
        styled({'borderBottomStyle': 'dashed'}).boxBorders()!.bottom!.kind,
        FjsBorderStyle.dashed,
      );
    });

    test('none and zero width turn the side off', () {
      expect(styled({'borderBottom': 'none'}).boxBorders(), isNull);
      expect(styled({'borderBottomWidth': 0}).boxBorders(), isNull);
      // global none with a side color: still no border (style stays none)
      expect(
        styled({
          'border': 'none',
          'borderBottomColor': '#000000',
        }).boxBorders(),
        isNull,
      );
    });

    test('the built-in default fills only undeclared sides', () {
      const chrome = Color(0x29000000);
      // nothing declared: all four sides get the hairline (button's look)
      final plain = styled({}).boxBorders(defaultBorderColor: chrome)!;
      for (final s in [plain.top, plain.right, plain.bottom, plain.left]) {
        expect(s!.width, 1);
        expect(s.color, chrome);
      }
      // `border-bottom: none`: bottom off, the other three keep the default
      final mixed = styled({
        'borderBottom': 'none',
      }).boxBorders(defaultBorderColor: chrome)!;
      expect(mixed.bottom, isNull);
      expect(mixed.top!.color, chrome);
      expect(mixed.left!.color, chrome);
      // and with no default, an undeclared side is just absent
      expect(
        styled({'borderTop': '1px solid #000'}).boxBorders()!.bottom,
        isNull,
      );
    });

    test('dashed sides are visible to the painter routing', () {
      final b = styled({'border': '2px dashed #cccccc'}).boxBorders()!;
      expect(b.hasDashed, isTrue);
      expect(b.isUniform, isTrue);
      final mixed = styled({
        'borderTop': '1px solid #cccccc',
        'borderBottom': '1px dashed #cccccc',
      }).boxBorders()!;
      expect(mixed.hasDashed, isTrue);
      expect(mixed.isUniform, isFalse);
    });

    test('hasBorderDeclaration covers the side keys', () {
      expect(styled({'borderBottom': 'none'}).hasBorderDeclaration, isTrue);
      expect(
        styled({'borderLeftColor': '#fff'}).hasSideBorderDeclaration,
        isTrue,
      );
    });
  });

  group('painting routes', () {
    testWidgets('mixed solid sides without a radius use a per-side Border', (
      tester,
    ) async {
      await tester.pumpWidget(
        box({
          'width': 100,
          'height': 40,
          'borderTop': '1px solid #ff0000',
          'borderBottom': '3px solid #00ff00',
        }),
      );
      final decoration =
          tester.widget<Container>(find.byType(Container)).decoration
              as BoxDecoration;
      final border = decoration.border as Border;
      expect(border.top.color, const Color(0xFFFF0000));
      expect(border.top.width, 1);
      expect(border.bottom.width, 3);
      expect(border.left, BorderSide.none);
      // the decoration reserves the room: content box is 40 - 1 - 3 tall
      expect(decoration.border!.dimensions.vertical, 4);
    });

    testWidgets('a radius with uniform sides still goes through Border.all', (
      tester,
    ) async {
      await tester.pumpWidget(
        box({
          'width': 100,
          'height': 40,
          'border': '1px solid #cccccc',
          'borderRadius': 8,
        }),
      );
      final decoration =
          tester.widget<Container>(find.byType(Container)).decoration
              as BoxDecoration;
      final border = decoration.border as Border;
      expect(border.top.color, const Color(0xFFCCCCCC));
      expect(decoration.borderRadius, BorderRadius.circular(8));
    });

    testWidgets('a radius with mixed sides is painted over and inset', (
      tester,
    ) async {
      await tester.pumpWidget(
        box({
          'width': 100,
          'height': 40,
          'borderRadius': 8,
          'borderBottom': '2px solid #00ff00',
        }),
      );
      final painter = tester
          .widgetList<CustomPaint>(find.byType(CustomPaint))
          .map((c) => c.foregroundPainter)
          .whereType<FjsSideBorderPainter>()
          .single;
      expect(painter.borders.bottom!.width, 2);
      expect(painter.borderRadius, BorderRadius.circular(8));
      // room for the stroke is reserved in front of the content
      final padding = tester.widget<Padding>(
        find
            .ancestor(of: find.byType(SizedBox), matching: find.byType(Padding))
            .first,
      );
      expect(padding.padding, const EdgeInsets.only(bottom: 2));
    });

    testWidgets(
      'a button-side default keeps three sides when one is turned off',
      (tester) async {
        const chrome = Color(0x29000000);
        await tester.pumpWidget(
          Directionality(
            textDirection: TextDirection.ltr,
            child: Center(
              child: SizedBox(
                width: 100,
                height: 40,
                child: decorateNode(
                  styled({'borderBottom': 'none'}),
                  const SizedBox.expand(),
                  defaultBorderColor: chrome,
                ),
              ),
            ),
          ),
        );
        final decoration =
            tester.widget<Container>(find.byType(Container)).decoration
                as BoxDecoration;
        final border = decoration.border as Border;
        expect(border.top.color, chrome);
        expect(border.left.color, chrome);
        expect(border.bottom, BorderSide.none);
      },
    );
  });

  group('side path geometry', () {
    test('a straight top edge spans the inset width', () {
      // 100 wide inset by 1 per side: the edge alone is 98
      final path = fjsBorderSidePath(
        FjsBoxSidePosition.top,
        const Rect.fromLTRB(1, 1, 99, 39),
        null,
      );
      final length = path.computeMetrics().fold<double>(
        0,
        (n, m) => n + m.length,
      );
      expect(length, closeTo(98, 0.01));
    });

    test('rounded corners add half of each adjacent arc', () {
      const radius = BorderRadius.all(Radius.circular(8));
      final path = fjsBorderSidePath(
        FjsBoxSidePosition.top,
        const Rect.fromLTRB(1, 1, 99, 39),
        radius,
      );
      final length = path.computeMetrics().fold<double>(
        0,
        (n, m) => n + m.length,
      );
      // inset edges 98 - 2*8 = 82, plus two quarter-arc halves = one full
      // quarter circle of radius 8: 82 + 8*pi/2
      expect(length, closeTo(82 + 8 * math.pi / 2, 0.1));
    });

    testWidgets('the painter draws without hitting a decoration assertion', (
      tester,
    ) async {
      // BoxDecoration would throw on a non-uniform Border + radius; the
      // painter path must not route through it
      await tester.pumpWidget(
        box({
          'width': 100,
          'height': 40,
          'borderRadius': 8,
          'borderTop': '1px solid #ff0000',
          'borderBottom': '2px dashed #00ff00',
        }),
      );
      expect(tester.takeException(), isNull);
    });
  });
}
