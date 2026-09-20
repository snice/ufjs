// The JS engine host: owns the native VM, wires callbacks, drives the
// event loop, applies UI frames to the mirror tree and exposes hot reload.
import 'dart:async';
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io' show Platform;

import 'package:ffi/ffi.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart' show AssetBundle, rootBundle;

import 'canvas/host_module.dart';
import 'canvas/images.dart';
import 'dev_client.dart';
import 'ffi.dart';
import 'font_loader.dart';
import 'geometry.dart';
import 'http.dart';
import 'mirror_tree.dart';
import 'registry/component.dart';
import 'registry/host.dart';
import 'widgets/control_scope.dart';
import 'worker.dart';
import 'bytes.dart';

/// One native route the JS router asked for.
class NavEntry {
  const NavEntry({
    required this.key,
    required this.path,
    required this.title,
    required this.chunk,
    this.transition = '',
  });

  /// Route key allocated by the JS router; also the id the mount/pop events
  /// are addressed to.
  final int key;
  final String path;
  final String title;

  /// Page chunk to evaluate before the page can mount ('' when the page is
  /// already in the bundle).
  final String chunk;

  /// How the route comes in: '' for the platform's own transition, 'none'
  /// for no animation at all (`meta.transition: false` on the JS side), or
  /// one of the names the JS router and the web stylesheet share —
  /// 'fjs-fade', 'fjs-slide', 'fjs-slide-up', 'fjs-zoom'. An unknown name
  /// falls back to the
  /// platform's own: it is a web CSS family this side does not have.
  /// See [FjsApp].
  final String transition;
}

class FjsException implements Exception {
  FjsException(this.message);
  final String message;
  @override
  String toString() => 'FjsException: $message';
}

/// One [FjsEngine] instance == one QuickJS VM on the UI isolate.
class FjsEngine extends ChangeNotifier {
  FjsEngine() {
    _bind();
    _createVm();
    _setupWorkerModules();
    _setupPlatformModule();
    _setupViewportModule();
    // @font-face fonts (specs/071); log reads onLog at call time, a host
    // may attach it after construction
    FjsFontLoader.register(host, log: (level, m) => onLog?.call(level, m));
    _setupNavModules();
    _setupAnimationFrameModule();
    _setupControlModule();
    _setupCanvasModule();
    registerGeometryHostModules(
      host: host,
      tree: tree,
      flushPending: _flushUiNotifyNow,
    );
    _http.register(host);
    _setupAsyncInvokeModule();
    _unwatchPointer = watchGlobalPointer(
      tree: tree,
      onDown: (id, x, y) {
        if (_disposed || _vm == null) return;
        dispatchEvent(
          id,
          FjsEvent.globalPointerDown,
          text: '{"x":${x.toStringAsFixed(1)},"y":${y.toStringAsFixed(1)}}',
        );
      },
    );
  }

  VoidCallback? _unwatchPointer;

  /// Backs the runtime's fetch() — see http.dart for the wire protocol.
  late final FjsHttp _http = FjsHttp(
    dispatchEvent: (id, type, {String? text}) {
      if (_disposed || _vm == null) return;
      dispatchEvent(id, type, text: text);
    },
    // root-relative fetch URLs resolve against the dev server, the same
    // closure the canvas image loader uses
    devUri: () => devUri,
    assetBundle: () => assetBundle,
    // binary handles (spec 038): response/request bodies travel as ids
    vmHandle: () => _vm,
  );

  /// Internal host module backing the runtime's invokeHostAsync() — the
  /// fetch paradigm generalized (spec 039). JS initiates synchronously
  /// through invokeHost('fjs.async.invoke', id, name, argsJson); this
  /// handler only STARTS the work. The Future's settlement re-enters the
  /// VM as dispatchEvent(id, FjsEvent.asyncResult, {"ok":…}).
  void _setupAsyncInvokeModule() {
    host.register('fjs.async.invoke', (args) {
      final id = args.isNotEmpty ? (args[0] as num).toInt() : 0;
      final name = args.length > 1 ? args[1]?.toString() ?? '' : '';
      final argsJson = args.length > 2 ? args[2]?.toString() : '[]';

      // Everything is deferred to a microtask: the trampoline is still on
      // the JS stack inside invokeHost, and dispatching from this
      // synchronous body would re-enter QuickJS mid-call. A microtask
      // lands after invokeHost has returned and the JS stack is empty —
      // the same entry path every fetch response takes.
      scheduleMicrotask(() async {
        final handler = host.asyncHandler(name);
        if (handler == null) {
          // loud, immediately — a hung promise is a silent failure
          _sendAsyncResult(id, errMsg: 'host module "$name" is not registered');
          return;
        }
        List<Object?> decoded;
        try {
          final raw = jsonDecode(argsJson ?? '[]');
          decoded = raw is List ? raw : <Object?>[raw];
        } catch (e) {
          _sendAsyncResult(
            id,
            errMsg: 'fjs.async.invoke: malformed args JSON: $e',
          );
          return;
        }
        try {
          final value = await handler(decoded);
          _sendAsyncResult(id, value: value);
        } catch (e) {
          _sendAsyncResult(id, errMsg: 'host module "$name" threw: $e');
        }
      });
      return null;
    });
  }

  /// Delivers one async-call settlement into the VM. Field order is fixed
  /// ("ok" first) and the JS side documents it — keep them in step.
  /// A handler value that jsonEncode cannot take is an error payload, never
  /// a dropped result (constitution V); a Dart `null` resolves in JS as
  /// null, since Dart has no undefined to omit the key with.
  void _sendAsyncResult(int id, {Object? value, String? errMsg}) {
    if (_disposed || _vm == null) return;
    String payload;
    try {
      payload = errMsg != null
          ? jsonEncode(<String, Object?>{'ok': false, 'errMsg': errMsg})
          : jsonEncode(<String, Object?>{'ok': true, 'value': value});
    } catch (e) {
      payload = jsonEncode(<String, Object?>{
        'ok': false,
        'errMsg': 'async result is not JSON-encodable: $e',
      });
    }
    dispatchEvent(id, FjsEvent.asyncResult, text: payload);
  }

  final Map<int, FjsWorker> _workers = {};

