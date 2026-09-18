// `border: 1px dashed #ccc`. Flutter's Border only strokes solid, so a
// dashed / dotted one is painted over the box by FjsDashedBorderPainter —
// these check that the style survives resolution and that the paint
// actually happens (and that a solid border still goes through the
// decoration, unpainted by us).
import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/render/dashed_border.dart';
import 'package:flutter_fjs/src/render/decoration.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_fjs/src/render/style_parse.dart';
import 'package:flutter_test/flutter_test.dart';

FjsStyle styled(Map<String, Object?> style) => FjsStyle({'style': style});

Widget box(Map<String, Object?> style) => Directionality(
  textDirection: TextDirection.ltr,
  child: Center(
    child: SizedBox(
      width: 100,
      height: 40,
      child: decorateNode(styled(style), const SizedBox.expand()),
    ),
  ),
);

void main() {
  group('resolution', () {
    test('the shorthand carries the stroke style', () {
      expect(
        styled({'border': '1px dashed #ccc'}).border!.kind,
        FjsBorderStyle.dashed,
      );
      expect(
        styled({'border': '2px dotted #ccc'}).border!.kind,
        FjsBorderStyle.dotted,
      );
    });

    test('border-style is a longhand like the others', () {
      // the tag default is a solid shorthand; one longhand restyles it
      final restyled = styled({
        'border': '1px solid rgba(0,0,0,0.16)',
        'borderStyle': 'dashed',
      }).border!;
      expect(restyled.kind, FjsBorderStyle.dashed);
      expect(restyled.width, 1);
      // on its own it implies a 1px border, as border-color does
      expect(styled({'borderStyle': 'dashed'}).border!.width, 1);
      // ...and none still means none
      expect(
        styled({'border': '1px solid #ccc', 'borderStyle': 'none'}).border,
        isNull,
      );
    });
  });

  group('painting', () {
    testWidgets('a dashed border is stroked in pieces', (tester) async {
      await tester.pumpWidget(box({'border': '1px dashed #cccccc'}));

      final painter = tester
          .widgetList<CustomPaint>(find.byType(CustomPaint))
          .map((c) => c.foregroundPainter)
          .whereType<FjsDashedBorderPainter>()
          .single;
      expect(painter.kind, FjsBorderStyle.dashed);
      expect(painter.width, 1);
      expect(painter.color, const Color(0xFFCCCCCC));
      // more than one path means it is actually dashed, not one outline
      expect(
        find.byType(CustomPaint).last,
        paints
          ..path()
          ..path()
          ..path(),
      );
    });

    testWidgets('a dotted border draws points', (tester) async {
      await tester.pumpWidget(box({'border': '2px dotted #cccccc'}));
      expect(
        find.byType(CustomPaint).last,
        paints..something((symbol, _) => symbol == #drawPoints),
      );
    });

    testWidgets('a solid border stays in the decoration', (tester) async {
      await tester.pumpWidget(box({'border': '1px solid #cccccc'}));

      expect(
        tester
            .widgetList<CustomPaint>(find.byType(CustomPaint))
            .map((c) => c.foregroundPainter)
            .whereType<FjsDashedBorderPainter>(),
        isEmpty,
      );
      final decorated = tester.widget<Container>(find.byType(Container));
      expect(
        (decorated.decoration as BoxDecoration).border,
        Border.all(color: const Color(0xFFCCCCCC)),
      );
    });

    testWidgets('the dashed border reserves the same room as a solid one', (
      tester,
    ) async {
      await tester.pumpWidget(box({'border': '4px dashed #cccccc'}));
      final dashed = tester.getSize(find.byType(SizedBox).last);
      await tester.pumpWidget(box({'border': '4px solid #cccccc'}));
      final solid = tester.getSize(find.byType(SizedBox).last);
      expect(dashed, solid);
    });
  });
}
