// Dart-side object registry for the structured object ABI (spec 159).
//
// JS sees Dart objects through native proxies ("DartObject"); every member
// access funnels here through the shared invokeHost trampoline under the
// reserved "fjs.object.*" module names. A module adapter decides what its
// objects expose — there is no reflection in compiled Dart, so the SPI is
// explicit: construct/invoke/get/set/dispose.
//
// Handle discipline mirrors the byte handles (spec 038): ids are monotonic
// and never reused, so a stale id misses loudly instead of aliasing. The
// registry dies with the VM — FjsEngine.reset() calls [reset], and any
// settle/callback arriving after that finds no VM and is dropped (the whole
// JS world it belonged to is gone).
import 'dart:async';
import 'dart:convert';
import 'dart:ffi' as ffi;

import 'package:ffi/ffi.dart';

import '../ffi.dart';

/// Marker a module's [FjsObjectModule.get] returns to say "this member is a
/// method, not a field" — the JS proxy then exposes a callable. The default
/// implementation returns it for every member, so method-only objects need
/// zero configuration.
class FjsMethod {
  const FjsMethod._();
  static const FjsMethod instance = FjsMethod._();
}

/// Internal: tells the trampoline to answer a pending promise (FJS_T_PENDING)
/// for this call id; [ObjectBridge] settles it when the Future completes.
class FjsPendingValue {
  FjsPendingValue(this.callId);
  final int callId;
}

/// A JS function the engine holds. Passed into adapters wherever JS passed
/// a function argument; invoke it like any Dart callable.
class FjsCallback {
  FjsCallback(this.id, this._invoke);

  /// The engine-held callback id (positive). Needed to hand the SAME
  /// function back to JS without wrapping it again.
  final int id;

  final FutureOr<Object?> Function(List<Object?> args) _invoke;

  FutureOr<Object?> call([List<Object?> args = const []]) => _invoke(args);
}

/// The SPI a Dart capability implements to expose objects to JS.
abstract class FjsObjectModule {
  const FjsObjectModule();

  /// Builds an instance; the returned object becomes a JS proxy.
  Object? construct(String className, List<Object?> args);

  /// A method call `obj.member(...args)` on an instance this module built.
  /// Returning a Future turns the JS call into a promise automatically.
  Object? invoke(Object instance, String member, List<Object?> args) =>
      null;

  /// A field read `obj.member`. Return [FjsMethod.instance] to expose the
  /// member as a method instead — the default, so method-only objects
  /// implement nothing but construct/invoke.
  Object? get(Object instance, String member) => FjsMethod.instance;

  /// A field write `obj.member = value`.
  void set(Object instance, String member, Object? value) {}

  /// The JS proxy was collected (or fjs.object.release arrived). Drop any
  /// native resource the instance holds; the framework forgets its handle.
  void dispose(Object instance) {}
}

/// Registry + wire format for one VM. One instance per [FjsEngine]; the
/// trampoline reaches it through HostBridge.bridgeForThread (one isolate,
/// one VM, threading v1).
class ObjectBridge {
  ObjectBridge({
    required FJSVMHandle Function() vmHandle,
    required String? Function() lastError,
  }) : _vmHandle = vmHandle,
       _lastError = lastError;

  final FJSVMHandle Function() _vmHandle; // nullptr when the VM is absent
  final String? Function() _lastError;
  final Map<String, FjsObjectModule> _modules = {};
  final Map<int, _Entry> _instances = {};
  final Expando<_Entry> _byInstance = Expando();
  final Map<int, Function> _closures = {};
  int _nextHandle = 1;
  int _nextClosure = 1;
  int _nextCallId = 1;

  void registerModule(String name, FjsObjectModule module) {
    _modules[name] = module;
  }

  void unregisterModule(String name) => _modules.remove(name);

  /// The VM died or was rebuilt: handles, closures and pending settles all
  /// belonged to that JS world. Ids keep increasing — a fresh JS world must
  /// never see a number an older one used.
  void reset() {
    _instances.clear();
    _closures.clear();
  }

  // ---- wire format --------------------------------------------------------

  /// FJSValue -> Dart. Handles resolve to the live object (stale ids throw —
  /// spec 038 discipline), callbacks to invokable wrappers or the original
  /// closure. PENDING is reply-only and never a legal argument.
  Object? readValue(FJSValue v) {
    switch (v.tag) {
      case fjsTHandle:
        return instanceFor(v.j);
      case fjsTCallback:
        return v.j > 0 ? callbackFor(v.j) : closureFor(-v.j);
      default:
        return null;
    }
  }