  /// Internal host modules backing the fjs-runtime `Worker` class.
  /// JS: invokeHost('js.worker.create', code) -> id; post/terminate by id.
  /// Worker->main messages re-enter JS as dispatchEvent(id, 9, text).
  void _setupWorkerModules() {
    host
      ..register('js.worker.create', (args) {
        final id = FjsWorker.nextId;
        final code = args.isNotEmpty ? args.first.toString() : '';
        final worker = FjsWorker.startWithId(
          id,
          code,
          onMessage: (msg) {
            dispatchEvent(id, FjsEvent.workerMessage, text: msg);
          },
          onError: (err) {
            onLog?.call(3, '[worker] $err');
          },
        );
        _workers[id] = worker;
        return id;
      })
      ..register('js.worker.post', (args) {
        final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
        final msg = args.length > 1 ? args[1]?.toString() ?? '' : '';
        _workers[id]?.postMessage(msg);
        return null;
      })
      ..register('js.worker.terminate', (args) {
        final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
        _workers.remove(id)?.terminate();
        return null;
      });
  }

  final FjsBindings bind = FjsBindings.instance();

  /// Op-stream diagnostics route to the same log channel as engine errors,
  /// so the device-side log sheet shows what actually arrived (specs/070).
  late final MirrorTree tree = MirrorTree(
    debugLog: (message) => onLog?.call(3, message),
  );
  final HostRegistry host = HostRegistry();

  /// Whether the dev performance overlay is showing. [FjsApp] watches it;
  /// `fjs dev`'s `p` key flips it, and a host can flip it itself.
  final ValueNotifier<bool> perfOverlay = ValueNotifier<bool>(false);
  final ComponentRegistry components = ComponentRegistry();

  FJSVMHandle? _vm;
  ffi.Pointer<ffi.NativeFunction<OnLogC>>? _onLogPtr;
  ffi.Pointer<ffi.NativeFunction<OnUiOpsC>>? _onUiOpsPtr;
  ffi.Pointer<ffi.NativeFunction<InvokeHostC>>? _invokeHostPtr;
  ffi.Pointer<ffi.NativeFunction<OnToastC>>? _onToastPtr;
  Timer? _pumpTimer;
  DevClient? _dev;
  bool _disposed = false;
  bool _uiNotifyQueued = false;
  int _vmGeneration = 0;

  /// Console output from JS (log/info/warn/error), for host surfacing.
  void Function(int level, String message)? onLog;

  /// JS `__fjs.toast(msg)` lands here. FjsView installs a default overlay
  /// handler; replace to customize routing.
  void Function(String message)? onToast;

  void _createVm() {
    HostBridge.install(host);
    // callback trampolines are created once; reset() only recycles the VM
    _onLogPtr ??= ffi.Pointer.fromFunction(_onLogTrampoline);
    _onUiOpsPtr ??= ffi.Pointer.fromFunction(_onUiOpsTrampoline);
    _invokeHostPtr ??= HostBridge(host).pointer;
    _onToastPtr ??= ffi.Pointer.fromFunction(_onToastTrampoline);
    final vm = bind.vmCreate();
    if (vm == ffi.nullptr) {
      throw FjsException('failed to create fjs VM');
    }
    _vm = vm;
    _vmGeneration++;
    bind.setCallbacks(vm, _onLogPtr!, _onUiOpsPtr!, _invokeHostPtr!);
    bind.setToast(vm, _onToastPtr!);
    _announceCapabilities();
  }

  /// What this host's op decoder understands. Bundles ship separately from
  /// the Flutter binary (page chunks, the dev server, a pub.dev
  /// `flutter_fjs`), so a bundle built against a newer runtime can meet an
  /// older host; the runtime reads this and falls back to an encoding the
  /// host can decode. Not the C ABI version — op frames are opaque bytes to
  /// the native layer, so `FJS_ABI_VERSION` has nothing to say about them.
  void _announceCapabilities() {
    runSource(
      'globalThis.__fjsHost = { uiOpsVersion: $uiOpsVersion };',
      filename: 'fjs:capabilities',
    );
  }

  /// Op protocol revision this decoder implements.
  /// 1 = ops 1-6. 2 = adds interned styles (DEFINE_STYLE / SET_STYLE /
  /// RESET_STYLES). 3 = adds CANVAS display lists (op 10); see ui_ops.dart.
  /// 4 = adds the canvas NEEDS_LAYER marker, so a partial clearRect erases
  /// to transparent instead of punching through the page.
  /// 5 = adds WEBGL command streams (op 11), executed by flutter_angle.
  /// 6 = adds SET_HOVER_STYLE (op 12), the `:hover` variant slot. A new op
  /// rather than a third id inside SET_STYLE: the declared version only
  /// flows host -> runtime, so an old runtime paired with this host would
  /// still write the 12-byte SET_STYLE while the decoder reads 16 — the
  /// frames would silently misparse.
  static const int uiOpsVersion = 6;

  /// Destroys the current VM and clears the mirror tree (hot reload path).
  /// Heap bytes and live objects, WITHOUT collecting.
  ///
  /// `__fjs.fns.gc()` reports the same two numbers from JS, but it runs a full
  /// mark-and-sweep to get them — fine for a measurement that wants a
  /// collection taken out of its window, wrong for a monitor sampling twice a
  /// second, which would then be causing the collections it is there to show.
  ///
  /// Null when there is no VM, or when the engine binary predates
  /// `fjs_vm_heap` (a committed Android prebuilt can).
  ({int bytes, int objects})? heapUsage() {
    final vm = _vm;
    final read = bind.heap;
    if (vm == null || read == null) return null;
    final out = calloc<ffi.Int64>(2);
    try {
      read(vm, out, out + 1);
      return (bytes: out[0], objects: out[1]);
    } finally {
      calloc.free(out);
    }
  }

  /// Registered [preludes] are re-evaluated into the fresh VM.
  void reset() {
    _http.cancelAll();
    final vm = _vm;
    if (vm != null) bind.vmDestroy(vm);
    _vm = null;
    _frameLog.clear();
    _navStack.clear();
    _routesPendingPop.clear();
    // a fresh VM has no chunks in it, whatever the previous one evaluated
    _loadedChunks.clear();
    _loadingChunks.clear();
    _loadedUnits.clear();
    _unitsMode = false;
    tree.clear();
    // canvas image handles belonged to the old VM, which numbers from 1
    // again — holding the textures would alias the next VM's handles
    FjsCanvasImages.instance.clear();
    _createVm();
    _runPreludes();
    _scheduleUiNotify();
  }

