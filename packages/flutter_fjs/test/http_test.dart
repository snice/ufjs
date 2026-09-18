// FjsHttp against a real loopback server: the Dart half of fetch(). The JS
// half is exercised by packages/fjs-runtime/test/fetch.test.ts; what matters
// here is that the request goes out as specified and that exactly one
// response event comes back per request.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_fjs/src/ffi.dart';
import 'package:flutter_fjs/src/http.dart';
import 'package:flutter_fjs/src/registry/host.dart';
import 'package:flutter_test/flutter_test.dart';

class _Events {
  final List<Map<String, Object?>> received = [];
  final _waiters = <int, Completer<Map<String, Object?>>>{};

  void dispatch(int id, int type, {String? text}) {
    expect(type, FjsEvent.httpResponse);
    final payload = jsonDecode(text ?? '{}') as Map<String, Object?>;
    received.add(payload);
    _waiters.remove(id)?.complete(payload);
  }

  Future<Map<String, Object?>> waitFor(int id) {
    return (_waiters[id] ??= Completer<Map<String, Object?>>()).future;
  }
}

void main() {
  late HttpServer server;
  late String origin;
  late _Events events;
  late FjsHttp http;
  late HostRegistry host;
  late List<HttpRequest> seen;

  setUp(() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    origin = 'http://127.0.0.1:${server.port}';
    seen = [];
    server.listen((request) async {
      seen.add(request);
      switch (request.uri.path) {
        case '/echo':
          final body = await utf8.decoder.bind(request).join();
          request.response
            ..statusCode = 200
            ..headers.contentType = ContentType.json
            ..write(jsonEncode({'method': request.method, 'body': body}));
          break;
        case '/bytes':
          request.response
            ..statusCode = 200
            ..headers.contentType = ContentType.binary
            ..add([0, 1, 2, 250, 255]);
          break;
        case '/slow':
          await Future<void>.delayed(const Duration(seconds: 5));
          request.response.write('too late');
          break;
        default:
          request.response
            ..statusCode = 404
            ..write('not found');
      }
      await request.response.close();
    });

    events = _Events();
    http = FjsHttp(dispatchEvent: events.dispatch);
    host = HostRegistry();
    http.register(host);
  });

  tearDown(() async {
    http.close();
    await server.close(force: true);
  });

  void request(int id, Map<String, Object?> spec) {
    host.invoke('fjs.http.request', [id, jsonEncode(spec)]);
  }

  test('sends method, headers and body, and reports the response', () async {
    request(1, {
      'url': '$origin/echo',
      'method': 'POST',
      'headers': {'X-Token': 'abc', 'Content-Type': 'text/plain'},
      'bodyBase64': base64Encode(utf8.encode('hello')),
    });

    final res = await events.waitFor(1);
    expect(res['ok'], isTrue);
    expect(res['status'], 200);
    expect(seen.single.headers.value('x-token'), 'abc');
    expect(seen.single.headers.contentType?.mimeType, 'text/plain');
    expect(
      (res['headers']! as Map)['content-type'],
      startsWith('application/json'),
    );
    final body = jsonDecode(
      utf8.decode(base64Decode(res['bodyBase64']! as String)),
    );
    expect(body, {'method': 'POST', 'body': 'hello'});
  });

  test('reports 404 as a normal response, not an error', () async {
    request(2, {'url': '$origin/nope', 'method': 'GET'});
    final res = await events.waitFor(2);
    expect(res['ok'], isTrue);
    expect(res['status'], 404);
    expect(
      utf8.decode(base64Decode(res['bodyBase64']! as String)),
      'not found',
    );
  });

  test('carries binary bodies through base64 intact', () async {
    request(3, {'url': '$origin/bytes', 'method': 'GET'});
    final res = await events.waitFor(3);
    expect(base64Decode(res['bodyBase64']! as String), [0, 1, 2, 250, 255]);
  });

  test('reports a transport failure as ok:false', () async {
    request(4, {'url': 'http://127.0.0.1:1/none', 'method': 'GET'});
    final res = await events.waitFor(4);
    expect(res['ok'], isFalse);
    expect(res['error'], contains('network error'));
  });

  test('times out and delivers one failure event', () async {
    request(5, {'url': '$origin/slow', 'method': 'GET', 'timeoutMs': 100});
    final res = await events.waitFor(5);
    expect(res['ok'], isFalse);
    expect(res['error'], contains('timed out'));
  });

  test('an aborted request delivers no event at all', () async {
    request(6, {'url': '$origin/slow', 'method': 'GET'});
    // let openUrl() register the request before aborting it
    await Future<void>.delayed(const Duration(milliseconds: 50));
    host.invoke('fjs.http.abort', [6]);
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(events.received, isEmpty);
  });
}