  /// Dart -> FJSValue. The mirror of the native write_out_value: scalars
  /// direct, functions as negative callback ids, other objects as (fresh or
  /// existing) handles. List/Map encode as JSON either way — [rich] picks
  /// the tag: FJS_T_JSON on the object path (the engine parses it into a
  /// real array/object, so generated d.ts types are true) or a plain string
  /// on the frozen v1 path.
  void writeValue(ffi.Pointer<FJSValue> out, Object? value, bool rich) {
    if (value == null) {
      out.ref.tag = fjsTNull;
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
      _writeString(out, value);
    } else if (value is FjsMethod) {
      out.ref.tag = fjsTMethod;
    } else if (value is FjsPendingValue) {
      out.ref.tag = fjsTPending;
      out.ref.j = value.callId;
    } else if (value is FjsCallback) {
      out.ref.tag = fjsTCallback;
      out.ref.j = value.id; // positive: JS gets the very function back
    } else if (value is Function) {
      out.ref.tag = fjsTCallback;
      out.ref.j = -registerClosure(value);
    } else if (value is List || value is Map) {
      // _writeString stamps fjsTString; the rich path re-tags afterwards
      _writeString(out, jsonEncode(value));
      if (rich) out.ref.tag = fjsTJson;
    } else {
      out.ref.tag = fjsTHandle;
      out.ref.j = handleFor(value) ?? registerInstance(value);
    }
  }

  static void _writeString(ffi.Pointer<FJSValue> out, String s) {
    final units = utf8.encode(s);
    final p = malloc<ffi.Uint8>(units.length + 1);
    p.asTypedList(units.length + 1)
      ..setRange(0, units.length, units)
      ..[units.length] = 0;
    out.ref.tag = fjsTString;
    out.ref.s = p;
    out.ref.len = units.length;
  }

  // ---- resolution ---------------------------------------------------------

  /// FJS_T_HANDLE -> the live Dart object. A stale id is a loud error, never
  /// another object (monotonic ids, spec 038).
  Object instanceFor(int handle) {
    final entry = _instances[handle];
    if (entry == null) {
      throw StateError('object handle $handle is not registered '
          '(released, or the VM was rebuilt)');
    }
    return entry.instance;
  }

  FjsCallback callbackFor(int id) {
    return FjsCallback(id, (args) => _callJsCallback(id, args));
  }

  Function closureFor(int dartId) {
    final fn = _closures[dartId];
    if (fn == null) {
      throw StateError('closure $dartId is not registered (released?)');
    }
    return fn;
  }

  int? handleFor(Object instance) => _byInstance[instance]?.handle;

  int registerInstance(Object instance) {
    final existing = _byInstance[instance];
    if (existing != null) return existing.handle;
    final handle = _nextHandle++;
    // A foreign object (returned by an adapter without passing through
    // construct) has no owning module: it can travel back to JS and be
    // compared, but member dispatch on it fails loudly.
    final entry = _Entry(handle, instance, _byInstance[instance]?.module);
    _instances[handle] = entry;
    _byInstance[instance] = entry;
    return handle;
  }

  int registerClosure(Function fn) {
    final id = _nextClosure++;
    _closures[id] = fn;
    return id;
  }

  /// Invokes an engine-held JS function from Dart (fjs_vm_call_callback).
  FutureOr<Object?> _callJsCallback(int id, List<Object?> args) {
    final vm = _vmHandle();
    if (vm == ffi.nullptr) {
      throw StateError('cannot call back into JS: the VM is gone');
    }
    final bind = FjsBindings.instance();
    final argv = malloc<FJSValue>(args.isEmpty ? 1 : args.length);
    final out = malloc<FJSValue>();
    try {
      for (var i = 0; i < args.length; i++) {
        writeValue(argv + i, args[i], true);
      }
      final rc = bind.callCallback(vm, id, args.length, argv, out);
      if (rc != 0) {
        throw StateError('JS callback $id failed: ${_lastError() ?? '?'}');
      }
      switch (out.ref.tag) {
        case fjsTString:
          final s = cString(out.ref.s, out.ref.len);
          malloc.free(out.ref.s);
          return s;
        case fjsTBool:
          return out.ref.i != 0;
        case fjsTInt32:
          return out.ref.i;
        case fjsTFloat64:
          return out.ref.d;
        case fjsTHandle:
          return instanceFor(out.ref.j);
        case fjsTCallback:
          return out.ref.j > 0 ? callbackFor(out.ref.j) : closureFor(-out.ref.j);
        default:
          return null;
      }
    } finally {
      malloc.free(argv);
      malloc.free(out);
    }
  }

