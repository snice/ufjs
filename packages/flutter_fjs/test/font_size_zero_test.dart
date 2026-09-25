// `font-size: 0` is valid CSS — vant's `.van-loading` uses it to swallow the
// whitespace between spinner and text — and Flutter's StrutStyle asserts a
// positive size. The loading Toast painted a red error box (specs/137).
import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_fjs/src/widgets/text.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('font-size: 0 resolves to an invisible positive size', () {
    final style = fjsTextStyle(
      FjsStyle({
        'style': {'fontSize': 0},
      }),
    );
    expect(style.fontSize, greaterThan(0));
    expect(style.fontSize, lessThan(0.01));
  });

  testWidgets('a paragraph at font-size: 0 builds without an assertion', (
    tester,
  ) async {
    final style = fjsTextStyle(
      FjsStyle({
        'style': {'fontSize': 0},
      }),
    );
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Center(
          child: Text(
            'x',
            style: style,
            strutStyle: StrutStyle.fromTextStyle(style, forceStrutHeight: true),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(tester.getSize(find.text('x')).height, lessThan(1));
  });
}
