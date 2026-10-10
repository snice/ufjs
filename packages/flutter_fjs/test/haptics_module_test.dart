// The built-in haptics host module (`fjs.vibrate`, specs/215) against the
// mockable platform channel. Audio is NOT here: it lives in the
// @ufjs/audio module package (constitution IX — third-party pub deps stay
// out of the core), and its audible path cannot be unit-tested without
// faking audioplayers internals anyway.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_fjs/src/haptics.dart';
import 'package:flutter_fjs/src/registry/host.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('fjs.vibrate maps intensities onto HapticFeedback', () async {
    final host = HostRegistry();
    registerHapticsModule(host: host);

    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      calls.add(call);
      return null;
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null);
    });

    host.invoke('fjs.vibrate', ['light']);
    host.invoke('fjs.vibrate', ['medium']);
    host.invoke('fjs.vibrate', ['heavy']);
    host.invoke('fjs.vibrate', ['long']);
    host.invoke('fjs.vibrate', <Object?>[]); // no arg = wx default (heavy)
    await Future<void>.delayed(Duration.zero);

    final mapped = calls.map((c) => '${c.method}:${c.arguments ?? 'none'}').toList();
    expect(mapped, [
      'HapticFeedback.vibrate:HapticFeedbackType.lightImpact',
      'HapticFeedback.vibrate:HapticFeedbackType.mediumImpact',
      'HapticFeedback.vibrate:HapticFeedbackType.heavyImpact',
      'HapticFeedback.vibrate:none',
      'HapticFeedback.vibrate:HapticFeedbackType.heavyImpact',
    ]);
  });
}
