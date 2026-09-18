// dart:ffi bindings for the fjs native core (native/include/fjs.h).
//
// The VM runs on the UI isolate thread; all callbacks are synchronous
// NativeCallable.isolateLocal (see docs/architecture.md — threading v1).
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io' show Platform;
import 'dart:typed_data';

import 'package:ffi/ffi.dart';

/// FJSValue — mirrors native/include/fjs.h (flat struct, 32 bytes):
/// tag@0 i@4 d@8 s@16 len@24 pad@28.
final class FJSValue extends ffi.Struct {
  @ffi.Int32()
  external int tag;

  @ffi.Int32()
  external int i;

  @ffi.Double()
  external double d;

  external ffi.Pointer<ffi.Uint8> s;

  @ffi.Int32()
  external int len;

  @ffi.Int32()
  external int pad;
}

const int fjsTNull = 0;
const int fjsTBool = 1;
const int fjsTInt32 = 2;
const int fjsTFloat64 = 3;
const int fjsTString = 4;

typedef FJSVMHandle = ffi.Pointer<ffi.Void>;

typedef _VmCreateC = FJSVMHandle Function();
typedef _VmCreateD = FJSVMHandle Function();

typedef _VmDestroyC = ffi.Void Function(FJSVMHandle);
typedef _VmDestroyD = void Function(FJSVMHandle);

typedef _SetCallbacksC = ffi.Void Function(
    FJSVMHandle,
    ffi.Pointer<ffi.NativeFunction<OnLogC>>,
    ffi.Pointer<ffi.NativeFunction<OnUiOpsC>>,
    ffi.Pointer<ffi.NativeFunction<InvokeHostC>>);
typedef _SetCallbacksD = void Function(
    FJSVMHandle,
    ffi.Pointer<ffi.NativeFunction<OnLogC>>,
    ffi.Pointer<ffi.NativeFunction<OnUiOpsC>>,
    ffi.Pointer<ffi.NativeFunction<InvokeHostC>>);