  // ---- navigation ---------------------------------------------------------
  //
  // The JS router (fjs/router) asks for a native route instead of drawing
  // its own page stack, so the platform's back gesture and page transition
  // apply to real Flutter routes. Wire protocol, JS -> here:
  //
  //   fjs.nav.push(key, path, title, chunk, anim)     new route on top
  //   fjs.nav.replace(key, path, title, chunk, anim)  swap the top route
  //     anim: '' = the platform's transition, 'none' = no animation,
  //           'fjs-fade' / 'fjs-slide' / 'fjs-slide-up' / 'fjs-zoom' = one
  //           of the shared named transitions (see FjsApp)
  //   fjs.nav.load(key, path, chunk)            no route: just load a chunk
  //   fjs.nav.pop()                             pop the top route
  //
  // and back the other way as dispatchEvent(key, FjsEvent.navMount / navPop)
  // once the page's chunk is in the VM / once its route is gone. [FjsApp]
  // turns [navStack] into Navigator pages and reports removals here.
  //
  // notifyListeners() is still the one signal for both the mirror tree and
  // this stack. FjsApp does not rebuild its Navigator on every ping — it
  // compares navStack and setStates only when the keys change. A UI frame
  // (canvas, rAF, dispatchEvent) that rebuilt `pages` would _updatePages()
  // and changedExternalState() the Cupertino back-gesture route (spec 024).

  final List<NavEntry> _navStack = [];
  final Set<int> _routesPendingPop = {};
  final Set<String> _loadedChunks = {};
  final Map<String, Future<void>> _loadingChunks = {};

  /// Dev units (spec 037) whose factory has been registered in this VM.
  /// Registration is cheap and idempotent; the factories themselves run
  /// lazily on first `__fjsRequireUnit`, so "loaded" here means "defined".
  final Set<String> _loadedUnits = {};

  /// True when the dev server negotiated units mode (spec 037): split build
  /// plus per-module unit files. False everywhere else — release, older
  /// dev servers, single-bundle dev.
  bool _unitsMode = false;

  /// Routes the JS router asked for, bottom first. The base page (key 0) is
  /// not in here — it is the host's own first page.
  List<NavEntry> get navStack => List.unmodifiable(_navStack);

  /// Loads the page chunk named [chunk] (`fjs build --pages` emits one per
  /// route). Hosts wire this to assets or to the dev server; returning null
  /// means "no such chunk", which is reported to JS as a mount with no page.
  Future<Uint8List?> Function(String chunk)? chunkLoader;

  /// Dev-only (spec 037): fetches one unit file by id. Null outside units
  /// mode — release builds bundle every module, so there is nothing to fetch.
  Future<Uint8List?> Function(String id)? unitLoader;

  /// The DOM-shaped `el.focus()` / `el.blur()` (element.ts): vant reaches a
  /// field through a template ref — to reject focus on a readonly input —
  /// and there is no label/form scope above it to route through.
  void _setupControlModule() {
    host
      ..register('fjs.control.focus', (args) {
        if (args.isNotEmpty) fjsControlFocus((args.first as num).toInt());
        return null;
      })
      ..register('fjs.control.blur', (args) {
        if (args.isNotEmpty) fjsControlBlur((args.first as num).toInt());
        return null;
      });
  }

  void _setupNavModules() {
    host
      ..register('fjs.nav.push', (args) {
        _pushRoute(_navArgs(args), replaceTop: false);
        return null;
      })
      ..register('fjs.nav.replace', (args) {
        _pushRoute(_navArgs(args), replaceTop: true);
        return null;
      })
      ..register('fjs.nav.load', (args) {
        // key, path, chunk — the base page, which has no Navigator route
        final key = args.isNotEmpty ? (args.first as num).toInt() : 0;
        final chunk = args.length > 2 ? args[2]?.toString() ?? '' : '';
        unawaited(_mountWhenReady(key, chunk));
        return null;
      })
      ..register('fjs.nav.pop', (args) {
        if (_navStack.isEmpty) return false;
        _beginRoutePop(_navStack.last.key);
        return true;
      });
  }

  /// Tells JS which platform the engine runs on ('android' / 'ios' / ...,
  /// straight from dart:io). The one thing a cross-platform GL page cannot
  /// sense for itself: Android presents the framebuffer bottom-up while the
  /// browser and iOS present top-down, so a projection needs to know
  /// (spec 023).
  void _setupPlatformModule() {
    host.register('fjs.platform', (args) {
      return Platform.operatingSystem;
    });
  }

  // ---- viewport (@media) --------------------------------------------------
  //
  // JS learns the window size two ways (specs/043-media-queries): the
  // runtime PULLS `fjs.viewport.get` when its renderer module loads — the
  // only ordering-safe way to deliver the initial value, because the
  // renderer loads with the app bundle, after any "push at VM start"
  // could fire — and this engine PUSHES event 33 whenever FjsView reports
  // a metrics change. The pull also re-arms every VM rebuild (dev reload):
  // the fresh VM's renderer pulls again, so no replay bookkeeping exists.

  /// The payload of the last pushed/queried size, also the dedupe key —
  /// one decimal place, fixed field order, byte-identical to what
  /// media-matching sees on both ends.
  String? _viewportPayload;

  /// What JS gets before any widget has reported a size — the same
  /// fallback the JS engine assumes (css/style.ts FALLBACK_VIEWPORT), so
  /// pull and push agree even on a host that never mounts FjsView.
  static const String _fallbackViewportPayload =
      '{"width":390.0,"height":844.0}';

  /// The renderer's pull: the current size as the fixed JSON payload.
  void _setupViewportModule() {
    host.register('fjs.viewport.get', (args) {
      return _viewportPayload ?? _fallbackViewportPayload;
    });
  }

  /// Called by the widget layer (FjsView) when the window's logical size
  /// may have changed. Redundant calls are cheap: a byte-equal payload
  /// drops out before touching the VM, so a second FjsView under the same
  /// engine — or MediaQuery dependencies that fired for text scale — is a
  /// no-op.
  void updateViewport(double width, double height) {
    if (_disposed) return;
    final payload =
        '{"width":${width.toStringAsFixed(1)},"height":${height.toStringAsFixed(1)}}';
    if (payload == _viewportPayload) return;
    _viewportPayload = payload;
    if (_vm == null) return; // a later pull (or push) delivers it
    dispatchEvent(0, FjsEvent.viewportChanged, text: payload);
  }

  void _setupCanvasModule() {
    registerCanvasHostModules(
      host: host,
      tree: tree,
      dispatch: (id, type, {String? text}) {
        if (_disposed || _vm == null) return;
        dispatchEvent(id, type, text: text);
      },
      devUri: () => devUri,
      assetBundle: () => assetBundle,
      // same cache-busting counter <image> uses on dev URLs (fjs_view.dart)
      devGeneration: () => tree.generation,
    );
  }

