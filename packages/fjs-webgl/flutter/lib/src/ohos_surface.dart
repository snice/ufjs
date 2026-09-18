// The ohos (OpenHarmony flutter fork) GL backend.
//
// flutter_angle ships native halves for android/iOS/macOS/windows/linux only;
// on ohos its `initOpenGL` channel call has no receiver and every webgl
// canvas died with MissingPluginException. Rather than fork flutter_angle,
// this file does what its Android non-ANGLE path does, from Dart:
//
//   * the platform side (ohos/…/FjsWebglPlugin.ets) only registers a Flutter
//     texture and returns its OHNativeWindow*;
//   * EGL — display, one shared context, one window surface per texture — is
//     driven here over FFI against the system libEGL.so;
//   * GL calls go through flutter_angle's own LibOpenGLES/RenderingContext,
//     opened on the system libGLESv3.so, so FjsAngleBindings and everything
//     above it are unchanged.
//
// Same threading assumption as flutter_angle: every call happens on the UI
// isolate's thread, which is where the context is current.
import 'dart:ffi';

import 'package:ffi/ffi.dart';
import 'package:flutter/services.dart' show MethodChannel;
import 'package:flutter_angle/flutter_angle.dart'
    show LibOpenGLES, RenderingContext;

typedef _EglGetDisplayC = Pointer<Void> Function(Pointer<Void>);
typedef _EglGetDisplay = Pointer<Void> Function(Pointer<Void>);
typedef _EglInitializeC = Uint32 Function(
    Pointer<Void>, Pointer<Int32>, Pointer<Int32>);
typedef _EglInitialize = int Function(
    Pointer<Void>, Pointer<Int32>, Pointer<Int32>);
typedef _EglBindApiC = Uint32 Function(Uint32);
typedef _EglBindApi = int Function(int);
typedef _EglChooseConfigC = Uint32 Function(Pointer<Void>, Pointer<Int32>,
    Pointer<Pointer<Void>>, Int32, Pointer<Int32>);
typedef _EglChooseConfig = int Function(Pointer<Void>, Pointer<Int32>,
    Pointer<Pointer<Void>>, int, Pointer<Int32>);
typedef _EglCreateContextC = Pointer<Void> Function(
    Pointer<Void>, Pointer<Void>, Pointer<Void>, Pointer<Int32>);
typedef _EglCreateContext = Pointer<Void> Function(
    Pointer<Void>, Pointer<Void>, Pointer<Void>, Pointer<Int32>);
typedef _EglCreateWindowSurfaceC = Pointer<Void> Function(
    Pointer<Void>, Pointer<Void>, Pointer<Void>, Pointer<Int32>);
typedef _EglCreateWindowSurface = Pointer<Void> Function(
    Pointer<Void>, Pointer<Void>, Pointer<Void>, Pointer<Int32>);
typedef _EglMakeCurrentC = Uint32 Function(
    Pointer<Void>, Pointer<Void>, Pointer<Void>, Pointer<Void>);
typedef _EglMakeCurrent = int Function(
    Pointer<Void>, Pointer<Void>, Pointer<Void>, Pointer<Void>);
typedef _EglSurfaceOpC = Uint32 Function(Pointer<Void>, Pointer<Void>);
typedef _EglSurfaceOp = int Function(Pointer<Void>, Pointer<Void>);
typedef _EglSwapIntervalC = Uint32 Function(Pointer<Void>, Int32);
typedef _EglSwapInterval = int Function(Pointer<Void>, int);
typedef _EglGetCurrentSurfaceC = Pointer<Void> Function(Int32);
typedef _EglGetCurrentSurface = Pointer<Void> Function(int);
typedef _EglGetErrorC = Int32 Function();
typedef _EglGetError = int Function();

const _eglNone = 0x3038;
const _eglRedSize = 0x3024;
const _eglGreenSize = 0x3023;
const _eglBlueSize = 0x3022;
const _eglAlphaSize = 0x3021;
const _eglDepthSize = 0x3025;
const _eglStencilSize = 0x3026;
const _eglSamples = 0x3031;
const _eglSampleBuffers = 0x3032;
const _eglSurfaceType = 0x3033;
const _eglWindowBit = 0x0004;
const _eglRenderableType = 0x3040;
const _eglOpenglEs3Bit = 0x0040;
const _eglContextClientVersion = 0x3098;
const _eglOpenglEsApi = 0x30A0;
const _eglDraw = 0x3059;

