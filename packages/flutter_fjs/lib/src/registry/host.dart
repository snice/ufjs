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
      final list = <Object?>[];
      for (var i = 0; i < argc; i++) {
        list.add(_fromNative(args[i]));
      }
      final result = _registryForThread!.invoke(name, list);
      if (result.message != null) {
        _writeErrorOut(out, result.message!);
        return -1;
      }
      _writeOut(out, result.value);
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

  static Object? _fromNative(FJSValue v) {
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
      default:
        return null;
    }
  }

  static void _writeOut(ffi.Pointer<FJSValue> out, Object? value) {
    out.ref.tag = fjsTNull;
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
    } else {
      // everything else crosses as its utf8 string form (v1 ABI)
      final str = value is String ? value : value.toString();
      final units = utf8.encode(str);
      final p = malloc<ffi.Uint8>(units.length + 1);
      p.asTypedList(units.length + 1)
        ..setRange(0, units.length, units)
        ..[units.length] = 0;
      out.ref.tag = fjsTString;
      out.ref.s = p;
      out.ref.len = units.length;
    }
  }

  static void _writeErrorOut(ffi.Pointer<FJSValue> out, String message) {
    out.ref.tag = fjsTNull;
    // error details also go to the console via log callback in engine
  }
}
