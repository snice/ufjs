// The dev menu's manual reload used to skip the units handshake (spec 074):
// `reloadDev()` passed `units: false` while the WebSocket push path
// re-negotiated, so a units-mode split build came back up with an empty
// `__FJS_MODULES` and the entry's first shared import died with
// `dev unit … is not loaded`. These drive the REAL VM against a fake
// `fjs dev` and pin the manual path to the same negotiation.
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';

import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

/// What `fjs dev`'s split prelude ships: the spec 037 registry, shrunk to
/// the shape this test depends on (define factories, require throws loud).
const _sharedJs = '''
globalThis.__FJS_MODULES = {};
globalThis.__fjsDefineUnit = function (id, factory) {
  globalThis.__FJS_MODULES[id] = { factory: factory };
};
globalThis.__fjsRequireUnit = function (id) {
  const u = globalThis.__FJS_MODULES[id];
  if (!u) throw new Error('[fjs] dev unit "' + id + '" is not loaded');
  if (u.factory) {
    const f = u.factory;
    u.factory = null;
    const m = { exports: {} };
    f(globalThis.__fjsRequireUnit, m, m.exports);
    u.exports = m.exports;
  }
  return u.exports;
};
''';

const _unitsJs = '''
__fjsDefineUnit('src/Shell.vue', function () {
  globalThis.__unitRuns = (globalThis.__unitRuns || 0) + 1;
});
''';

const _bundleJs = '''
globalThis.__entryRuns = (globalThis.__entryRuns || 0) + 1;
__fjsRequireUnit('src/Shell.vue');
console.log('ENTRY ' + globalThis.__entryRuns + ' UNIT ' + globalThis.__unitRuns);
''';

/// Split + units stand-in for `fjs dev`: the four GETs the engine's load
/// path makes, plus the change socket.
class _FakeFjsDev {
  _FakeFjsDev._(this._server);

  final HttpServer _server;

  /// How often the engine asked for the manifest — the units handshake is
  /// one GET per full load, so this is what pins "the manual reload
  /// re-negotiated".
  int manifestHits = 0;

  static Future<_FakeFjsDev> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final fake = _FakeFjsDev._(server);
    server.listen((req) async {
      if (req.uri.path == '/ws' && WebSocketTransformer.isUpgradeRequest(req)) {
        final ws = await WebSocketTransformer.upgrade(req);
        ws.listen((_) {}, onDone: ws.close, onError: (_) {});
        return;
      }
      String? body;
      switch (req.uri.path) {
        case '/manifest.json':
          fake.manifestHits++;
          body = jsonEncode({
            'split': true,
            'units': true,
            'displayName': 'units-fixture',
          });
        case '/shared.js':
          body = _sharedJs;
        case '/units.js':
          body = _unitsJs;
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
    // no dev dylib (or not macOS): nothing to load the VM from
    return;
  }
  ffi.DynamicLibrary.open(lib);

  late _FakeFjsDev server;
  late FjsEngine engine;
  final logs = <String>[];

  setUp(() async {
    HttpOverrides.global =
        null; // flutter_test's fake HttpClient breaks sockets
    server = await _FakeFjsDev.start();
    logs.clear();
    engine = FjsEngine()..onLog = (level, message) => logs.add(message);
  });

  tearDown(() async {
    engine.disconnectDev();
    engine.dispose();
    await server.stop();
  });

  test('a manual reload re-negotiates units and reloads cleanly', () async {
    await engine.connectDev('127.0.0.1', server.port);
    expect(
      logs.where((l) => l == 'ENTRY 1 UNIT 1'),
      hasLength(1),
      reason: 'the connect handshake loaded prelude, units and entry',
    );
    expect(server.manifestHits, 1);

    // the regression itself: pre-074 this threw
    // `dev unit "src/Shell.vue" is not loaded` — the entry was evaluated
    // into a fresh VM whose `/units.js` never came down
    await engine.reloadDev();

    expect(
      server.manifestHits,
      2,
      reason: 'a manual reload re-asks the manifest, like the WS push does',
    );
    expect(
      logs.where((l) => l == 'ENTRY 1 UNIT 1'),
      hasLength(2),
      reason: 'the fresh VM re-ran entry and unit factory from scratch',
    );
  });
}
