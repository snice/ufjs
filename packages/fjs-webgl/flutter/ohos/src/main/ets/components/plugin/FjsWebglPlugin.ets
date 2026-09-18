import {
  FlutterPlugin,
  FlutterPluginBinding,
  MethodCall,
  MethodCallHandler,
  MethodChannel,
  MethodResult,
  SurfaceTextureEntry,
  TextureRegistry,
} from '@ohos/flutter_ohos';

/**
 * ohos side of fjs_webgl. flutter_angle has no ohos implementation, so on
 * this platform fjs_webgl runs its own backend (lib/src/ohos_surface.dart):
 * the EGL context and window surfaces are created from Dart over FFI against
 * the system libEGL/libGLESv3. The one thing Dart cannot do is register a
 * Flutter texture — that is all this class does. Each texture's
 * OHNativeWindow* goes back to Dart, which wraps it in eglCreateWindowSurface;
 * eglSwapBuffers on that surface is what the Texture widget displays.
 */
export default class FjsWebglPlugin implements FlutterPlugin, MethodCallHandler {
  private channel: MethodChannel | null = null;
  private registry: TextureRegistry | null = null;
  private entries: Map<number, SurfaceTextureEntry> = new Map();

  getUniqueClassName(): string {
    return 'FjsWebglPlugin';
  }

  onAttachedToEngine(binding: FlutterPluginBinding): void {
    this.registry = binding.getTextureRegistry();
    this.channel = new MethodChannel(binding.getBinaryMessenger(), 'fjs_webgl/ohos');
    this.channel.setMethodCallHandler(this);
  }

  onDetachedFromEngine(binding: FlutterPluginBinding): void {
    this.channel?.setMethodCallHandler(null);
    this.channel = null;
    const registry = this.registry;
    if (registry != null) {
      this.entries.forEach((_: SurfaceTextureEntry, id: number) => registry.unregisterTexture(id));
    }
    this.entries.clear();
    this.registry = null;
  }

  onMethodCall(call: MethodCall, result: MethodResult): void {
    const registry = this.registry;
    if (registry == null) {
      result.error('detached', 'fjs_webgl ohos plugin is not attached to an engine', null);
      return;
    }
    switch (call.method) {
      case 'createTexture': {
        const width = call.argument('width') as number;
        const height = call.argument('height') as number;
        if (!(width > 0) || !(height > 0)) {
          result.error('bad size', `texture size must be positive, got ${width}x${height}`, null);
          return;
        }
        const textureId = registry.getTextureId();
        const entry = registry.registerTexture(textureId);
        // sizes the OHNativeWindow's buffers; the EGL window surface takes
        // its dimensions from them
        registry.setTextureBufferSize(textureId, width, height);
        this.entries.set(textureId, entry);
        const reply: Map<string, Object> = new Map();
        reply.set('textureId', textureId);
        // A string, not a number: the pointer is a 64-bit address and the
        // codec's integer encoding is not something to bet a pointer on.
        reply.set('nativeWindow', `${entry.getNativeWindowId()}`);
        result.success(reply);
        return;
      }
      case 'disposeTexture': {
        const textureId = call.argument('textureId') as number;
        if (this.entries.delete(textureId)) {
          registry.unregisterTexture(textureId);
        }
        result.success(null);
        return;
      }
      default:
        result.notImplemented();
    }
  }
}
