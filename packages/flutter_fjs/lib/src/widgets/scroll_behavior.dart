import 'package:flutter/gestures.dart' show PointerDeviceKind;
import 'package:flutter/material.dart';

/// Desktop-friendly scroll behavior: allow mouse-drag on scrollables
/// (Flutter desktop defaults only respond to trackpad/touch).
class FjsMouseDragScrollBehavior extends MaterialScrollBehavior {
  const FjsMouseDragScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => const {
    PointerDeviceKind.touch,
    PointerDeviceKind.mouse,
    PointerDeviceKind.stylus,
    PointerDeviceKind.trackpad,
    PointerDeviceKind.invertedStylus,
  };
}