class _Egl {
  _Egl(DynamicLibrary lib)
      : getDisplay = lib.lookupFunction<_EglGetDisplayC, _EglGetDisplay>(
            'eglGetDisplay'),
        initialize = lib.lookupFunction<_EglInitializeC, _EglInitialize>(
            'eglInitialize'),
        bindApi = lib.lookupFunction<_EglBindApiC, _EglBindApi>('eglBindAPI'),
        chooseConfig = lib.lookupFunction<_EglChooseConfigC, _EglChooseConfig>(
            'eglChooseConfig'),
        createContext =
            lib.lookupFunction<_EglCreateContextC, _EglCreateContext>(
                'eglCreateContext'),
        createWindowSurface = lib.lookupFunction<_EglCreateWindowSurfaceC,
            _EglCreateWindowSurface>('eglCreateWindowSurface'),
        makeCurrent = lib.lookupFunction<_EglMakeCurrentC, _EglMakeCurrent>(
            'eglMakeCurrent'),
        swapBuffers = lib.lookupFunction<_EglSurfaceOpC, _EglSurfaceOp>(
            'eglSwapBuffers'),
        destroySurface = lib.lookupFunction<_EglSurfaceOpC, _EglSurfaceOp>(
            'eglDestroySurface'),
        swapInterval = lib.lookupFunction<_EglSwapIntervalC, _EglSwapInterval>(
            'eglSwapInterval'),
        getCurrentSurface = lib.lookupFunction<_EglGetCurrentSurfaceC,
            _EglGetCurrentSurface>('eglGetCurrentSurface'),
        getError =
            lib.lookupFunction<_EglGetErrorC, _EglGetError>('eglGetError');

  final _EglGetDisplay getDisplay;
  final _EglInitialize initialize;
  final _EglBindApi bindApi;
  final _EglChooseConfig chooseConfig;
  final _EglCreateContext createContext;
  final _EglCreateWindowSurface createWindowSurface;
  final _EglMakeCurrent makeCurrent;
  final _EglSurfaceOp swapBuffers;
  final _EglSurfaceOp destroySurface;
  final _EglSwapInterval swapInterval;
  final _EglGetCurrentSurface getCurrentSurface;
  final _EglGetError getError;

  String error() => '0x${getError().toRadixString(16)}';
}

class OhosGlException implements Exception {
  OhosGlException(this.message);
  final String message;
  @override
  String toString() => 'OhosGlException: $message';
}

/// One Flutter texture + the EGL window surface over its native window.
class OhosGlTexture {
  OhosGlTexture._(this._gl, this.textureId, this._surface, this.widthPx,
      this.heightPx);

  final OhosGl _gl;
  final int textureId;
  Pointer<Void> _surface;
  final int widthPx;
  final int heightPx;

  bool get live => _surface != nullptr;

  RenderingContext getContext() =>
      RenderingContext.create(_gl._gles!, widthPx, heightPx);

  /// Binds this texture's surface as draw/read target of the shared context.
  /// Re-binding a window surface is what discards its back buffer, so the
  /// caller (FjsWebglRuntime._activate) binds once per frame.
  void activate() {
    if (!live) return;
    final egl = _gl._egl!;
    egl.makeCurrent(_gl._display, _surface, _surface, _gl._context);
    _gl._gles!.glViewport(0, 0, widthPx, heightPx);
  }

  /// Queues the back buffer to the native window — the Texture widget's
  /// next frame shows it.
  void present() {
    if (!live) return;
    _gl._egl!.swapBuffers(_gl._display, _surface);
  }

  Future<void> dispose() async {
    if (!live) return;
    final egl = _gl._egl!;
    final surface = _surface;
    _surface = nullptr;
    if (egl.getCurrentSurface(_eglDraw) == surface) {
      // keep the context current (surfaceless) so another canvas's pending
      // GL calls still have one; if the driver lacks surfaceless contexts,
      // drop it — the next activate() re-binds anyway
      if (egl.makeCurrent(_gl._display, nullptr, nullptr, _gl._context) == 0) {
        egl.makeCurrent(_gl._display, nullptr, nullptr, nullptr);
      }
    }
    egl.destroySurface(_gl._display, surface);
    await OhosGl._channel
        .invokeMethod<void>('disposeTexture', {'textureId': textureId});
  }
}

