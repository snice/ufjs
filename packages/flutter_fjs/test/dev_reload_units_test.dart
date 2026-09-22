// Manual reload (dev menu) and the WebSocket full reload share one load
// path: shared prelude, then the entry. There is no unit bundle (spec 095).
// These drive the real VM against a fake `fjs dev`.
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

const _sharedJs = '''
globalThis.__sharedRuns = (globalThis.__sharedRuns || 0) + 1;
globalThis.__FJS_SHARED = { './src/Shell.vue': { ok: true } };
''';

const _bundleJs = '''
globalThis.__entryRuns = (globalThis.__entryRuns || 0) + 1;
if (!globalThis.__FJS_SHARED['./src/Shell.vue']) {
  throw new Error('shared shell missing');
}
console.log('ENTRY ' + globalThis.__entryRuns + ' SHARED ' + globalThis.__sharedRuns);
''';

class _FakeFjsDev {
  _FakeFjsDev._(this._server);

  final HttpServer _server;
  final List<String> paths = [];

  static Future<_FakeFjsDev> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final fake = _FakeFjsDev._(server);
    server.listen((req) async {
      if (req.uri.path == '/ws' && WebSocketTransformer.isUpgradeRequest(req)) {
        final ws = await WebSocketTransformer.upgrade(req);
        ws.listen((_) {}, onDone: ws.close, onError: (_) {});
        return;
      }
      fake.paths.add(req.uri.path);
      String? body;
      switch (req.uri.path) {
        case '/manifest.json':
          body = jsonEncode({'split': true, 'displayName': 'split-fixture'});
        case '/shared.js':
          body = _sharedJs;
        case '/bundle.js':
          body = _bundleJs;
      }
      if (body == null) {
        req.response.statusCode = HttpStatus.notFound;
        await req.response.close();
        return;
      }
      req.response.write(body);
      await req.response.close();
    });
    return fake;
  }

  int get port => _server.port;

  Future<void> stop() => _server.close(force: true);
}

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
    return;
  }
  ffi.DynamicLibrary.open(lib);

  late _FakeFjsDev server;
  late FjsEngine engine;
  final logs = <String>[];

  setUp(() async {
    HttpOverrides.global = null;
    server = await _FakeFjsDev.start();
    logs.clear();
    engine = FjsEngine()..onLog = (level, message) => logs.add(message);
  });

  tearDown(() async {
    engine.disconnectDev();
    engine.dispose();
    await server.stop();
  });

  test('a manual reload reloads the split build without a unit bundle', () async {
    await engine.connectDev('127.0.0.1', server.port);
    expect(logs.where((l) => l == 'ENTRY 1 SHARED 1'), hasLength(1));

    await engine.reloadDev();

    expect(logs.where((l) => l == 'ENTRY 1 SHARED 1'), hasLength(2));
    expect(server.paths, isNot(contains('/units.js')));
  });
}
