// FjsHttp — the Dart half of the runtime's fetch().
//
// QuickJS has no sockets, so fetch() in JS hands the request to Dart and
// waits for a response event, over the two channels everything else uses:
//
//   JS                       Dart                            JS
//   fetch(url)  -> invokeHost('fjs.http.request', id, json)
//               <- dispatchEvent(id, 14, responseJson)  -> promise settles
//   controller.abort() -> invokeHost('fjs.http.abort', id)
//
// invokeHost is synchronous (it is the JSI host-function path), so the
// handler only *starts* the request and returns immediately — the engine's
// UI thread is never blocked on the network.
//
// Bodies cross as base64 in both directions: the v1 host ABI carries
// strings, and base64 keeps binary payloads (images, protobufs, gzip that
// the client already inflated) intact rather than mangling them through a
// utf8 round trip.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show FlutterError;
import 'dart:ffi' as ffi;

import 'package:flutter/services.dart' show AssetBundle, rootBundle;
import 'package:ffi/ffi.dart' show malloc;

import 'ffi.dart';
import 'registry/host.dart';
import 'widgets/image.dart' show fjsPublicAssetRoot;

/// Owns the HttpClient and the in-flight requests for one engine.
class FjsHttp {
  FjsHttp({
    required this.dispatchEvent,
    this.devUri,
    this.assetBundle,
    this.vmHandle,
    HttpClient? client,
  }) : _client = client ?? HttpClient();

  /// Delivers the response back into the VM (the engine's dispatchEvent).
  final void Function(int requestId, int eventType, {String? text})
  dispatchEvent;

  /// The dev server a root-relative URL resolves against — the same closure
  /// the canvas host modules get. A browser resolves `/x` against the page
  /// origin (the dev server), so JS fetch of a bundled asset (`import x
  /// from '@/assets/x.glb'`) has to land on the same URL here (spec 023).
  /// No dev server means there is nothing for a relative URL to mean; the
  /// request fails with that message rather than silently.
  final Uri? Function()? devUri;

  /// Where a release build's public/ files are read from — the engine's
  /// [FjsEngine.assetBundle]. Null means the app's own assets.
  final AssetBundle Function()? assetBundle;

  /// The engine's FJSVM handle, for the binary-handle table (spec 038):
  /// response bodies go in once and travel to JS as an int. Null means the
  /// engine is not wired for handles — callers fall back to base64.
  final FJSVMHandle? Function()? vmHandle;

  final HttpClient _client;
  final Map<int, HttpClientRequest> _inFlight = {};
  final Set<int> _aborted = {};
  bool _closed = false;
  int _dartId = 0;

  static final FjsBindings _bind = FjsBindings.instance();

  /// Copies [bytes] into the VM's handle table. Null when there is no VM to
  /// attach to — the payload then carries base64 the old way.
  int? _putBytes(Uint8List bytes) {
    final vm = vmHandle?.call();
    if (vm == null || bytes.isEmpty) return null;
    final p = malloc<ffi.Uint8>(bytes.length);
    try {
      p.asTypedList(bytes.length).setAll(0, bytes);
      return _bind.putHandleBytes(vm, p, bytes.length);
    } finally {
      malloc.free(p);
    }
  }

  /// The inverse: copies a request body out of the table and releases it —
  /// the JS side is done with it the moment it named it in the descriptor.
  Uint8List? _takeBytes(Object? handle) {
    final vm = vmHandle?.call();
    if (vm == null || handle is! num) return null;
    final id = handle.toInt();
    final bytes = _bind.readHandleBytes(vm, id);
    _bind.releaseHandle(vm, id);
    return bytes;
  }

  /// Installs `fjs.http.request` / `fjs.http.abort` on [host].
  void register(HostRegistry host) {
    host
      ..register('fjs.http.request', (args) {
        final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
        final json = args.length > 1 ? args[1]?.toString() ?? '{}' : '{}';
        // fire and forget: the promise settles on the response event
        unawaited(_run(id, json));
        return null;
      })
      ..register('fjs.http.abort', (args) {
        final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
        _aborted.add(id);
        _inFlight.remove(id)?.abort();
        return null;
      });
  }

  /// A one-off request made from Dart — a component module fetching its
  /// own data, say — over the same client (and so the same connection pool
  /// and lifetime) that backs JS `fetch()`. Throws on a transport failure
  /// or a non-2xx status, which is what a caller reading a file it expects
  /// to exist wants; JS `fetch()` keeps its own error shape.
  Future<Uint8List> fetch(
    Uri url, {
    String method = 'GET',
    Map<String, String>? headers,
    List<int>? body,
    Duration? timeout,
  }) {
    if (_closed) throw const HttpException('engine disposed');
    // negative ids: the id space above zero belongs to JS, and these have
    // to be distinct so cancelAll() reaches a Dart request too
    final id = --_dartId;
    var future = _fetch(id, url, method, headers, body);
    if (timeout != null) {
      future = future.timeout(
        timeout,
        onTimeout: () {
          _inFlight.remove(id)?.abort();
          throw TimeoutException(
            'request timed out after ${timeout.inMilliseconds}ms',
          );
        },
      );
    }
    return future;
  }

