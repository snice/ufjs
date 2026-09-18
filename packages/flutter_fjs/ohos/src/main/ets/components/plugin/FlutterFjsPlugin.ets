import {
  FlutterPlugin,
  FlutterPluginBinding,
} from '@ohos/flutter_ohos';

/**
 * flutter_fjs has no platform channels — the JS engine is pure C++ shipped as
 * a prebuilt libfjs.so in libs/arm64-v8a and driven from Dart via dart:ffi.
 * This class only satisfies the ohos plugin registration contract (and makes
 * the HAR — libs included — land in the consuming app); like the Android and
 * iOS shims it must stay a no-op.
 */
export default class FlutterFjsPlugin implements FlutterPlugin {
  getUniqueClassName(): string {
    return 'FlutterFjsPlugin';
  }

  onAttachedToEngine(binding: FlutterPluginBinding): void {}

  onDetachedFromEngine(binding: FlutterPluginBinding): void {}
}
