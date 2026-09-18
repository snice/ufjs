// fetch()'s release branch: a root-relative URL with no dev server is a
// bundled asset under assets/fjs/public/ (spec 026; the same rule
// fjsResolveImageSource applies to <image>). The asset channel is mocked
// because a unit test has no bundle.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter_fjs/src/ffi.dart';
import 'package:flutter_fjs/src/http.dart';
import 'package:flutter_fjs/src/registry/host.dart';
import 'package:flutter_test/flutter_test.dart';

class _Events {
  final List<Map<String, Object?>> received = [];

  void dispatch(int id, int type, {String? text}) {
    expect(type, FjsEvent.httpResponse);
    received.add(jsonDecode(text ?? '{}') as Map<String, Object?>);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final assets = <String, Uint8List>{
    'assets/fjs/public/assets/Xbot-D2z3.glb': Uint8List.fromList([1, 2, 3]),
    'assets/fjs/public/data/config.json': Uint8List.fromList(
      utf8.encode('{"a":1}'),
    ),
  };

  late _Events events;
  late FjsHttp http;
  late HostRegistry host;

  setUp(() {
    events = _Events();
    // devUri omitted on purpose: null is the release condition under test.
    http = FjsHttp(dispatchEvent: events.dispatch);
    host = HostRegistry();
    http.register(host);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMessageHandler('flutter/assets', (ByteData? message) async {
          final key = utf8.decode(message!.buffer.asUint8List());
          final bytes = assets[key];
          if (bytes == null) return null;
          return ByteData.sublistView(bytes);
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMessageHandler('flutter/assets', null);
    http.close();
  });

  Future<Map<String, Object?>> fetch(String url) async {
    final id = 1;
    host.invoke('fjs.http.request', [
      id,
      jsonEncode({'url': url}),
    ]);
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(events.received, hasLength(1));
    return events.received.removeLast();
  }

  test('a root-relative URL loads the bundled asset', () async {
    final payload = await fetch('/assets/Xbot-D2z3.glb');
    expect(payload['ok'], true);
    expect(payload['status'], 200);
    expect(payload['bodyBase64'], base64Encode([1, 2, 3]));
    expect(
      (payload['headers'] as Map<String, Object?>)['content-type'],
      'model/gltf-binary',
    );
  });

  test('query strings are stripped before the asset lookup', () async {
    final payload = await fetch('/data/config.json?v=2');
    expect(payload['status'], 200);
    expect(payload['bodyBase64'], isNotNull);
    expect(payload['url'], '/data/config.json?v=2');
  });

  test('a missing asset resolves 404 rather than rejecting', () async {
    final payload = await fetch('/nope.png');
    expect(payload['ok'], true);
    expect(payload['status'], 404);
    expect(payload['bodyBase64'], isNull);
  });

  test('traversal is refused with 404', () async {
    final payload = await fetch('/../secret.txt');
    expect(payload['ok'], true);
    expect(payload['status'], 404);
  });
}
