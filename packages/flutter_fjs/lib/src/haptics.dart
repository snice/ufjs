// The haptics host module (specs/215): vibration is one platform ability JS
// cannot reach on its own, and it needs nothing beyond the Flutter SDK —
// which is exactly why it is BUILT IN, unlike audio (specs/215 moved that
// out to the @ufjs/audio module: anything needing a third-party pub package
// stays out of the core, constitution IX).
//
//   fjs.vibrate('light'|'medium'|'heavy'|'long')   fire and forget
//
// HapticFeedback is fire-and-forget from the platform's perspective — there
// is no completion to report and wx has no vibrate callback either, so the
// module stays synchronous and silent.
import 'package:flutter/services.dart' show HapticFeedback;

import 'registry/host.dart';

/// Wires `fjs.vibrate` into [host].
void registerHapticsModule({required HostRegistry host}) {
  host.register('fjs.vibrate', (args) {
    switch (args.isNotEmpty ? args.first?.toString() : 'heavy') {
      case 'light':
        HapticFeedback.lightImpact();
      case 'medium':
        HapticFeedback.mediumImpact();
      case 'long':
        HapticFeedback.vibrate();
      default:
        // 'heavy' and the no-arg call — wx's default is heavy
        HapticFeedback.heavyImpact();
    }
    return null;
  });
}