typedef OnLogC = ffi.Void Function(
    ffi.Int32, ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef InvokeHostC = ffi.Int32 Function(ffi.Pointer<ffi.Uint8>, ffi.Int32,
    ffi.Pointer<FJSValue>, ffi.Pointer<FJSValue>);
typedef OnUiOpsC = ffi.Void Function(ffi.Pointer<ffi.Uint8>, ffi.Int32);

typedef OnToastC = ffi.Void Function(ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef _SetToastC = ffi.Void Function(
    FJSVMHandle, ffi.Pointer<ffi.NativeFunction<OnToastC>>);
typedef _SetToastD = void Function(
    FJSVMHandle, ffi.Pointer<ffi.NativeFunction<OnToastC>>);

typedef _EvalSourceC = ffi.Int32 Function(
    FJSVMHandle, ffi.Pointer<ffi.Uint8>, ffi.Int32, ffi.Pointer<ffi.Uint8>);
typedef _EvalSourceD = int Function(
    FJSVMHandle, ffi.Pointer<ffi.Uint8>, int, ffi.Pointer<ffi.Uint8>);

typedef _EvalBundleC = ffi.Int32 Function(
    FJSVMHandle, ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef _EvalBundleD = int Function(FJSVMHandle, ffi.Pointer<ffi.Uint8>, int);

typedef _PumpC = ffi.Int32 Function(FJSVMHandle, ffi.Int64);
typedef _PumpD = int Function(FJSVMHandle, int);

typedef _NowC = ffi.Int64 Function(FJSVMHandle);
typedef _NowD = int Function(FJSVMHandle);

typedef _DispatchEventC = ffi.Int32 Function(
    FJSVMHandle, ffi.Int32, ffi.Int32, ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef _DispatchEventD = int Function(
    FJSVMHandle, int, int, ffi.Pointer<ffi.Uint8>, int);

typedef _LastErrorC = ffi.Pointer<ffi.Uint8> Function(FJSVMHandle);
typedef _LastErrorD = ffi.Pointer<ffi.Uint8> Function(FJSVMHandle);

typedef _EngineIdC = ffi.Pointer<ffi.Uint8> Function();

typedef _HeapC = ffi.Void Function(
    FJSVMHandle, ffi.Pointer<ffi.Int64>, ffi.Pointer<ffi.Int64>);
typedef _HeapD = void Function(
    FJSVMHandle, ffi.Pointer<ffi.Int64>, ffi.Pointer<ffi.Int64>);

// Binary handles (spec 038, FJS_ABI_VERSION 2). put returns the assigned id
// (pass 0 to have the VM assign); bytes borrows the storage for reading.
typedef _HandlePutBytesC = ffi.Int64 Function(
    FJSVMHandle, ffi.Int64, ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef _HandlePutBytesD = int Function(
    FJSVMHandle, int, ffi.Pointer<ffi.Uint8>, int);
typedef _HandleBytesC = ffi.Void Function(
    FJSVMHandle, ffi.Int64, ffi.Pointer<ffi.Pointer<ffi.Uint8>>, ffi.Pointer<ffi.Int32>);
typedef _HandleBytesD = void Function(
    FJSVMHandle, int, ffi.Pointer<ffi.Pointer<ffi.Uint8>>, ffi.Pointer<ffi.Int32>);
typedef _HandleReleaseC = ffi.Void Function(FJSVMHandle, ffi.Int64);
typedef _HandleReleaseD = void Function(FJSVMHandle, int);

/// Native entry points of libfjs, resolved once.
class FjsBindings {
  FjsBindings._(this.lib)
      : vmCreate = lib.lookupFunction<_VmCreateC, _VmCreateD>('fjs_vm_create'),
        vmDestroy =
            lib.lookupFunction<_VmDestroyC, _VmDestroyD>('fjs_vm_destroy'),
        setCallbacks = lib.lookupFunction<_SetCallbacksC, _SetCallbacksD>(
            'fjs_set_callbacks'),
        setToast = lib
            .lookupFunction<_SetToastC, _SetToastD>('fjs_set_toast_callback'),
        evalSource = lib
            .lookupFunction<_EvalSourceC, _EvalSourceD>('fjs_vm_eval_source'),
        evalBundle = lib
            .lookupFunction<_EvalBundleC, _EvalBundleD>('fjs_vm_eval_bundle'),
        pump = lib.lookupFunction<_PumpC, _PumpD>('fjs_vm_pump'),
        now = lib.lookupFunction<_NowC, _NowD>('fjs_vm_now'),
        dispatchEvent = lib.lookupFunction<_DispatchEventC, _DispatchEventD>(
            'fjs_vm_dispatch_event'),
        lastError =
            lib.lookupFunction<_LastErrorC, _LastErrorD>('fjs_last_error'),
        engineId = lib.lookupFunction<_EngineIdC, _EngineIdC>('fjs_engine_id'),
        heap = _maybeHeap(lib),
        handlePutBytes = lib.lookupFunction<_HandlePutBytesC, _HandlePutBytesD>(
            'fjs_handle_put_bytes'),
        handleBytes = lib.lookupFunction<_HandleBytesC, _HandleBytesD>(
            'fjs_handle_bytes'),
        handleRelease = lib.lookupFunction<_HandleReleaseC, _HandleReleaseD>(
            'fjs_handle_release');

  /// `fjs_vm_heap` landed after FJS_ABI_VERSION 1, so an engine binary can
  /// predate it — the Android `libfjs.so` is a committed prebuilt, and a
  /// checkout can easily be newer than it. Missing means the perf overlay
  /// shows no heap, not that the app fails to start.
  static _HeapD? _maybeHeap(ffi.DynamicLibrary lib) {
    try {
      return lib.lookupFunction<_HeapC, _HeapD>('fjs_vm_heap');
    } on ArgumentError {
      return null;
    }
  }

  static FjsBindings? _instance;

  /// Android and ohos load the prebuilt libfjs.so shipped inside the app
  /// (jniLibs / the ohos plugin HAR's libs); iOS/macOS link the static slices
  /// of fjs.xcframework straight into the app binary, so the symbols are
  /// already in the process. The ohos fork's Dart runtime reports
  /// `Platform.operatingSystem == 'ohos'` and `isAndroid` false there, so
  /// checking isAndroid alone would send ohos into process() and crash.
  static FjsBindings instance() {
    final cached = _instance;
    if (cached != null) return cached;
    final os = Platform.operatingSystem;
    final lib = (Platform.isAndroid || os == 'ohos')
        ? ffi.DynamicLibrary.open('libfjs.so')
        : ffi.DynamicLibrary.process();
    _instance = FjsBindings._(lib);
    return _instance!;
  }

  final ffi.DynamicLibrary lib;
  final _VmCreateD vmCreate;
  final _VmDestroyD vmDestroy;
  final _SetCallbacksD setCallbacks;
  final _SetToastD setToast;
  final _EvalSourceD evalSource;
  final _EvalBundleD evalBundle;
  final _PumpD pump;
  final _NowD now;
  final _DispatchEventD dispatchEvent;
  final _LastErrorD lastError;
  final ffi.Pointer<ffi.Uint8> Function() engineId;

  /// Null when the loaded engine binary predates the symbol; see [_maybeHeap].
  final _HeapD? heap;

  // Binary handles (spec 038). Required, not optional: they landed with
  // FJS_ABI_VERSION 2 and the engine ships in this same package.
  final _HandlePutBytesD handlePutBytes;
  final _HandleBytesD handleBytes;
  final _HandleReleaseD handleRelease;

  /// Copies [bytes] into the VM's handle table and returns the handle id
  /// (a fresh monotonic one — pass [id] 0).
  int putHandleBytes(FJSVMHandle vm, ffi.Pointer<ffi.Uint8> data, int len,
      {int id = 0}) {
    return handlePutBytes(vm, id, data, len);
  }

  /// Copies the handle's bytes out into a fresh [Uint8List], or null when
  /// the id is unknown/stale. The C++ storage stays owned by the VM.
  Uint8List? readHandleBytes(FJSVMHandle vm, int id) {
    final out = malloc<ffi.Pointer<ffi.Uint8>>();
    final len = malloc<ffi.Int32>();
    try {
      handleBytes(vm, id, out, len);
      final n = len.value;
      if (out.value == ffi.nullptr || n <= 0) return null;
      return Uint8List.fromList(out.value.asTypedList(n));
    } finally {
      malloc.free(out);
      malloc.free(len);
    }
  }

  void releaseHandle(FJSVMHandle vm, int id) => handleRelease(vm, id);

  String get engineIdString => cString(engineId());
}

/// Reads a NUL-terminated utf8 C string.
String cString(ffi.Pointer<ffi.Uint8> p, [int? length]) {
  if (p == ffi.nullptr) return '';
  if (length != null) return utf8.decode(p.asTypedList(length));
  // NUL-terminated: find terminator length first
  var n = 0;
  while (p[n] != 0) {
    n++;
  }
  return utf8.decode(p.asTypedList(n));
}

/// Allocates a NUL-terminated utf8 copy of [s].
ffi.Pointer<ffi.Uint8> toCString(String s) {
  final units = utf8.encode(s);
  final p = malloc<ffi.Uint8>(units.length + 1);
  p.asTypedList(units.length + 1)
    ..setRange(0, units.length, units)
    ..[units.length] = 0;
  return p;
}

/// Event types (mirrors fjs.h).
abstract final class FjsEvent {
  static const tap = 1;
  static const longPress = 2;
  static const textChanged = 3;
  static const textSubmitted = 4;
  static const valueChanged = 5; // payload "1"/"0" or numeric string
  static const pageChanged = 6; // payload index string
  static const modalClosed = 7;
  static const refresh = 8;
  static const workerMessage = 9; // nodeId = worker id
  // navigator callbacks (nodeId = the route key the JS router allocated)
  static const navMount = 10; // page chunk is in the VM — mount the page
  static const navPop = 11; // the route is gone — unmount and drop the root
  // payload: the {scrollTop, scrollLeft, scrollHeight, scrollWidth, deltaX,
  // deltaY} JSON that fjs-runtime/src/scroll/metrics.ts defines. It used to
  // be a bare offset string; specs/009 changed it so `scroll-view` could
  // report the six fields the mini program's contract has.
  static const scroll = 12;
  // dev only: one page chunk was rebuilt and re-evaluated — remount the
  // pages it owns (payload: the chunk name)
  static const devPageReload = 13;
  // one fetch() finished (nodeId = the request id JS allocated); payload is
  // the response JSON — see FjsHttp
  static const httpResponse = 14;
  // DOM-shaped touch events (see render/touch.dart); payload is the compact
  // JSON src/ui/touch.ts decodes
  static const touchStart = 15;
  static const touchMove = 16;
  static const touchEnd = 17;
  static const touchCancel = 18;
  static const animationFrame = 19;
  // form controls. focus/blur carry the field's current text; formSubmit
  // carries the form's {name: value} JSON string (widgets/form.dart), and
  // formReset carries nothing — a page rolls its own values back, because
  // fjs controls are driven from JS.
  static const focus = 20;
  static const blur = 21;
  static const formSubmit = 22;
  static const formReset = 23;
  // scroll-view crossed the upper / lower threshold (no payload); the
  // "entered the zone" state machine lives in scroll/metrics.ts.
  static const scrollToUpper = 24;
  static const scrollToLower = 25;
  // A node's resource loaded / failed. The payload is a fixed JSON string
  // whose SHAPE belongs to the tag: image sends {"width":n,"height":n} and
  // {"errMsg":"image load failed"}; web-view (the @ufjs/webview module)
  // sends {"src":"…"} and {"src":"…","errMsg":"…"}. Named for the event
  // rather than for image, because a template's `@load` becomes the prop
  // `onLoad` whatever the tag is — renaming the number per tag would make
  // pages write `@webviewload`.
  static const load = 26;
  static const error = 27;
  // A multiline input's line count changed. Payload is the fixed JSON
  // {"height":n,"lineCount":n} written by textarea/lines.ts; `height` is the
  // content's own height in logical pixels (one decimal), NOT the box's.
  // Only a CHANGE is reported, and the first frame's initial count is not
  // (same "entered the zone" shape as the scroll edge events).
  static const lineChange = 28;
  // A webview's page called fjs.postMessage. Payload {"data":"…"}; the
  // string is whatever the page passed, verbatim.
  static const message = 29;
  // A canvas subsystem callback for the node. One number for three
  // messages, discriminated by the payload's "t": {"t":"size","w":n,"h":n}
  // when the box was laid out or resized, {"t":"image",…} when loadImage
  // finished, {"t":"dataurl",…} when toDataURL finished. They belong to one
  // subsystem and event numbers are scarce (this table is nearly the whole
  // budget of a byte), so they share a number rather than taking three.
  static const canvas = 30;
  // The route's push transition has finished (nodeId = the route key the JS
  // router allocated; no payload). A page that does expensive first-paint
  // work — building a chart, parsing a big payload — must not do it while
  // the Navigator is animating, and JS has no way to see that animation:
  // hence a signal rather than something the page could poll.
  //
  // Deliberately NOT in element.ts's EventType: like navMount (10) and
  // navPop (11) this is a system event the router subscribes to with
  // registerSystemHandler, not something a template can write as `@xxx`.
  static const navSettled = 31;
  // One invokeHostAsync() call finished (nodeId = the call id JS allocated;
  // payload is the fixed {"ok":…} JSON — see engine.dart's fjs.async.invoke
  // handler and fjs-runtime/src/host-async.ts). Like navSettled this is a
  // system event subscribed via registerSystemHandler, not a template `@xxx`.
  static const asyncResult = 32;
  // The Flutter window's logical size changed (nodeId = 0; the viewport
  // belongs to the app, not a node). Payload is the fixed JSON
  // {"width":n,"height":n}, one decimal place, logical pixels — the same
  // basis as a browser viewport's CSS pixels. Dart pushes one right after
  // every VM start and on every metrics change (specs/043-media-queries);
  // the CSS engine's @media matching is the only consumer, so web never
  // sends or needs this. Like navSettled: a system event subscribed via
  // registerSystemHandler, not a template `@xxx`.
  static const viewportChanged = 33;
  // sticky-header's pin state flipped (specs/052); payload is the JSON
  // string {"isStickOnTop":boolean} widgets/sticky.dart writes.
  static const stickOnTopChange = 34;
  // page-container's transition lifecycle (specs/065), no payloads. The
  // leave chain deliberately fires on EVERY close path — including a
  // JS-driven show=false — because the native side owns the animation
  // clock; this is the one place the "JS already knows" rule from
  // modalClosed does not apply. See widgets/page_container.dart.
  static const beforeEnter = 35;
  static const enter = 36;
  static const afterEnter = 37;
  static const beforeLeave = 38;
  static const leave = 39;
  static const afterLeave = 40;
  static const clickOverlay = 41;
}
