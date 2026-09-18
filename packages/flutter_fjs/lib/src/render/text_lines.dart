// The Dart half of the `@linechange` contract.
//
// The rules are written once, in fjs-runtime/src/textarea/lines.ts — the two
// fields, their order, the rounding, and "only a change is an event". This
// file mirrors the payload so widgets/input.dart can emit it; the gate
// itself lives on both sides (here so the bridge stays quiet, there so both
// platforms prime identically — see components/textarea.ts).
import 'dart:convert';

/// One decimal, like the JS side: text metrics differ in the last subpixel
/// between platforms and mean nothing to a page.
double _round(double value) => (value * 10).roundToDouble() / 10;

/// Serializes a `@linechange` event. The key ORDER is part of the contract,
/// and `heightRpx` is deliberately absent (fjs has no rpx coordinate system).
String fjsLineChangePayload({required double height, required int lineCount}) {
  final rounded = _round(height);
  return jsonEncode({
    // jsonEncode writes 68.0 where JS writes 68; match JS.
    'height': rounded == rounded.roundToDouble() ? rounded.toInt() : rounded,
    'lineCount': lineCount,
  });
}
