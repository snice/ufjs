// Relative lengths: `%` and `calc()`.
//
// The parser's job is to reduce any expression to one absolute term plus one
// relative term; the widget layer then resolves that pair against whatever
// the parent offers. These tests pin both halves — the reduction, and the
// "unbounded parent means auto" rule the resolution follows from CSS.
import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/render/decoration.dart';
import 'package:flutter_fjs/src/render/length.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_test/flutter_test.dart';

FjsStyle styled(Map<String, Object?> style) => FjsStyle({'style': style});

void main() {
  group('parsing', () {
    test('absolute forms are unchanged', () {
      expect(parseFjsLength(12), const FjsLength.px(12));
      expect(parseFjsLength('12'), const FjsLength.px(12));
      expect(parseFjsLength('12px'), const FjsLength.px(12));
      expect(parseFjsLength('-4.5px'), const FjsLength.px(-4.5));
    });

    test('percentages keep their fraction', () {
      expect(parseFjsLength('50%'), const FjsLength(0, 0.5));
      expect(parseFjsLength('100%'), const FjsLength(0, 1));
      expect(parseFjsLength('0%'), const FjsLength(0, 0));
    });

    test('calc() reduces to px + percent', () {
      expect(parseFjsLength('calc(100% - 32px)'), const FjsLength(-32, 1));
      expect(parseFjsLength('calc(50% + 8px)'), const FjsLength(8, 0.5));
      expect(parseFjsLength('calc(100% / 3)'), const FjsLength(0, 1 / 3));
      expect(parseFjsLength('calc(2 * 8px)'), const FjsLength(16, 0));
      expect(
        parseFjsLength('calc(100% - (8px + 4px))'),
        const FjsLength(-12, 1),
      );
      // a sign glued to the number is part of it, not an operator
      expect(parseFjsLength('calc(-8px + 100%)'), const FjsLength(-8, 1));
      expect(parseFjsLength('CALC(100% - 10PX)'), const FjsLength(-10, 1));
    });

    test('what it refuses', () {
      expect(parseFjsLength('auto'), isNull);
      expect(parseFjsLength('2em'), isNull, reason: 'em never reaches Dart');
      expect(parseFjsLength('calc(50% * 50%)'), isNull);
      expect(parseFjsLength('calc(100% - )'), isNull);
      expect(parseFjsLength('calc(100% / 0)'), isNull);
      expect(parseFjsLength('calc(100vw - 8px)'), isNull);
    });
  });

  group('resolution', () {
    test('a percentage of an unbounded box is auto, as in CSS', () {
      expect(const FjsLength(0, 0.5).resolveOrNull(200), 100);
      expect(const FjsLength(0, 0.5).resolveOrNull(double.infinity), isNull);
      // an absolute length does not care what contains it
      expect(const FjsLength.px(12).resolveOrNull(double.infinity), 12);
    });

    test('calc() mixes the two parts', () {
      expect(const FjsLength(-32, 1).resolveOrNull(320), 288);
    });
  });

  group('FjsStyle', () {
    test('width reads absolute only, widthLength keeps the fraction', () {
      final s = styled({'width': '50%', 'height': '20px'});
      expect(s.width, isNull, reason: 'no pixels to give before layout');
      expect(s.widthLength, const FjsLength(0, 0.5));
      expect(s.height, 20);
      expect(s.heightLength, const FjsLength.px(20));
    });

    test('min/max resolve against the parent when asked to', () {
      final s = styled({'maxWidth': '80%', 'minHeight': '10px'});
      expect(s.hasRelativeConstraints, isTrue);
      expect(
        s.constraints?.maxWidth,
        double.infinity,
        reason: 'the build-time getter cannot know the parent',
      );
      final resolved = s.constraintsIn(const BoxConstraints(maxWidth: 200));
      expect(resolved?.maxWidth, 160);
      expect(resolved?.minHeight, 10);
    });

    test('an absolute-only style never goes near the relative path', () {
      expect(styled({'maxWidth': '100px'}).hasRelativeConstraints, isFalse);
    });
  });

  group('layout', () {
    testWidgets('a percentage width is a fraction of the parent box', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          width: 300,
          child: _styledBox({'width': '50%', 'height': '20px'}),
        ),
      );
      expect(
        tester.getSize(find.byKey(const ValueKey('box'))),
        const Size(150, 20),
      );
    });

    testWidgets('calc() subtracts from the parent box', (tester) async {
      await tester.pumpWidget(
        _host(
          width: 300,
          child: _styledBox({'width': 'calc(100% - 40px)', 'height': '20px'}),
        ),
      );
      expect(tester.getSize(find.byKey(const ValueKey('box'))).width, 260);
    });

    testWidgets('a percentage of an unbounded axis falls back to auto', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          width: 300,
          // inside a scrollable the height is unbounded: nothing to be 50% of,
          // so the box takes its content's height instead of throwing
          scrollable: true,
          child: _styledBox({'width': '50%', 'height': '50%'}),
        ),
      );
      expect(
        tester.getSize(find.byKey(const ValueKey('box'))),
        const Size(150, 40),
      );
    });
  });
}

/// The node's box, built the way the widget layer builds one.
Widget _styledBox(Map<String, Object?> style) =>
    decorateNode(styled(style), const SizedBox(width: 10, height: 40));

Widget _host({
  required double width,
  required Widget child,
  bool scrollable = false,
}) {
  final box = KeyedSubtree(key: const ValueKey('box'), child: child);
  return Directionality(
    textDirection: TextDirection.ltr,
    // the test surface hands down TIGHT constraints, which a SizedBox would
    // have to ignore; the Align makes them loose so the parent box really is
    // the size the percentages are measured against
    child: Align(
      alignment: Alignment.topLeft,
      child: SizedBox(
        width: width,
        height: 400,
        child: scrollable
            ? SingleChildScrollView(
                // a vertical scroll view hands its child a TIGHT width; the
                // Align loosens it, the way the flow of a real page does
                child: Align(alignment: Alignment.topLeft, child: box),
              )
            : Align(alignment: Alignment.topLeft, child: box),
      ),
    ),
  );
}