/// The shared EGL context every ohos webgl canvas renders through.
class OhosGl {
  static const _channel = MethodChannel('fjs_webgl/ohos');

  _Egl? _egl;
  LibOpenGLES? _gles;
  Pointer<Void> _display = nullptr;
  Pointer<Void> _config = nullptr;
  Pointer<Void> _context = nullptr;

  Future<void> init() async {
    if (_context != nullptr) return;
    final egl = _Egl(DynamicLibrary.open('libEGL.so'));
    // flutter_angle's non-ANGLE mode: plain GLES entry points, no
    // Android-only native FFI shortcuts
    final gles = LibOpenGLES(DynamicLibrary.open('libGLESv3.so'), false);
    final display = egl.getDisplay(nullptr); // EGL_DEFAULT_DISPLAY
    if (display == nullptr ||
        egl.initialize(display, nullptr, nullptr) == 0) {
      throw OhosGlException('eglInitialize failed: ${egl.error()}');
    }
    egl.bindApi(_eglOpenglEsApi);
    // 4x MSAA for `antialias: true` (the WebGL default), falling back to
    // none where the driver has no multisampled window config
    final config = _chooseConfig(egl, display, samples: 4) ??
        _chooseConfig(egl, display, samples: 0);
    if (config == null) {
      throw OhosGlException('no GLES3 window EGLConfig: ${egl.error()}');
    }
    final attribs = calloc<Int32>(3)
      ..[0] = _eglContextClientVersion
      ..[1] = 3
      ..[2] = _eglNone;
    final context = egl.createContext(display, config, nullptr, attribs);
    calloc.free(attribs);
    if (context == nullptr) {
      throw OhosGlException('eglCreateContext failed: ${egl.error()}');
    }
    _egl = egl;
    _gles = gles;
    _display = display;
    _config = config;
    _context = context;
  }

  static Pointer<Void>? _chooseConfig(_Egl egl, Pointer<Void> display,
      {required int samples}) {
    final attribs = <int>[
      _eglSurfaceType, _eglWindowBit,
      _eglRenderableType, _eglOpenglEs3Bit,
      _eglRedSize, 8,
      _eglGreenSize, 8,
      _eglBlueSize, 8,
      _eglAlphaSize, 8,
      _eglDepthSize, 24,
      _eglStencilSize, 8,
      if (samples > 0) ...[_eglSampleBuffers, 1, _eglSamples, samples],
      _eglNone,
    ];
    final list = calloc<Int32>(attribs.length);
    for (var i = 0; i < attribs.length; i++) {
      list[i] = attribs[i];
    }
    final out = calloc<Pointer<Void>>();
    final count = calloc<Int32>();
    try {
      final ok = egl.chooseConfig(display, list, out, 1, count);
      if (ok == 0 || count.value < 1) return null;
      return out.value;
    } finally {
      calloc.free(list);
      calloc.free(out);
      calloc.free(count);
    }
  }

  /// A texture of [widthPx]x[heightPx] DEVICE pixels, its surface current.
  Future<OhosGlTexture> createTexture(int widthPx, int heightPx) async {
    final egl = _egl!;
    final reply = await _channel.invokeMapMethod<String, Object?>(
        'createTexture', {'width': widthPx, 'height': heightPx});
    final textureId = (reply?['textureId'] as num?)?.toInt();
    final window = int.tryParse('${reply?['nativeWindow']}') ?? 0;
    if (textureId == null || window == 0) {
      throw OhosGlException('plugin returned no texture/native window: '
          '$reply');
    }
    final surface = egl.createWindowSurface(
        _display, _config, Pointer<Void>.fromAddress(window), nullptr);
    if (surface == nullptr) {
      final error = egl.error();
      await _channel
          .invokeMethod<void>('disposeTexture', {'textureId': textureId});
      throw OhosGlException('eglCreateWindowSurface failed: $error');
    }
    final texture =
        OhosGlTexture._(this, textureId, surface, widthPx, heightPx);
    texture.activate();
    // Presenting is paced by FjsWebglRuntime (once per Flutter frame); a
    // vsync-blocking swap on top of that would stall the UI thread.
    egl.swapInterval(_display, 0);
    return texture;
  }
}