  void _setupAnimationFrameModule() {
    host.register('js.raf.request', (args) {
      final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
      if (id < 0) return null;
      final generation = _vmGeneration;
      SchedulerBinding.instance.scheduleFrameCallback((stamp) {
        if (_disposed || _vm == null || generation != _vmGeneration) return;
        final ms = stamp.inMicroseconds / 1000;
        dispatchEvent(id, FjsEvent.animationFrame, text: '$ms');
      });
      SchedulerBinding.instance.ensureVisualUpdate();
      return null;
    });
  }

  static NavEntry _navArgs(List<Object?> args) => NavEntry(
    key: args.isNotEmpty ? (args.first as num).toInt() : 0,
    path: args.length > 1 ? args[1]?.toString() ?? '' : '',
    title: args.length > 2 ? args[2]?.toString() ?? '' : '',
    chunk: args.length > 3 ? args[3]?.toString() ?? '' : '',
    transition: args.length > 4 ? args[4]?.toString() ?? '' : '',
  );

  void _pushRoute(NavEntry entry, {required bool replaceTop}) {
    if (replaceTop && _navStack.isNotEmpty) {
      final old = _navStack.removeLast();
      _routesPendingPop.add(old.key);
    }
    _navStack.add(entry);
    // Paint the route (and its transition) now; the page's content follows
    // as soon as its chunk is in the VM.
    notifyListeners();
    unawaited(_mountPushedRoute(entry.key, entry.chunk));
  }

  Future<void> _mountPushedRoute(int key, String chunk) async {
    // Let Navigator paint/start its platform transition before JS mounts the
    // page. If the chunk is already cached, mounting synchronously here would
    // block the route switch on the UI isolate.
    await SchedulerBinding.instance.endOfFrame;
    if (_disposed || _vm == null) return;
    await _mountWhenReady(key, chunk);
  }

  Future<void> _mountWhenReady(int key, String chunk) async {
    final started = DateTime.now();
    var loaded = true;
    try {
      await _ensureChunk(chunk);
    } catch (e) {
      loaded = false;
      onLog?.call(3, '[nav] loading chunk "$chunk" failed: $e');
    }
    if (_disposed || _vm == null) return;
    // A chunk that never evaluated has no page to mount. Dispatching
    // navMount anyway used to push a blank view — from the outside that is
    // "tapping does nothing", with the real error sitting in a console
    // nobody has open (constitution V). The key's route is dead weight:
    // hand it back the way a pop would, so the failed tap is at least
    // visible, and leave the navMount for a retry after the chunk is fixed.
    if (!loaded) {
      if (key != 0 && !_routesPendingPop.contains(key)) _beginRoutePop(key);
      return;
    }
    if (!_routeCanMount(key)) return;
    // Vue mount + CSS flush stay on this stack; first-paint flushLayout
    // does not (specs/086). A useRect in onMounted then sees zeros until
    // the next Flutter frame, which is what ui-api.md already documents
    // for an un-laid-out node.
    runWithoutGeometryReflow(() => dispatchEvent(key, FjsEvent.navMount));
    final ms = DateTime.now().difference(started).inMilliseconds;
    onLog?.call(
      1,
      '[nav] mounted key=$key chunk=${chunk.isEmpty ? '(inline)' : chunk} in ${ms}ms',
    );
  }

  Future<void> _ensureChunk(String chunk) {
    if (chunk.isEmpty || _loadedChunks.contains(chunk))
      return Future<void>.value();
    return _loadingChunks[chunk] ??= _loadChunk(chunk).whenComplete(() {
      _loadingChunks.remove(chunk);
    });
  }

  Future<void> _loadChunk(String chunk) async {
    final loader = chunkLoader;
    if (loader == null) {
      throw FjsException('no chunkLoader: cannot load page chunk "$chunk"');
    }
    final started = DateTime.now();
    // units mode: a chunk's bundled code calls __fjsRequireUnit for every
    // shared app module it imports, and that throws on an unregistered id —
    // so the chunk's unit closure has to be defined before the chunk evals
    if (_unitsMode && unitLoader != null) {
      await _ensureUnitsOf(chunk);
    }
    final bytes = await loader(chunk);
    if (bytes == null) throw FjsException('page chunk "$chunk" not found');
    if (_disposed || _vm == null) return;
    final fetchedAt = DateTime.now();
    _eval(bytes);
    _loadedChunks.add(chunk);
    final evaluatedAt = DateTime.now();
    onLog?.call(
      1,
      '[nav] chunk $chunk ${bytes.length} bytes: fetch ${fetchedAt.difference(started).inMilliseconds}ms, eval ${evaluatedAt.difference(fetchedAt).inMilliseconds}ms',
    );
  }

  /// Defines every unit the page chunk [chunk] imports that this VM has not
  /// seen yet. The closure comes from the dev server (it owns the import
  /// graph); a failure here fails the chunk load loudly — mounting with
  /// missing modules would surface as a TypeError far from the cause.
  Future<void> _ensureUnitsOf(String chunk) async {
    final depsBytes = await _dev!.fetch('/pages/$chunk.deps.json');
    final list = jsonDecode(utf8.decode(depsBytes));
    if (list is! List) throw FjsException('malformed deps.json for "$chunk"');
    for (final raw in list) {
      if (raw is! String || raw.isEmpty) continue;
      if (_loadedUnits.contains(raw)) continue;
      final bytes = await unitLoader!(raw);
      if (bytes == null) throw FjsException('dev unit "$raw" not found');
      if (_disposed || _vm == null) return;
      _eval(bytes);
      _loadedUnits.add(raw);
    }
  }

  /// Called by [FjsApp] when the Navigator drops a route — a back gesture,
  /// the system back button, or a pop this engine asked for.
  ///
  /// The route was popped IMPERATIVELY and is mid-exit-animation here.
  /// Removing the entry from [_navStack] now would rebuild the page list
  /// without it, and the Navigator's pages diff then force-disposes the
  /// still-animating route (a second didPop, instant dispose) — the exit
  /// snaps shut and the page visibly blinks. So the entry only parks in
  /// [_routesPendingPop] (which already blocks re-mounts via _routeCanMount);
  /// it leaves the stack in [onRouteTransitionComplete] once the route is
  /// really gone.
  void onRouteRemoved(int key) {
    _routesPendingPop.add(key);
  }

