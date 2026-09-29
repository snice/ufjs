// Dart-side host modules. JS calls `__fjs.fns.invokeHost(name, ...args)`
// synchronously; the engine bridges that to HostRegistry via the
// fjs_invoke_host C callback (the JSI HostFunction path).
//
// Values crossing the boundary are limited to the tagged C ABI in v1:
// null/bool/num/string — see docs/jsi-and-native-modules.md.
import 'dart:convert';
import 'dart:ffi' as ffi;

import 'package:ffi/ffi.dart';

import '../ffi.dart';
import 'object_bridge.dart';

typedef HostHandler = Object? Function(List<Object?> args);

/// An async host handler: the Future settles whenever the work is done —
/// the engine relays the value back into the VM as dispatchEvent (event 32),
/// which is why nothing here may run on another isolate.
typedef AsyncHostHandler = Future<Object?> Function(List<Object?> args);

class HostResult {
  HostResult.ok(this.value) : message = null;
  HostResult.error(this.message) : value = null;
  final Object? value;
  final String? message;
}

/// Registry of named host handlers exposed to JS.
class HostRegistry {
  final Map<String, HostHandler> _handlers = {};
  final Map<String, AsyncHostHandler> _asyncHandlers = {};

  void register(String name, HostHandler handler) {
    _handlers[name] = handler;
  }

  void unregister(String name) {
    _handlers.remove(name);
    _asyncHandlers.remove(name);
  }

  /// Async handlers live in their own table, deliberately not merged with
  /// [register]: a sync handler's result must exist by the time the JSI
  /// trampoline returns (its return value IS the call's result), while an
  /// async one only starts work there. One table with `is Future` checks
  /// would make every sync call pay for the ambiguity — and registering the
  /// same name both ways is a bug, not a fallback.
  void registerAsync(String name, AsyncHostHandler handler) {
    _asyncHandlers[name] = handler;
  }

  void unregisterAsync(String name) => _asyncHandlers.remove(name);

  AsyncHostHandler? asyncHandler(String name) => _asyncHandlers[name];

  HostResult invoke(String name, List<Object?> args) {
    final handler = _handlers[name];
    if (handler == null) {
      return HostResult.error('host module "$name" is not registered');
    }
    try {
      return HostResult.ok(handler(args));
    } catch (e) {
      return HostResult.error('host module "$name" threw: $e');
    }
  }
}

/// Bridges the native fjs_invoke_host callback to a [HostRegistry].
///
/// Native contract (fjs.h): arg strings are valid only during the call;
/// strings written into `out` must be malloc'ed and are free()d by the
/// engine after JSValue conversion.
class HostBridge {
  HostBridge(this.registry);

  final HostRegistry registry;

  late final ffi.Pointer<ffi.NativeFunction<InvokeHostC>> pointer =
      ffi.Pointer.fromFunction(_invokeHostTrampoline, 0);

  static int _invokeHostTrampoline(
    ffi.Pointer<ffi.Uint8> namePtr,
    int argc,
    ffi.Pointer<FJSValue> args,
    ffi.Pointer<FJSValue> out,
  ) {
    try {
      final name = cString(namePtr);
      // rich = the object-ABI ops (spec 159): their answers may carry the
      // structured tags (JSON lists/maps), which the frozen scalar modules
      // must never produce
      final rich = name.startsWith('fjs.object.');
      final list = <Object?>[];
      for (var i = 0; i < argc; i++) {
        list.add(_fromNative(args[i], rich));
      }
      final result = _registryForThread!.invoke(name, list);
      if (result.message != null) {
        _writeErrorOut(out, result.message!);
        return -1;
      }
      _writeOut(out, result.value, rich);
      return 0;
    } catch (e) {
      _writeErrorOut(out, 'host bridge failure: $e');
      return -1;
    }
  }

  /// The native callback has no user-data pointer, so the engine (single
  /// VM per UI isolate, threading v1) registers itself before attaching.
  static HostRegistry? _registryForThread;

  static void install(HostRegistry registry) {
    _registryForThread = registry;
  }

  /// The object-ABI side of the same story (spec 159): the trampoline
  /// consults it for the rich tags — FJS_T_HANDLE resolves to the live
  /// object, functions and objects encode as callback ids / handles. Null
  /// on hosts without a bridge (workers): touching object tags there is a
  /// loud error, never a silent misread.
  static ObjectBridge? bridgeForThread;

  static void installBridge(ObjectBridge bridge) {
    bridgeForThread = bridge;
  }

  static Object? _fromNative(FJSValue v, bool rich) {
    switch (v.tag) {
      case fjsTNull:
        return null;
      case fjsTBool:
        return v.i != 0;
      case fjsTInt32:
        return v.i;
      case fjsTFloat64:
        return v.d;
      case fjsTString:
        return cString(v.s, v.len);
      case fjsTHandle:
        final bridge = bridgeForThread;
        if (bridge == null) {
          throw StateError('object handle without an ObjectBridge '
              '(worker VM? spec 159 modules are main-VM only)');
        }
        return bridge.instanceFor(v.j);
      case fjsTCallback:
        final bridge = bridgeForThread;
        if (bridge == null) {
          throw StateError('callback id without an ObjectBridge');
        }
        return v.j > 0 ? bridge.callbackFor(v.j) : bridge.closureFor(-v.j);
      default:
        // FJS_T_PENDING / FJS_T_JSON are reply-only; anything else is a tag
        // this build does not know — loud, never a silent null.
        throw StateError('unsupported FJSValue tag ${v.tag}');
    }
  }

  static void _writeOut(ffi.Pointer<FJSValue> out, Object? value, bool rich) {
    out.ref.tag = fjsTNull;
    out.ref.j = 0;
    if (value == null) {
      return;
    } else if (value is bool) {
      out.ref.tag = fjsTBool;
      out.ref.i = value ? 1 : 0;
    } else if (value is int) {
      out.ref.tag = fjsTInt32;
      out.ref.i = value;
    } else if (value is double) {
      out.ref.tag = fjsTFloat64;
      out.ref.d = value;
    } else if (value is num) {
      out.ref.tag = fjsTFloat64;
      out.ref.d = value.toDouble();
    } else if (value is String) {
      _writeStringValue(out, value);
    } else {
      // rich values (spec 159) — a bridge is prerequisite for any of these
      // to exist, but stay defensive: without one, keep the v1 string rule.
      final bridge = bridgeForThread;
      if (bridge != null) {
        bridge.writeValue(out, value, rich);
        return;
      }
      _writeStringValue(out, value.toString());
    }
  }

  /// out strings are malloc'ed here; the engine free()s them after
  /// conversion (the fjs.h contract).
  static void _writeStringValue(ffi.Pointer<FJSValue> out, String str) {
    final units = utf8.encode(str);
    final p = malloc<ffi.Uint8>(units.length + 1);
    p.asTypedList(units.length + 1)
      ..setRange(0, units.length, units)
      ..[units.length] = 0;
    out.ref.tag = fjsTString;
    out.ref.s = p;
    out.ref.len = units.length;
  }

  /// v3 (spec 159): the failure message rides back to JS as the exception
  /// text instead of dying in the console (constitution V). Same malloc
  /// contract as _writeStringValue — the engine frees it on the error path.
  static void _writeErrorOut(ffi.Pointer<FJSValue> out, String message) {
    out.ref.tag = fjsTNull;
    out.ref.j = 0;
    _writeStringValue(out, message);
  }
}