  /// Settles the promise a FJS_T_PENDING reply created. Deferred to a
  /// microtask: the adapter's Future may already be completed, but the
  /// invokeHost call stack is still inside JS — the same rule
  /// fjs.async.invoke follows (engine.dart).
  void _settle(int callId, bool ok, Object? value) {
    scheduleMicrotask(() {
      final vm = _vmHandle();
      if (vm == ffi.nullptr) return; // VM rebuilt: that world is gone
      final bind = FjsBindings.instance();
      final p = malloc<FJSValue>();
      try {
        writeValue(p, ok ? value : (value?.toString() ?? 'unknown error'), true);
        final rc = bind.settlePromise(vm, callId, ok ? 1 : 0, p);
        if (rc != 0) {
          // A settled-twice or VM-orphaned call id — report, don't throw
          // from a microtask nobody awaits.
          assert(() {
            // ignore: avoid_print
            print('[fjs/object] settle($callId) failed: ${_lastError()}');
            return true;
          }());
        }
      } finally {
        malloc.free(p);
      }
    });
  }

  // ---- the fjs.object.* ops ------------------------------------------------

  /// Entry for the host handlers the engine registers as
  /// `fjs.object.<op>`. [op] is the part after the dot; [args] are the
  /// trampoline-decoded values (handles already resolved to objects).
  Object? handle(String op, List<Object?> args) {
    switch (op) {
      case 'construct':
        final module = _modules[args[0]?.toString() ?? ''];
        if (module == null) {
          throw StateError('object module "${args[0]}" is not registered');
        }
        final className = args.length > 1 ? args[1]?.toString() ?? '' : '';
        final rest = args.length > 2 ? args.sublist(2) : const <Object?>[];
        final instance = module.construct(className, rest);
        if (instance == null || instance is bool || instance is num ||
            instance is String) {
          return instance; // constructors must build objects; scalars pass through
        }
        final handle = _nextHandle++;
        final entry = _Entry(handle, instance, module);
        _instances[handle] = entry;
        _byInstance[instance] = entry;
        return instance; // writeValue turns it into a fresh handle
      case 'invoke':
        final entry = _entryOf(args[0]);
        final module = entry.module!;
        final member = args.length > 1 ? args[1]?.toString() ?? '' : '';
        final rest = args.length > 2 ? args.sublist(2) : const <Object?>[];
        final result = module.invoke(entry.instance, member, rest);
        if (result is Future) {
          final callId = _nextCallId++;
          result.then(
            (v) => _settle(callId, true, v),
            onError: (Object e) => _settle(callId, false, e.toString()),
          );
          return FjsPendingValue(callId);
        }
        return result;
      case 'get':
        final entry = _entryOf(args[0]);
        final member = args.length > 1 ? args[1]?.toString() ?? '' : '';
        return entry.module!.get(entry.instance, member);
      case 'set':
        final entry = _entryOf(args[0]);
        final member = args.length > 1 ? args[1]?.toString() ?? '' : '';
        entry.module!.set(entry.instance, member,
            args.length > 2 ? args[2] : null);
        return null;
      case 'release':
        final entry = _entryOf(args[0]);
        entry.module!.dispose(entry.instance);
        _instances.remove(entry.handle);
        _byInstance[entry.instance] = null;
        return null;
      case 'callback':
        final id = (args[0] as num).toInt();
        final fn = _closures[id];
        if (fn == null) {
          throw StateError('closure $id is not registered (released?)');
        }
        return Function.apply(fn, args.length > 1 ? args.sublist(1) : const <Object?>[]);
      case 'releaseCallback':
        _closures.remove((args[0] as num).toInt());
        return null;
      default:
        throw StateError('unknown fjs.object op "$op"');
    }
  }

  _Entry _entryOf(Object? arg) {
    if (arg == null || arg is bool || arg is num || arg is String) {
      throw StateError('expected a Dart object, got a scalar — the JS side '
          'passed a non-proxy to an fjs.object op');
    }
    final entry = _byInstance[arg];
    if (entry == null) {
      throw StateError('object is not registered (released, or the VM was '
          'rebuilt)');
    }
    if (entry.module == null) {
      throw StateError('object has no owning module — only instances built '
          'by a registered module accept member dispatch');
    }
    return entry;
  }
}

class _Entry {
  _Entry(this.handle, this.instance, this.module);
  final int handle;
  final Object instance;
  final FjsObjectModule? module;
}