  /// Called once a pushed route's transition animation is over — including
  /// when it was cut short. Tells the page it may now do work that would
  /// have janked the animation (building a chart, parsing a big payload);
  /// see fjs-runtime/src/router's onPageSettled and specs/027.
  ///
  /// Fire-and-forget: a page that never subscribes pays one dispatch.
  void onRouteSettled(int key) {
    if (key == 0 || _disposed || _vm == null) return;
    dispatchEvent(key, FjsEvent.navSettled);
  }

  /// Called once the popped Flutter route has finished its reverse transition
  /// and removed its overlay entries. Keeping JS mounted until here avoids
  /// animating an already-empty [FjsView] during Android back transitions.
  void onRouteTransitionComplete(int key) {
    if (key == 0) return;
    // Called from inside route.dispose(), i.e. while the Navigator is still
    // tearing the entry down. The microtask runs past that cleanup, so the
    // rebuild below never diffs against a half-disposed route.
    scheduleMicrotask(() {
      if (_disposed) return;
      final index = _navStack.indexWhere((e) => e.key == key);
      if (index >= 0) {
        _navStack.removeAt(index);
        notifyListeners();
      }
      _flushCompletedRoutePop(key);
    });
  }

  bool _routeCanMount(int key) {
    if (key == 0) return true;
    return _navStack.any((e) => e.key == key) &&
        !_routesPendingPop.contains(key);
  }

  void _beginRoutePop(int key) {
    // A native pop already in flight parked this key (see [onRouteRemoved]);
    // running the removal again would yank the exiting route mid-animation.
    if (_routesPendingPop.contains(key)) return;
    final index = _navStack.indexWhere((e) => e.key == key);
    if (index >= 0) {
      _navStack.removeAt(index);
      notifyListeners();
    }
    _routesPendingPop.add(key);
  }

  void _flushCompletedRoutePop(int key) {
    if (!_routesPendingPop.remove(key)) return;
    // Route completion can still run from Navigator internals. A microtask
    // keeps JS re-entry and the resulting UI frame out of that callback.
    scheduleMicrotask(() {
      if (_disposed || _vm == null) return;
      dispatchEvent(key, FjsEvent.navPop);
      onLog?.call(1, '[nav] unmounted key=$key');
      notifyListeners();
    });
  }

  // ---- code splitting (preludes) -----------------------------------------

  final List<Uint8List> _preludes = [];

  /// Shared chunks every app program depends on, in evaluation order.
  List<Uint8List> get preludes => List.unmodifiable(_preludes);

  /// Registers a split-off chunk that app bundles need in scope before they
  /// run — e.g. the shared vue/fjs runtime built with
  /// A shared prelude from `fjs build --pages`, which installs
  /// `globalThis.__FJS_SHARED` before the app/page chunks run.
  ///
  /// The chunk is evaluated into the current VM immediately and re-evaluated
  /// into every VM [reset] creates, so hosts register it once (at startup, to
  /// take the asset read off the switch path) instead of re-sequencing
  /// `runBundle(shared)` before each `runBundle(app)`. Order of registration
  /// is the order of evaluation.
  ///
  /// A prelude lives in the VM alongside whatever app runs next, so keep it
  /// to code that only defines globals: no UI, no timers, no mount.
  void addPrelude(Uint8List bundle) {
    _preludes.add(bundle);
    if (_vm != null) _eval(bundle);
  }

  /// Drops all registered preludes. Takes effect in the next VM ([reset]);
  /// the running VM keeps what it already evaluated.
  void clearPreludes() {
    _preludes.clear();
  }

  void _runPreludes() {
    for (final chunk in _preludes) {
      _eval(chunk);
    }
  }

  /// Runs a chunk in either wire format (bytecode bundle or utf8 source).
  void _eval(Uint8List chunk) {
    final bytes = fjsMaybeGunzip(chunk);
    if (_looksLikeFjsBundle(bytes)) {
      runBundle(bytes);
    } else {
      runSource(utf8.decode(bytes), filename: 'prelude.js');
    }
  }

  // ---- program loading ---------------------------------------------------

  /// Runs utf8 JS source (dev bundles / embedded strings).
  void runSource(String source, {String filename = 'main.js'}) {
    final vm = _requireVm();
    final code = Uint8List.fromList(utf8.encode(source));
    final codePtr = malloc<ffi.Uint8>(code.length);
    codePtr.asTypedList(code.length).setAll(0, code);
    final namePtr = toCString(filename);
    try {
      final rc = bind.evalSource(vm, codePtr, code.length, namePtr);
      if (rc != 0) throw FjsException(_lastError());
    } finally {
      malloc.free(codePtr);
      malloc.free(namePtr);
    }
    _scheduleUiNotify();
  }

  /// Runs a .fjsbundle (production artifact: header + QuickJS bytecode).
  /// Bytecode is version-locked to the embedded engine; mismatches throw.
  void runBundle(Uint8List bytes) {
    final vm = _requireVm();
    final data = fjsMaybeGunzip(bytes);
    final dataPtr = malloc<ffi.Uint8>(data.length);
    dataPtr.asTypedList(data.length).setAll(0, data);
    try {
      final rc = bind.evalBundle(vm, dataPtr, data.length);
      if (rc != 0) throw FjsException(_lastError());
    } finally {
      malloc.free(dataPtr);
    }
    notifyListeners();
  }

  // ---- event loop --------------------------------------------------------

  /// Drives JS timers + promise jobs. Called automatically on a frame-ish
  /// cadence once [startEventLoop] is on.
  void pump() {
    final vm = _vm;
    if (vm == null) return;
    bind.pump(vm, bind.now(vm));
  }

  /// Starts the periodic pump (16ms ≈ one frame).
  void startEventLoop() {
    _pumpTimer ??= Timer.periodic(const Duration(milliseconds: 16), (_) {
      if (!_disposed) pump();
    });
  }

  void stopEventLoop() {
    _pumpTimer?.cancel();
    _pumpTimer = null;
  }

  /// Sends a UI event to the JS runtime (called by the widget layer).
  void dispatchEvent(int nodeId, int eventType, {String? text}) {
    final vm = _requireVm();
    ffi.Pointer<ffi.Uint8> textPtr = ffi.nullptr;
    var textLen = 0;
    if (text != null) {
      final units = utf8.encode(text);
      textPtr = malloc<ffi.Uint8>(units.length);
      textPtr.asTypedList(units.length).setAll(0, units);
      textLen = units.length;
    }
    try {
      final rc = bind.dispatchEvent(vm, nodeId, eventType, textPtr, textLen);
      if (rc != 0) throw FjsException(_lastError());
    } finally {
      if (textPtr != ffi.nullptr) malloc.free(textPtr);
    }
    _scheduleUiNotify();
  }

