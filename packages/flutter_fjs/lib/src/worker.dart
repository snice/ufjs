// FjsWorker — a real background thread for JS.
//
// Each worker is its own Dart isolate owning an independent QuickJS runtime
// (separate runtimes are thread-safe by design), so long tasks never block
// the UI isolate. Messaging is a string channel both directions:
//
//   main JS                     Dart                       worker JS
//   w.postMessage(m)  -> invokeHost('js.worker.post') -> onmessage({data:m})
//   w.onmessage       <- dispatchEvent(wid, 9, text) <- postMessage(m)
//
// Worker code runs without fjs-runtime: it gets the globals `onmessage`
// (settable), `postMessage(msg)` and the usual console/timers. Only strings
// (or JSON strings) cross the boundary in v1.
import 'dart:async';
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:isolate';

import 'package:ffi/ffi.dart';

import 'ffi.dart';

/// Spawned and owned by the main isolate (the engine registers host modules
/// `js.worker.*` automatically). Mirror of the Web Worker surface.
class FjsWorker {
  FjsWorker._(this.id);

  /// Numeric handle shared with JS (`js.worker.create` returns it).
  final int id;

  /// Called on the main isolate when the worker posts a message.
  void Function(String message)? onMessage;

  /// Called when the worker errors (eval failure or uncaught exception).
  void Function(String error)? onError;

  SendPort? _toWorker;
  ReceivePort? _fromWorker;
  bool _terminated = false;

  static int _nextId = 1;

  /// Reserves an id synchronously (invokeHost is a sync ABI) — the spawn
  /// happens in the background and messages sent before it is ready queue.
  static int get nextId => _nextId++;

  /// Spawns the worker isolate and evaluates [code] in a fresh VM.
  /// Returns immediately; [onMessage]/[onError] fire as events arrive.
  static FjsWorker start(
    String code, {
    void Function(String message)? onMessage,
    void Function(String error)? onError,
  }) {
    return startWithId(_nextId++, code, onMessage: onMessage, onError: onError);
  }

  /// Same as [start] with an externally-allocated id (the engine's host
  /// module reserves the id synchronously before spawning).
  static FjsWorker startWithId(
    int id,
    String code, {
    void Function(String message)? onMessage,
    void Function(String error)? onError,
  }) {
    final worker = FjsWorker._(id);
    worker.onMessage = onMessage;
    worker.onError = onError;

    final fromWorker = ReceivePort();
    worker._fromWorker = fromWorker;
    fromWorker.listen((m) {
      if (m is List && m.length == 2) {
        switch (m[0]) {
          case 'ready':
            worker._toWorker = m[1] as SendPort;
            for (final pending in worker._pending) {
              worker._toWorker!.send(pending);
            }
            worker._pending.clear();
            return;
          case 'msg':
            if (!worker._terminated) worker.onMessage?.call(m[1] as String);
            return;
          case 'error':
            if (!worker._terminated) worker.onError?.call(m[1] as String);
            return;
        }
      }
    });

    Isolate.spawn(_workerEntry, [worker.id, code, fromWorker.sendPort]);
    return worker;
  }

  final List<String> _pending = [];

  /// Main -> worker (queued until the isolate is ready).
  void postMessage(String message) {
    if (_terminated) return;
    final p = _toWorker;
    if (p != null) {
      p.send(message);
    } else {
      _pending.add(message);
    }
  }

  /// Kills the isolate immediately.
  void terminate() {
    _terminated = true;
    _fromWorker?.close();
    _toWorker = null;
  }

