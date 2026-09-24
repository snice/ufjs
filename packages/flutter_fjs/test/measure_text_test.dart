// fjs.ui.measureText (specs/128): a paragraph's laid-out size at a width,
// what vant's TextEllipsis reads as a detached div's offsetHeight.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/geometry.dart' show measureTextBlock;

List<num> _measure(Map<String, Object?> style, String text, double width) =>
    (jsonDecode(measureTextBlock(jsonEncode(style), text, width)) as List)
        .cast<num>();

void main() {
  const style = {'fontSize': 14, 'lineHeight': 1.6};

  testWidgets('one line is one line box tall', (tester) async {
    final r = _measure(style, 'abc', 300);
    expect(r[2], 1);
    // Flutter settles a line on whole pixels: 22.4 lays out as 22
    expect(r[1], closeTo(14 * 1.6, 1));
  });

  testWidgets('longer text wraps into more lines at the same width', (
    tester,
  ) async {
    final short = _measure(style, 'word ' * 5, 120);
    final long = _measure(style, 'word ' * 40, 120);
    expect(long[2], greaterThan(short[2]));
    // every line is the line-height, as a CSS line box is
    expect(long[1], closeTo(long[2] * 14 * 1.6, long[2] * 1.0));
    expect(long[0], lessThanOrEqualTo(120));
  });

  testWidgets('no width means no wrapping', (tester) async {
    expect(_measure(style, 'word ' * 40, 0)[2], 1);
  });
}