  // ---- dev server --------------------------------------------------------

  /// Connects to `fjs dev` (HTTP + WebSocket). Every reload disposes the
  /// VM, rebuilds and re-evaluates the newest bundle — except the changes
  /// that can be hot-swapped: page chunks (`reload pages:`) and, when the
  /// server negotiates units mode, shared app modules (`reload units:`,
  /// spec 037).
  ///
  /// A `fjs dev --pages` server serves a split build: the shared prelude
  /// (vue + fjs) plus one chunk per route. That is picked up from the
  /// manifest — the prelude is registered as a prelude, and page chunks are
  /// fetched on demand as the router asks for them, so a route change never
  /// re-downloads the runtime.
  Future<void> connectDev(String host, int port) async {
    stopEventLoop();
    _dev?.close();
    final dev = DevClient(
      host,
      port,
      fetchUrl: _http.fetch,
      onLog: (m) => onLog?.call(1, '[dev] $m'),
    );
    _dev = dev;
    unawaited(_raiseIosNetworkPrompt());
    await Future<void>.delayed(Duration.zero); // allow UI to paint "connecting"
    // `units=1` is the version handshake: a server that knows spec 037
    // answers with `units: true` and serves the unit-shaped build; an older
    // server ignores the query and the manifest says nothing — classic path
    final manifest = await dev.fetchManifest();
    final split = manifest?['split'] == true;
    final units = split && manifest?['units'] == true;
    if (split) {
      // Plain fetch, NOT the bootstrap one: a route chunk fails with the app
      // already on screen and the router able to report it. Only the three
      // fetches that decide whether there is an app at all retry — see
      // DevClient.fetchForBootstrap.
      chunkLoader = (chunk) => dev.fetch('/pages/$chunk.js');
    }
    if (units) {
      // per-segment encoding: the id keeps its slashes, so the server's
      // decodeURIComponent restores the path form it indexed the unit under
      unitLoader = (id) => dev.fetch(
        '/units/${id.split('/').map(Uri.encodeComponent).join('/')}.js',
      );
    }
    await _loadFromDev(dev, split, units);
    dev.onReload = (reload) async {
      try {
        // an edit confined to page chunks never needs the VM restarted
        if (reload.units.isNotEmpty && await _hotSwapUnits(dev, reload)) return;
        if (reload.units.isEmpty &&
            reload.pages.isNotEmpty &&
            await _hotSwapPages(dev, reload.pages)) {
          return;
        }
        // Full reload. The world may have moved while the socket was down —
        // the dev server itself may have restarted in classic mode — so the
        // units flag is re-negotiated, not reused from connect time.
        final effectiveUnits = await _renegotiateUnits(dev);
        await _loadFromDev(dev, split, effectiveUnits);
        if (split) unawaited(_preloadDevChunks(manifest));
      } catch (e) {
        onLog?.call(3, '[dev] reload failed: $e');
      }
    };
    dev.onPerf = () => perfOverlay.value = !perfOverlay.value;
    dev.onEval = (id, source) {
      try {
        runSource(source, filename: 'fjs-eval.js');
      } catch (e) {
        // a syntax error never reaches the wrapper's own catch, so the
        // answer has to be sent from here or `fjs eval` just times out
        dev.sendLog(3, '\u0000fjs-eval:$id:err:$e');
      }
    };
    await dev.listen();
    startEventLoop();
    if (split) unawaited(_preloadDevChunks(manifest));
    notifyListeners();
  }

  Future<void> _preloadDevChunks(Map<String, Object?>? manifest) async {
    final rawRoutes = manifest?['routes'];
    if (rawRoutes is! List) return;
    final chunks =
        <String>{
              for (final route in rawRoutes)
                if (route is Map && route['chunk'] is String)
                  route['chunk'] as String,
            }
            .where(
              (chunk) => chunk.isNotEmpty && !_loadedChunks.contains(chunk),
            )
            .toList();
    if (chunks.isEmpty) return;
    await Future<void>.delayed(const Duration(milliseconds: 250));
    onLog?.call(1, '[dev] preloading ${chunks.length} page chunks');
    var loaded = 0;
    for (final chunk in chunks) {
      if (_disposed || _vm == null || _dev == null) return;
      if (_loadedChunks.contains(chunk)) continue;
      try {
        await _ensureChunk(chunk);
        loaded++;
      } catch (e) {
        onLog?.call(2, '[dev] preload $chunk failed: $e');
      }
      await Future<void>.delayed(const Duration(milliseconds: 16));
    }
    onLog?.call(1, '[dev] preloaded $loaded page chunks');
  }

  /// Applies an edit that only touched page chunks, without restarting the
  /// VM: re-evaluate each changed chunk and let the JS router remount the
  /// pages that came from it. Everything else — the other pages on the
  /// stack, their state, the shell — stays as it is, which is the whole
  /// point: editing one page should refresh that page.
  ///
  /// A chunk this VM never loaded is left alone; it is not in the registry,
  /// so the next time that page is opened it is fetched fresh anyway.
  ///
  /// Returns false when the swap is not possible (not a split build, or a
  /// fetch failed), and the caller falls back to a full reload.
  Future<bool> _hotSwapPages(DevClient dev, List<String> chunks) async {
    if (chunkLoader == null || _vm == null) return false;
    final swapped = <String>[];
    try {
      for (final chunk in chunks) {
        if (!_loadedChunks.contains(chunk)) continue;
        final bytes = await dev.fetch('/pages/$chunk.js');
        if (_disposed || _vm == null) return true;
        _eval(bytes);
        swapped.add(chunk);
      }
    } catch (e) {
      onLog?.call(2, '[dev] page swap failed ($e) — reloading everything');
      return false;
    }
    for (final chunk in swapped) {
      dispatchEvent(0, FjsEvent.devPageReload, text: chunk);
    }
    onLog?.call(
      1,
      swapped.isEmpty
          ? '[dev] ${chunks.join(', ')} changed, not loaded here — nothing to reload'
          : '[dev] reloaded page ${swapped.join(', ')}',
    );
    notifyListeners();
    return true;
  }