  /// Worker-isolate entry. Messages from main arrive on [pumpPort] as raw
  /// strings; they are delivered into JS via the dispatch_event channel
  /// (eventType 9 -> __fjsDispatchEvent -> onmessage).
  static void _workerEntry(List args) {
    final workerId = args[0] as int;
    final code = args[1] as String;
    final toMain = args[2] as SendPort;

    final bind = FjsBindings.instance();
    final vm = bind.vmCreate();
    if (vm == ffi.nullptr) {
      toMain.send(['error', 'worker $workerId: failed to create VM']);
      return;
    }

    // log + postMessage bridge (worker's postMessage rides invokeHost)
    final onLog = ffi.Pointer.fromFunction<OnLogC>(_logTrampoline);
    final invoke = ffi.Pointer.fromFunction<InvokeHostC>(_invokeTrampoline, 0);
    bind.setCallbacks(vm, onLog, ffi.nullptr, invoke);
    _ctx = _WorkerCtx(vm, bind, toMain);

    const prelude = '''
globalThis.__msgHandler = null;
Object.defineProperty(globalThis, 'onmessage', {
  set: function (fn) { globalThis.__msgHandler = fn; },
  get: function () { return globalThis.__msgHandler; }
});
globalThis.postMessage = function (m) {
  globalThis.__fjs.fns.invokeHost('post', String(m));
};
globalThis.__fjsDispatchEvent = function (nodeId, eventType, params) {
  if (eventType === 9 && globalThis.__msgHandler) {
    globalThis.__msgHandler({ data: params });
  }
};
''';
    final preludeUnits = utf8.encode(prelude);
    final preludePtr = _toCString(prelude);
    final preludeName = _toCString('worker-prelude.js');
    var rc = bind.evalSource(vm, preludePtr, preludeUnits.length, preludeName);
    malloc.free(preludePtr);
    malloc.free(preludeName);
    if (rc != 0) {
      toMain.send(['error', 'worker prelude: ${_lastError(bind, vm)}']);
      return;
    }

    final codeUnits = utf8.encode(code);
    final codePtr = _toCString(code);
    final codeName = _toCString('worker.js');
    rc = bind.evalSource(vm, codePtr, codeUnits.length, codeName);
    malloc.free(codePtr);
    malloc.free(codeName);
    if (rc != 0) {
      toMain.send(['error', 'worker eval: ${_lastError(bind, vm)}']);
      return;
    }

    // message inbox from the main isolate
    final inbox = ReceivePort();
    inbox.listen((m) {
      if (m is String) {
        final units = utf8.encode(m);
        final p = _toCString(m);
        bind.dispatchEvent(
          vm,
          workerId,
          FjsEvent.workerMessage,
          p,
          units.length,
        );
        malloc.free(p);
      }
    });

    // hand ports to main, then pump timers/jobs forever
    toMain.send(['ready', inbox.sendPort]);
    Timer.periodic(const Duration(milliseconds: 8), (_) {
      bind.pump(vm, bind.now(vm));
    });
  }

  static _WorkerCtx? _ctx;

  static void _logTrampoline(int level, ffi.Pointer<ffi.Uint8> msg, int len) {
    final ctx = _ctx;
    if (ctx != null) {
      final text = utf8.decode(msg.asTypedList(len), allowMalformed: true);
      ctx.toMain.send(['error', '[worker:$level] $text']);
    }
  }

  static int _invokeTrampoline(
    ffi.Pointer<ffi.Uint8> namePtr,
    int argc,
    ffi.Pointer<FJSValue> args,
    ffi.Pointer<FJSValue> out,
  ) {
    final ctx = _ctx;
    if (ctx == null) return -1;
    final name = cString(namePtr);
    if (name == 'post' && argc >= 1) {
      final v = args[0];
      final msg = v.tag == fjsTString
          ? cString(v.s, v.len)
          : (v.tag == fjsTFloat64 ? '${v.d}' : 'null');
      ctx.toMain.send(['msg', msg]);
      return 0;
    }
    return -1;
  }

  static String _lastError(FjsBindings bind, FJSVMHandle vm) {
    final p = bind.lastError(vm);
    return p == ffi.nullptr ? 'unknown error' : cString(p);
  }

  static ffi.Pointer<ffi.Uint8> _toCString(String s) {
    final units = utf8.encode(s);
    final p = malloc<ffi.Uint8>(units.length + 1);
    p.asTypedList(units.length + 1)
      ..setRange(0, units.length, units)
      ..[units.length] = 0;
    return p;
  }
}

class _WorkerCtx {
  _WorkerCtx(this.vm, this.bind, this.toMain);

  final FJSVMHandle vm;
  final FjsBindings bind;
  final SendPort toMain;
}
