// The dev socket is the whole of hot reload in `fjs go`: if it dies quietly
// — `fjs dev` restarted, wifi blinked, the device slept — HTTP keeps working
// and the session looks connected while never reloading again. These cover
// the push and the reconnect that follows a drop.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_fjs/src/dev_client.dart';
import 'package:flutter_fjs/src/http.dart';
import 'package:flutter_test/flutter_test.dart';

/// A minimal stand-in for `fjs dev`: /ws upgrades, everything else 404s.
class FakeDevServer {
  FakeDevServer._(this._server);

  final HttpServer _server;
  final List<WebSocket> sockets = [];

  /// Everything the client sent us — `fjs log` reads these off the server.
  final List<String> received = [];

  static Future<FakeDevServer> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final fake = FakeDevServer._(server);
    server.listen((req) async {
      if (req.uri.path == '/ws' && WebSocketTransformer.isUpgradeRequest(req)) {
        final ws = await WebSocketTransformer.upgrade(req);
        fake.sockets.add(ws);
        ws.listen((data) => fake.received.add(data.toString()));
        return;
      }
      if (req.uri.path == '/bundle.js') {
        req.response.write('console.log(1)');
        await req.response.close();
        return;
      }
      req.response.statusCode = HttpStatus.notFound;
      await req.response.close();
    });
    return fake;
  }

  int get port => _server.port;

  void push(String message) {
    for (final ws in sockets) {
      ws.add(message);
    }
  }

  /// Drops every live socket, the way a `fjs dev` restart does.
  Future<void> dropSockets() async {
    final live = [...sockets];
    sockets.clear();
    for (final ws in live) {
      await ws.close();
    }
  }

  Future<void> stop() => _server.close(force: true);
}

/// Polls until [ready], so the test does not hard-code socket timing.
Future<void> waitFor(
  bool Function() ready, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!ready()) {
    if (DateTime.now().isAfter(deadline)) return;
    await Future<void>.delayed(const Duration(milliseconds: 25));
  }
}