  /// Module-level hot swap (spec 037). The server names the changed units
  /// plus every transitive importer, dependencies first, and the page
  /// chunks that pull them in. Unit factories are lazy, so the sequence is
  /// define-everything-then-trigger: re-running a factory re-requires its
  /// imports (fresh exports, partial-exports semantics on cycles), exactly
  /// like a fresh VM start. The page chunks re-evaluate too — their bundled
  /// code captured the old exports at eval time, and remounting has to show
  /// the new component, not the captured one.
  ///
  /// Returns false when the swap is not possible (fetch failed, a unit
  /// threw) and the caller falls back to a full reload.
  Future<bool> _hotSwapUnits(DevClient dev, DevReload reload) async {
    if (unitLoader == null || _vm == null) return false;
    final fetched = <String, Uint8List>{};
    try {
      for (final id in reload.units) {
        fetched[id] = (await unitLoader!(id))!;
        if (_disposed || _vm == null) return true;
      }
      for (final entry in fetched.entries) {
        _eval(entry.value);
        _loadedUnits.add(entry.key);
      }
      for (final id in reload.units) {
        runSource(
          '__fjsRequireUnit(${jsonEncode(id)});',
          filename: 'unit-trigger.js',
        );
        if (_disposed || _vm == null) return true;
      }
      for (final chunk in reload.pages) {
        if (!_loadedChunks.contains(chunk)) continue;
        final bytes = await dev.fetch('/pages/$chunk.js');
        if (_disposed || _vm == null) return true;
        _eval(bytes);
      }
    } catch (e) {
      onLog?.call(2, '[dev] unit swap failed ($e) — reloading everything');
      return false;
    }
    final remounted = reload.pages.where(_loadedChunks.contains).toList();
    for (final chunk in remounted) {
      dispatchEvent(0, FjsEvent.devPageReload, text: chunk);
    }
    onLog?.call(
      1,
      '[dev] hot-swapped ${reload.units.join(', ')}'
      '${remounted.isEmpty ? '' : ' — remounted ${remounted.join(', ')}'}',
    );
    notifyListeners();
    return true;
  }

  /// Re-asks the server's current manifest whether it still serves a
  /// units-mode split build (spec 037). Every full-reload path negotiates
  /// afresh instead of reusing the connect-time flag — the dev server may
  /// have restarted as a classic build since, and evaluating a units entry
  /// without `/units.js` leaves the registry empty, so the entry's first
  /// shared import dies with `dev unit … is not loaded` (spec 074).
  Future<bool> _renegotiateUnits(DevClient dev) async {
    if (chunkLoader == null) return false;
    final fresh = await dev.fetchManifest();
    return fresh?['units'] == true;
  }

  /// One dev load: fresh VM, then the shared prelude (split builds only),
  /// then the app bundle. Fetched before [reset] so a failed fetch leaves
  /// the previous screen up instead of blanking it.
  ///
  /// Units mode (spec 037) inserts one more fetch between the two: the
  /// unit bundle defines every shared app module's factory (it runs nothing
  /// — factories execute lazily on first require), so the app entry and
  /// every page chunk find their dependencies already registered.
  Future<void> _loadFromDev(
    DevClient dev,
    bool split, [
    bool units = false,
  ]) async {
    final shared = split ? await dev.fetchForBootstrap('/shared.js') : null;
    final unitBundle = units ? await dev.fetchForBootstrap('/units.js') : null;
    final bundle = await dev.fetchBundle();
    if (shared != null) {
      // the shell lives in the prelude, so a reload has to replace it too
      clearPreludes();
      reset();
      addPrelude(shared);
    } else {
      reset();
    }
    _unitsMode = units;
    if (unitBundle != null) {
      _eval(unitBundle);
    }
    _runProgram(bundle);
    onLog?.call(1, '[dev] bundle loaded (${bundle.length} bytes)');
  }

  /// Knocks once on a PUBLIC host so iOS raises its "use wireless data"
  /// sheet — the one thing the dev bootstrap cannot wait its way out of.
  ///
  /// Measured on a freshly installed app (iOS 26, spec 030): the only sheet
  /// a LAN request raises is "find and connect to devices on your local
  /// network", and answering it leaves the SAME process still failing every
  /// request with `No route to host`. The wireless-data sheet gates all
  /// networking until it is answered, and a LAN request never raises it —
  /// on that device it had only ever appeared when an `<image>` loaded a
  /// picture from the public internet. So retrying waits for something that
  /// will never happen on its own; somebody has to knock.
  ///
  /// Deliberately narrow: iOS only (nothing else has this sheet), dev only
  /// (this is reached from [connectDev], and release never calls it), and
  /// fire-and-forget — the answer is worthless, raising the sheet is the
  /// entire point. The URL is Apple's own captive-portal probe: no user
  /// data leaves the device and the response is a few dozen bytes.
  Future<void> _raiseIosNetworkPrompt() async {
    if (!Platform.isIOS) return;
    try {
      await _http
          .fetch(Uri.parse('http://captive.apple.com/hotspot-detect.html'))
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      // Expected to fail while the sheet is up, and irrelevant either way.
    }
  }

  /// Where the release build's files (`assets/fjs/…`: public/ files,
  /// module data) are read from. The app's own Flutter assets by default;
  /// a host that runs a release build fetched from a web server swaps in a
  /// bundle that reads the same keys from that server, so `<image
  /// src="/x.png">`, a relative fetch() and module assets keep working
  /// without the files being baked into the host.
  AssetBundle assetBundle = rootBundle;

  /// True while a `fjs dev` connection is live.
  bool get isDevConnected => _dev != null;

  /// Where the connected `fjs dev` server lives, or null in a release
  /// build (and before [connectDev] returns). A component module that
  /// ships a build-time file — an icon set, a font table — reads it from
  /// the dev server while this is set, and from its bundled asset when it
  /// is not, so an edit shows up without a rebuild.
  Uri? get devUri => _dev?.baseUri;

  /// GETs one path from the connected dev server, over the same client the
  /// bundle comes down on. Throws when no dev server is connected.
  Future<Uint8List> devFetch(String path) {
    final dev = _dev;
    if (dev == null) throw FjsException('not connected to a dev server');
    return dev.fetch(path);
  }

  /// Fetches [url] from Dart, over the same HttpClient that backs JS
  /// `fetch()` — so a component module needs no client of its own, and its
  /// requests die with the engine. Throws on transport failure or non-2xx.
  Future<Uint8List> fetch(
    Uri url, {
    String method = 'GET',
    Map<String, String>? headers,
    List<int>? body,
    Duration? timeout,
  }) => _http.fetch(
    url,
    method: method,
    headers: headers,
    body: body,
    timeout: timeout,
  );

