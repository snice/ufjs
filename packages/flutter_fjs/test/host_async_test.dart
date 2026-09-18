// invokeHostAsync end to end: JS initiates through the sync invokeHost
// channel, a Dart async handler settles later, and the result re-enters the
// same VM as a dispatchEvent. The JS side is written against the raw
// host/event channels (host-async.ts is what wraps them in a promise), so
// no built runtime bundle is needed — same setup as http_engine_test.dart.
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

const _jsProgram = r'''
globalThis.__fjsDispatchEvent = function (id, type, payload) {
  console.log('EVENT ' + id + ' ' + type + ' ' + payload);
};
globalThis.callAsync = function (id, name, argsJson) {
  __fjs.fns.invokeHost('fjs.async.invoke', id, name, argsJson);
};
''';

String? _libPath() {
  var dir = Directory.current;
  for (var i = 0; i < 6; i++) {
    final candidate = File(
      '${dir.path}/packages/flutter_fjs/native/build-native/libfjs.dylib',
    );
    if (candidate.existsSync()) return candidate.path;
    final local = File('${dir.path}/native/build-native/libfjs.dylib');
    if (local.existsSync()) return local.path;
    dir = dir.parent;
  }
  return null;
}

void main() {
  final lib = _libPath();
  if (lib == null || !Platform.isMacOS) {
    // no dev dylib (or not macOS): nothing to load the VM from
    return;
  }
  ffi.DynamicLibrary.open(lib);

  late FjsEngine engine;
  final logs = <String>[];

  setUp(() {
    logs.clear();
    engine = FjsEngine()..onLog = (level, message) => logs.add(message);
    engine.runSource(_jsProgram, filename: 'async-test.js');
  });

  tearDown(() => engine.dispose());

  /// Runs `callAsync(id, name, argsJson)` and waits for ITS settlement event
  /// (matched by id — with concurrent calls in flight, other settlements may
  /// land first). Returns the RAW payload string: field order is part of the
  /// channel's contract, so it is asserted on the text itself.
  Future<String> _settlement(String id, String name, String argsJson) async {
    final before = logs.length;
    engine.runSource(
      "callAsync($id, '$name', '$argsJson')",
      filename: 'call.js',
    );
    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (DateTime.now().isBefore(deadline)) {
      for (var i = before; i < logs.length; i++) {
        final parts = logs[i].split(' ');
        if (parts[0] != 'EVENT' || parts[1] != id) continue;
        expect(parts[2], '32'); // FjsEvent.asyncResult
        return parts.sublist(3).join(' ');
      }
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    fail('no settlement event reached the VM for call $id');
  }

  test(
    'an async handler settles back into the VM with the decoded args',
    () async {
      List<Object?>? receivedArgs;
      engine.host.registerAsync('test.profile', (args) async {
        receivedArgs = args;
        await Future<void>.delayed(const Duration(milliseconds: 30));
        return <String, Object?>{'name': 'zt', 'age': 42};
      });

      final payload = await _settlement('7', 'test.profile', '[42,"full"]');
      expect(
        receivedArgs,
        [42, 'full'],
        reason:
            'the args array crossed as one JSON string and came back decoded',
      );
      expect(
        payload,
        startsWith('{"ok":true,"value":'),
        reason: 'field order is fixed: ok first',
      );
      expect(jsonDecode(payload), {
        'ok': true,
        'value': {'name': 'zt', 'age': 42},
      });
    },
  );

  test(
    'an unregistered name fails immediately instead of hanging the promise',
    () async {
      final payload = await _settlement('8', 'test.missing', '[]');
      final wire = jsonDecode(payload) as Map<String, Object?>;
      expect(wire['ok'], isFalse);
      expect(wire['errMsg'], contains('test.missing'));
      expect(wire['errMsg'], contains('not registered'));
    },
  );

  test('a handler that throws settles as an error payload', () async {
    engine.host.registerAsync('test.boom', (args) async {
      throw StateError('kaboom');
    });
    final payload = await _settlement('9', 'test.boom', '[]');
    final wire = jsonDecode(payload) as Map<String, Object?>;
    expect(wire['ok'], isFalse);
    expect(wire['errMsg'], contains('kaboom'));
  });

  test('a null return resolves as null, not an omitted value', () async {
    engine.host.registerAsync('test.null', (args) async => null);
    final payload = await _settlement('10', 'test.null', '[]');
    expect(jsonDecode(payload), {'ok': true, 'value': null});
  });

  test(
    'a non-JSON-encodable return value is an error payload, not a dropped result',
    () async {
      engine.host.registerAsync('test.opaque', (args) async => DateTime.now());
      final payload = await _settlement('11', 'test.opaque', '[]');
      final wire = jsonDecode(payload) as Map<String, Object?>;
      expect(wire['ok'], isFalse);
      expect(wire['errMsg'], contains('JSON-encodable'));
    },
  );

  test('concurrent calls settle independently', () async {
    engine.host.registerAsync('test.slow', (args) async {
      await Future<void>.delayed(
        Duration(milliseconds: 40 * ((args[0] as int) + 1)),
      );
      return args[0];
    });
    final results = await Future.wait([
      _settlement('20', 'test.slow', '[0]'),
      _settlement('21', 'test.slow', '[1]'),
      _settlement('22', 'test.slow', '[2]'),
    ]);
    expect(results.map((p) => jsonDecode(p)['value']).toList(), [0, 1, 2]);
  });
}