void main() {
  late FakeDevServer server;
  late DevClient client;
  // the engine's HTTP, standing on its own: DevClient borrows it rather
  // than opening a second client to the same dev server
  late FjsHttp http;
  late List<String> logs;
  var reloads = 0;
  DevReload? lastReload;

  setUp(() async {
    HttpOverrides.global =
        null; // flutter_test's fake HttpClient breaks sockets
    server = await FakeDevServer.start();
    http = FjsHttp(dispatchEvent: (_, __, {String? text}) {});
    logs = [];
    reloads = 0;
    lastReload = null;
    client =
        DevClient(
            '127.0.0.1',
            server.port,
            fetchUrl: http.fetch,
            onLog: logs.add,
          )
          ..onReload = (reload) async {
            reloads++;
            lastReload = reload;
          };
  });

  tearDown(() async {
    client.close();
    http.close();
    await server.stop();
  });

  test('a reload push reaches onReload', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    server.push('reload');
    await waitFor(() => reloads > 0);
    expect(reloads, 1);
    expect(lastReload, isNotNull);
    expect(
      lastReload!.isFull,
      isTrue,
      reason: 'a bare reload means "everything"',
    );
  });

  test('a page-scoped push names the chunks that changed', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    server.push('reload pages:about,comp-swiper');
    await waitFor(() => reloads > 0);
    expect(lastReload!.pages, ['about', 'comp-swiper']);
    expect(lastReload!.isFull, isFalse);
  });

  test('a retired unit hot-swap push is a full reload', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    server.push(
      'reload units:src/utils/format.ts,src/components/panel.vue'
      ' pages:about,index',
    );
    await waitFor(() => reloads > 0);
    expect(lastReload!.isFull, isTrue);
    expect(lastReload!.pages, isEmpty);
  });

  test('an unrecognized reload variant parses as a full reload', () async {
    // a newer server talking to an older app: reload-everything is always
    // correct, ignoring the push would leave the VM stale (constitution V)
    expect(DevClient.parseReload('reload zoomies:a,b').isFull, isTrue);
    expect(DevClient.parseReload('reload units pages:x').isFull, isTrue);
  });

  test('the bundle comes down the engine\'s own HTTP client', () async {
    expect(utf8.decode(await client.fetchBundle()), 'console.log(1)');
    expect(logs.single, contains('GET /bundle.js'));
  });

  test('a missing path fails with the status, and says which path', () async {
    await expectLater(client.fetch('/nope.js'), throwsA(isA<HttpException>()));
    expect(logs.single, contains('GET /nope.js failed'));
  });

  test('parseReload parses the wire forms', () {
    expect(DevClient.parseReload('reload').isFull, isTrue);
    expect(DevClient.parseReload('reload pages:').isFull, isTrue);
    expect(DevClient.parseReload('reload pages:index').pages, ['index']);
    expect(DevClient.parseReload('reload pages:a,b,c').pages, ['a', 'b', 'c']);
    expect(
      DevClient.parseReload('reload units:src/a.ts,src/b.vue pages:index').isFull,
      isTrue,
    );
    expect(DevClient.parseReload('reload units:src/a.ts').isFull, isTrue);
  });

  test('an eval push splits into id and source', () async {
    String? evalId;
    String? evalSource;
    client.onEval = (id, source) {
      evalId = id;
      evalSource = source;
    };
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    // the source has spaces of its own: only the first one separates the id
    server.push('eval a1b2c3 console.log(1 + 1)');
    await waitFor(() => evalId != null);
    expect(evalId, 'a1b2c3');
    expect(evalSource, 'console.log(1 + 1)');
    expect(reloads, 0, reason: 'an eval is not a reload');
  });

  test('console lines go up the socket for fjs log', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    client.sendLog(3, 'boom');
    await waitFor(
      () => server.received.any((raw) => raw.contains('"fjs":"log"')),
    );
    // listen() also sends the app hello; the log is the payload this checks
    final log = server.received
        .map((raw) => jsonDecode(raw) as Map<String, Object?>)
        .singleWhere((msg) => msg['fjs'] == 'log');
    expect(log, {'fjs': 'log', 'level': 3, 'text': 'boom'});
  });

  test('sendLog on a closed client is a no-op, not a crash', () {
    expect(() => client.sendLog(1, 'nobody is listening'), returnsNormally);
  });

  test('a dropped socket reconnects and reloads once back', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);

    await server.dropSockets();
    await waitFor(() => server.sockets.isNotEmpty); // the retry timer's connect
    expect(server.sockets, isNotEmpty, reason: 'client did not reconnect');
    // an edit during the outage is not replayed, so reconnecting reloads
    await waitFor(() => reloads > 0);
    expect(reloads, 1);
    expect(
      lastReload!.isFull,
      isTrue,
      reason: 'a reconnect cannot know what changed',
    );

    // and the fresh socket carries pushes like the first one did
    server.push('reload');
    await waitFor(() => reloads > 1);
    expect(reloads, 2);
  });

  test('close stops the reconnect loop', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    await server.dropSockets();
    client.close();
    await Future<void>.delayed(const Duration(seconds: 3));
    expect(server.sockets, isEmpty, reason: 'closed client kept reconnecting');
    expect(reloads, 0);
  });

  test('a first connect that fails is the caller\'s to report', () async {
    await server.stop();
    await expectLater(client.listen(), throwsA(isA<SocketException>()));
  });

  // --- bootstrap backoff (spec 030) ---------------------------------------
  //
  // The bootstrap is the one fetch that must not give up: on iOS the first
  // outbound request raises a permission sheet, and the sheet is asynchronous
  // — the request that raised it has ALREADY failed by the time the user can
  // answer. One attempt can therefore never succeed on a fresh install.

  test('bootstrap retries while the server cannot be reached', () async {
    var attempts = 0;
    final retrying = DevClient(
      '127.0.0.1',
      server.port,
      fetchUrl: (url) async {
        attempts++;
        if (attempts < 3) {
          throw const SocketException('No route to host');
        }
        return Uint8List.fromList(utf8.encode('ok'));
      },
      onLog: logs.add,
    );
    addTearDown(retrying.close);

    final bytes = await retrying.fetchForBootstrap('/bundle.js');

    expect(utf8.decode(bytes), 'ok');
    expect(attempts, 3);
    // and it says so out loud — a bootstrap that spins in silence looks
    // exactly like one that hung (constitution V)
    expect(logs.where((l) => l.contains('retrying in')), hasLength(2));
  });

  test('bootstrap does NOT retry an answer from the server', () async {
    // A 404 is how an older `fjs dev` says it has no /manifest.json, and
    // fetchManifest falls back to null on it. Retrying that forever would
    // hang the app on exactly the servers the fallback exists for.
    var attempts = 0;
    final answering = DevClient(
      '127.0.0.1',
      server.port,
      fetchUrl: (url) async {
        attempts++;
        throw const HttpException('404 for /manifest.json');
      },
      onLog: logs.add,
    );
    addTearDown(answering.close);

    await expectLater(
      answering.fetchForBootstrap('/manifest.json'),
      throwsA(isA<HttpException>()),
    );
    expect(attempts, 1);
  });

  test('fetchManifest still falls back to null on an older server', () async {
    // the fake server 404s everything except /bundle.js and /ws
    expect(await client.fetchManifest(), isNull);
  });
}