  /// [fetch], decoded as utf8 — the shape most callers want (JSON, text).
  Future<String> fetchString(
    Uri url, {
    String method = 'GET',
    Map<String, String>? headers,
    List<int>? body,
    Duration? timeout,
  }) async => utf8.decode(
    await fetch(
      url,
      method: method,
      headers: headers,
      body: body,
      timeout: timeout,
    ),
  );

  /// Re-fetches the bundle from the connected dev server and applies it —
  /// the manual twin of the WebSocket reload push (dev-menu "reload").
  Future<void> reloadDev() async {
    final dev = _dev;
    if (dev == null) throw FjsException('not connected to a dev server');
    await _loadFromDev(dev, chunkLoader != null, await _renegotiateUnits(dev));
  }

  /// Closes the dev connection and stops the event loop. The mirror tree
  /// keeps its last frame; call [reset] to clear the screen too.
  void disconnectDev() {
    _dev?.close();
    _dev = null;
    stopEventLoop();
    notifyListeners();
  }

  void _runProgram(Uint8List bundle) {
    final bytes = fjsMaybeGunzip(bundle);
    if (_looksLikeFjsBundle(bytes)) {
      runBundle(bytes);
    } else {
      runSource(utf8.decode(bytes), filename: 'dev-bundle.js');
    }
  }

  static bool _looksLikeFjsBundle(Uint8List b) =>
      b.length > 8 &&
      b[0] == 0x46 &&
      b[1] == 0x4A &&
      b[2] == 0x53 &&
      b[3] == 0x42;

  // ---- native trampolines -------------------------------------------------

  static void _onLogTrampoline(int level, ffi.Pointer<ffi.Uint8> msg, int len) {
    final engine = _current;
    if (engine == null) return;
    final message = utf8.decode(msg.asTypedList(len), allowMalformed: true);
    engine._log(level, message);
  }

  /// Every console line the VM produces goes here: to the host app through
  /// [onLog], and — while `fjs dev` is connected — up the dev socket, which
  /// is what `fjs log` and `fjs eval` read.
  void _log(int level, String message) {
    onLog?.call(level, message);
    _dev?.sendLog(level, message);
  }

  static void _onToastTrampoline(ffi.Pointer<ffi.Uint8> msg, int len) {
    final engine = _current;
    if (engine == null) return;
    final message = utf8.decode(msg.asTypedList(len), allowMalformed: true);
    engine.onToast?.call(message);
  }

  static void _onUiOpsTrampoline(ffi.Pointer<ffi.Uint8> ops, int len) {
    final engine = _current;
    if (engine == null) return;
    final frame = Uint8List.fromList(ops.asTypedList(len));
    try {
      engine.tree.applyFrame(frame);
    } catch (e) {
      // a malformed frame must not break the JS callback chain
      debugPrint('[fjs] frame apply failed: $e');
      return;
    }
    if (engine.recordFrames) engine._frameLog.add(frame);
    // A single JS event can drain several microtask UI frames. Coalesce them
    // into one Flutter rebuild after the native dispatch returns.
    engine._scheduleUiNotify();
  }

  /// The queued [_scheduleUiNotify] delivered now — the geometry module's
  /// forced reflow needs the tree-level signal too (a new page root only
  /// reaches its route's FjsView through it). The microtask still runs and
  /// finds nothing left to do.
  void _flushUiNotifyNow() {
    if (!_uiNotifyQueued || _disposed) return;
    _uiNotifyQueued = false;
    tree.flushDirty();
    notifyListeners();
  }

  void _scheduleUiNotify() {
    if (_uiNotifyQueued || _disposed) return;
    _uiNotifyQueued = true;
    scheduleMicrotask(() {
      if (!_uiNotifyQueued) return; // delivered early by _flushUiNotifyNow
      _uiNotifyQueued = false;
      if (_disposed) return;
      // per-node signals first, then the tree-level one. Both are deferred to
      // here rather than fired inside applyFrame: one JS event can drain
      // several op frames, and a listener must never see a half-applied one.
      tree.flushDirty();
      notifyListeners();
    });
  }

  // ---- frame recording (UI snapshot restore) -------------------------------

  bool _recordFrames = false;

  /// While true, every applied UI op frame is kept in [takeFrameLog]'s log.
  /// Hosts snapshot a session's frames and replay them into a fresh tree to
  /// restore the last UI instantly (direct-render) while the VM cold-boots.
  ///
  /// The log is only replayable from the frame recording was turned on, so
  /// turning it on tells the JS writer to forget its interned styles: without
  /// that, frames in the log would reference style definitions that were sent
  /// before recording started and are therefore not in it.
  bool get recordFrames => _recordFrames;

  set recordFrames(bool value) {
    if (_recordFrames == value) return;
    _recordFrames = value;
    if (value && _vm != null) {
      try {
        runSource(
          'globalThis.__fjsForgetStyles && globalThis.__fjsForgetStyles();',
          filename: 'fjs:forget-styles',
        );
      } on FjsException catch (e) {
        // recording still works, the log just may not be replayable standalone
        debugPrint('[fjs] could not reset the style directory: $e');
      }
    }
  }

  final List<Uint8List> _frameLog = [];

  /// Returns and clears the recorded frames since recording started.
  List<Uint8List> takeFrameLog() {
    final log = List<Uint8List>.of(_frameLog);
    _frameLog.clear();
    return log;
  }

  /// Direct-render path: synchronously replays pre-recorded op frames (from
  /// [takeFrameLog]) into the mirror tree and notifies listeners. Hosts call
  /// this right after [reset] so the previous screen paints instantly while
  /// the new VM boots behind it.
  void replayFrames(List<Uint8List> frames) {
    for (final frame in frames) {
      tree.applyFrame(frame);
    }
    tree.flushDirty();
    notifyListeners();
  }

  // ---- internals -----------------------------------------------------------

  static FjsEngine? _current;

  void _bind() {
    _current = this;
  }

  FJSVMHandle _requireVm() {
    final vm = _vm;
    if (vm == null) throw FjsException('VM is not running');
    return vm;
  }

  String _lastError() {
    final vm = _vm;
    if (vm == null) return 'unknown error';
    final p = bind.lastError(vm);
    return p == ffi.nullptr ? 'unknown error' : cString(p);
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _unwatchPointer?.call();
    stopEventLoop();
    _http.close();
    _dev?.close();
    final vm = _vm;
    if (vm != null) bind.vmDestroy(vm);
    _vm = null;
    super.dispose();
  }
}