  Future<Uint8List> _fetch(
    int id,
    Uri url,
    String method,
    Map<String, String>? headers,
    List<int>? body,
  ) async {
    try {
      final (response, bytes) = await _exchange(
        id,
        url,
        method,
        headers: headers,
        body: body,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HttpException('${response.statusCode} for $url');
      }
      return bytes;
    } finally {
      _inFlight.remove(id);
      _aborted.remove(id);
    }
  }

  /// One request, start to finish, for both callers: open, apply headers
  /// and body, read the response. [id] is the name abort() and cancelAll()
  /// know the request by — the JS request id, or a negative one minted by
  /// [fetch].
  Future<(HttpClientResponse, Uint8List)> _exchange(
    int id,
    Uri url,
    String method, {
    Map<String, String>? headers,
    List<int>? body,
    bool followRedirects = true,
  }) async {
    final request = await _client.openUrl(method.toUpperCase(), url);
    // abort() may have landed while the connection was being opened
    if (_aborted.contains(id) || _closed) {
      request.abort();
      throw const _Aborted();
    }
    _inFlight[id] = request;
    request.followRedirects = followRedirects;
    // set(), not add(): JS already joined repeated names, and this must
    // replace the defaults HttpClient fills in (content-type, accept).
    headers?.forEach(request.headers.set);
    if (body != null && body.isNotEmpty) request.add(body);
    final response = await request.close();
    return (response, await _readBody(response));
  }

  Future<void> _run(int id, String requestJson) async {
    try {
      final spec = jsonDecode(requestJson) as Map<String, Object?>;
      final raw = Uri.parse(spec['url']?.toString() ?? '');
      if (!raw.isAbsolute && devUri?.call() == null) {
        // Release (or pre-dev-connection): a root-relative path is a bundled
        // asset — the same rule <image> applies (fjsResolveImageSource), so
        // one URL works for both tags. Fetch semantics: a missing file is a
        // resolved 404, not a rejected promise.
        _deliver(id, await _releaseAssetResponse(raw));
        return;
      }
      final url = raw.isAbsolute ? raw : _resolveRelative(raw);
      final method = (spec['method']?.toString() ?? 'GET').toUpperCase();
      final timeoutMs = (spec['timeoutMs'] as num?)?.toInt();

      var future = _send(id, url, method, spec);
      if (timeoutMs != null && timeoutMs > 0) {
        future = future.timeout(
          Duration(milliseconds: timeoutMs),
          onTimeout: () {
            _inFlight.remove(id)?.abort();
            throw TimeoutException('request timed out after ${timeoutMs}ms');
          },
        );
      }
      final payload = await future;
      _deliver(id, payload);
    } catch (e) {
      _deliver(id, {'ok': false, 'error': _message(e)});
    } finally {
      _inFlight.remove(id);
      _aborted.remove(id);
    }
  }

  Future<Map<String, Object?>> _send(
    int id,
    Uri url,
    String method,
    Map<String, Object?> spec,
  ) async {
    // the body arrives either as a handle into the VM's byte table (spec
    // 038) or — an older runtime — as base64 in the descriptor
    var bodyBytes = _takeBytes(spec['bodyHandle']);
    final bodyBase64 = spec['bodyBase64']?.toString();
    if (bodyBytes == null) {
      bodyBytes = bodyBase64 == null || bodyBase64.isEmpty
          ? null
          : base64Decode(bodyBase64);
    }
    final rawHeaders = spec['headers'];
    final (response, bytes) = await _exchange(
      id,
      url,
      method,
      headers: rawHeaders is Map
          ? {
              for (final entry in rawHeaders.entries)
                entry.key.toString(): entry.value.toString(),
            }
          : null,
      body: bodyBytes,
      followRedirects: spec['followRedirects'] != false,
    );

    final outHeaders = <String, String>{};
    response.headers.forEach((name, values) {
      outHeaders[name] = values.join(', ');
    });

    // the body crosses as a handle when the engine can take one; base64
    // stays for the no-VM edge (and is what an older runtime expects)
    final handle = _putBytes(bytes);
    return {
      'ok': true,
      'status': response.statusCode,
      'statusText': response.reasonPhrase,
      // after redirects this is where the body actually came from
      'url':
          (response.redirects.isNotEmpty
                  ? response.redirects.last.location
                  : url)
              .toString(),
      'redirected': response.redirects.isNotEmpty,
      'headers': outHeaders,
      if (handle != null)
        'handle': handle
      else
        'bodyBase64': bytes.isEmpty ? null : base64Encode(bytes),
    };
  }

