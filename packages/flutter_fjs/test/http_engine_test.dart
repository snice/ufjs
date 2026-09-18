// fetch through the whole stack: JS in the VM asks the host for a request,
// Dart performs it against a loopback server, and the response comes back
// into the same VM as a dispatchEvent. The JS side here is written against
// the raw host/event channels so the test needs no built fjs-runtime bundle
// (net/fetch.ts is what wraps these two calls in a promise).
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

const _jsProgram = r'''
globalThis.__fjsDispatchEvent = function (id, type, payload) {
  const wire = JSON.parse(payload);
  // spec 038: the body arrives as a handle into the VM's byte table —
  // read it through the natives and release, exactly what net/fetch.ts does
  let body = null;
  if (wire.handle != null) {
    body = Array.from(new Uint8Array(__fjs.fns.readHandleBytes(wire.handle)));
    __fjs.fns.releaseHandle(wire.handle);
  }
  console.log('EVENT ' + id + ' ' + type + ' ' + JSON.stringify({ status: wire.status, body: body }));
};
globalThis.get = function (url) {
  __fjs.fns.invokeHost(
    'fjs.http.request',
    7,
    JSON.stringify({ url: url, method: 'GET' }),
  );
};
globalThis.post = function (url, bytes) {
  const handle = __fjs.fns.handleBytes(bytes);
  __fjs.fns.invokeHost(
    'fjs.http.request',
    9,
    JSON.stringify({ url: url, method: 'POST', bodyHandle: handle }),
  );
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
  late HttpServer server;
  late String origin;
  final logs = <String>[];

  setUp(() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    origin = 'http://127.0.0.1:${server.port}';
    server.listen((request) async {
      request.response
        ..statusCode = 201
        ..headers.contentType = ContentType.json
        ..write('{"ok":true}');
      await request.response.close();
    });

    logs.clear();
    engine = FjsEngine()..onLog = (level, message) => logs.add(message);
    engine.runSource(_jsProgram, filename: 'http-test.js');
  });

  tearDown(() async {
    engine.dispose();
    await server.close(force: true);
  });

  test('a host request lands back in the VM as an event', () async {
    engine.runSource("get('$origin/thing')", filename: 'call.js');

    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (logs.isEmpty && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }

    expect(logs, isNotEmpty, reason: 'no response event reached the VM');
    final parts = logs.single.split(' ');
    expect(parts[0], 'EVENT');
    expect(parts[1], '7'); // the request id JS allocated
    expect(parts[2], '14'); // FjsEvent.httpResponse
    final payload =
        jsonDecode(parts.sublist(3).join(' ')) as Map<String, Object?>;
    expect(payload['ok'] ?? true, isTrue);
    expect(payload['status'], 201);
    // spec 038: the body crossed as a handle; the JS side read it back
    expect(payload['body'], '{"ok":true}'.codeUnits);
  });

  test('a request body travels in as a handle and reaches the server', () async {
    List<int>? received;
    // a second server that captures the request body
    final echo = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(echo.close);
    echo.listen((request) async {
      final chunks = await request.fold<List<int>>(
        <int>[],
        (all, chunk) => all..addAll(chunk),
      );
      received = chunks;
      request.response.statusCode = 200;
      await request.response.close();
    });

    engine.runSource(
      "post('http://127.0.0.1:${echo.port}/upload', new Uint8Array([1, 2, 3, 250]))",
      filename: 'call2.js',
    );
    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (received == null && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(
      received,
      [1, 2, 3, 250],
      reason: 'the request body crossed as a handle and Dart read it out',
    );
  });
}