  /// One pre-sized buffer instead of the intermediate copies `expand()`
  /// would make on a large body.
  Future<Uint8List> _readBody(HttpClientResponse response) async {
    final chunks = <List<int>>[];
    var total = 0;
    await for (final chunk in response) {
      chunks.add(chunk);
      total += chunk.length;
    }
    final out = Uint8List(total);
    var offset = 0;
    for (final chunk in chunks) {
      out.setRange(offset, offset + chunk.length, chunk);
      offset += chunk.length;
    }
    return out;
  }

  void _deliver(int id, Map<String, Object?> payload) {
    // an aborted request already rejected its promise in JS
    if (_closed || _aborted.remove(id)) return;
    dispatchEvent(id, FjsEvent.httpResponse, text: jsonEncode(payload));
  }

  String _message(Object e) {
    if (e is _Aborted) return 'request aborted';
    if (e is SocketException) {
      return 'network error: ${e.message}${e.osError != null ? ' (${e.osError!.message})' : ''}';
    }
    if (e is HttpException) return 'http error: ${e.message}';
    if (e is TimeoutException) return e.message ?? 'request timed out';
    if (e is FormatException) return 'bad request or URL: ${e.message}';
    return e.toString();
  }

  Uri _resolveRelative(Uri raw) {
    final base = devUri?.call();
    if (base == null) {
      // Unreachable today: _run routes the no-dev-server case to
      // _releaseAssetResponse before it gets here. Kept defensive in case a
      // caller races a dev disconnect between the two checks.
      throw FormatException(
        'relative fetch URL "$raw" needs a dev server connection to '
        'resolve against',
      );
    }
    return base.resolve(raw.toString());
  }

  /// Answers a root-relative fetch from the release bundle. `public/` and
  /// the bundler's emitted `/assets/*` both land under
  /// `assets/fjs/public/` (build.ts syncPublicAssets), keyed by the same
  /// root path the browser uses.
  Future<Map<String, Object?>> _releaseAssetResponse(Uri raw) async {
    // Query strings and fragments have no meaning for an asset key; strip
    // them so `?v=2` cache busting from the web build survives the port.
    final path = raw.path.replaceFirst(RegExp(r'^/+'), '');
    if (path.isEmpty || path.split('/').contains('..')) {
      return {'ok': true, 'status': 404, 'statusText': 'Not Found'};
    }
    try {
      final data = await (assetBundle?.call() ?? rootBundle)
          .load('$fjsPublicAssetRoot/$path');
      final bytes = data.buffer.asUint8List(
        data.offsetInBytes,
        data.lengthInBytes,
      );
      final handle = _putBytes(bytes);
      return {
        'ok': true,
        'status': 200,
        'statusText': 'OK',
        'url': raw.toString(),
        'redirected': false,
        'headers': {'content-type': _assetContentType(path)},
        if (handle != null)
          'handle': handle
        else
          'bodyBase64': base64Encode(bytes),
      };
    } on FlutterError {
      return {'ok': true, 'status': 404, 'statusText': 'Not Found'};
    }
  }

  String _assetContentType(String path) {
    final dot = path.lastIndexOf('.');
    final ext = dot < 0 ? '' : path.substring(dot + 1).toLowerCase();
    return switch (ext) {
      'json' => 'application/json',
      'js' || 'mjs' => 'text/javascript',
      'css' => 'text/css',
      'html' => 'text/html',
      'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      'svg' => 'image/svg+xml',
      'glb' => 'model/gltf-binary',
      'gltf' => 'model/gltf+json',
      'wasm' => 'application/wasm',
      _ => 'application/octet-stream',
    };
  }

  /// Drops the in-flight JS requests. Used on VM reset (hot reload): the
  /// promises waiting on them died with the old VM, and their ids mean
  /// nothing to the new one. Dart-side [fetch] requests — the dev bundle
  /// among them — are nobody's promise and survive a reload; [close] is
  /// what takes those.
  void cancelAll() => _abort((id) => id > 0);

  void _abort(bool Function(int id) match) {
    for (final id in _inFlight.keys.toList()) {
      if (!match(id)) continue;
      _aborted.add(id);
      _inFlight.remove(id)?.abort();
    }
  }

  /// Aborts everything in flight and closes the client.
  void close() {
    if (_closed) return;
    _closed = true;
    _abort((_) => true);
    _aborted.clear();
    _client.close(force: true);
  }
}

class _Aborted implements Exception {
  const _Aborted();
  // a Dart fetch() surfaces this to its caller, so it has to read
  @override
  String toString() => 'request aborted';
}
