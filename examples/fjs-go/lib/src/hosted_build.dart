// Runs a release build served from a plain web server — the showcase, or
// any `fjs build` output copied to static hosting — instead of `fjs dev`.
//
// Same loading sequence a generated host runs from its Flutter assets
// (shared prelude → app bundle, page chunks on demand), with the network
// in place of rootBundle. The manifest names files by their asset path
// (`assets/fjs/pages/about.fjsbundle`); on the web server the build
// directory is the site root, so that prefix is dropped.
//
// Bytecode is locked to the engine that compiled it: a hosted build only
// runs in an fjs go built from the same engine version, and a mismatch
// surfaces as the engine's own error from runBundle.
import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_fjs/flutter_fjs.dart';

import 'dev_server.dart';

/// The release build's asset keys (`assets/fjs/public/x.png`,
/// `assets/fjs/modules/iconmind/icons.json`), read from the web server the
/// build is hosted on. Installed as [FjsEngine.assetBundle] so `<image>`,
/// relative fetch() and module data find their files there instead of in
/// fjs go's own assets. Any other key (the asset manifest AssetImage looks
/// variants up in) is still the app's.
class HostedAssetBundle extends CachingAssetBundle {
  HostedAssetBundle(this.origin);

  final Uri origin;
  final HttpClient _client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 15);

  static const _prefix = 'assets/fjs/';

  @override
  Future<ByteData> load(String key) async {
    if (!key.startsWith(_prefix)) return rootBundle.load(key);
    final url = origin.resolve(key.substring(_prefix.length));
    final bytes = await _download(_client, url);
    // FlutterError is what rootBundle throws for a missing key, and what
    // AssetImage / fetch()'s 404 path expect
    if (bytes == null) throw FlutterError('hosted asset $url: not found');
    return ByteData.sublistView(bytes);
  }
}

/// GET [url]; null for a non-200 answer, throws on transport failure.
Future<Uint8List?> _download(HttpClient client, Uri url) async {
  final request = await client.getUrl(url);
  final response = await request.close();
  if (response.statusCode != HttpStatus.ok) {
    await response.drain<void>();
    return null;
  }
  return consolidateHttpClientResponseBytes(response);
}

class HostedBuild {
  HostedBuild(this.engine, this.server, this.manifest);

  final FjsEngine engine;
  final DevServer server;

  /// Replaced on a manual reload: its hashes are what says a file changed.
  DevManifest manifest;

  static const _assetPrefix = 'assets/fjs/';

  Uri _url(String? assetPath, String fallback) {
    var path = assetPath ?? '$_assetPrefix$fallback';
    if (path.startsWith(_assetPrefix)) path = path.substring(_assetPrefix.length);
    return server.origin.resolve(path);
  }

  /// Its own client, not the engine's: [FjsEngine.reset] cancels every
  /// request on the engine's, and the chunk prefetch must outlive the reset
  /// that starts the program.
  final HttpClient _client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 15);

  /// Copies of runtime files shipped inside fjs go, by URL. Used only
  /// while the manifest's hash matches their content; a redeployed
  /// showcase simply downloads the new file.
  static const _seeds = {
    'https://fjs-showcase.zhuzhe.dev/shared.fjsbundle.gz':
        'assets/shared.fjsbundle.gz',
  };

  /// On-device copies of runtime files, next to recents (plugin-free, and
  /// a purged cache costs one download).
  File _cacheFile(Uri url) => File(
        '${Directory.systemTemp.path}/fjs_go_hosted/${url.host}'
        '${url.path.replaceAll('/', '__')}',
      );

  Future<(Uint8List, String)?> _local(Uri url) async {
    try {
      final file = _cacheFile(url);
      final tag = File('${file.path}.etag');
      if (await file.exists() && await tag.exists()) {
        return (await file.readAsBytes(), await tag.readAsString());
      }
    } catch (_) {
      // unreadable cache: go to the network
    }
    return null;
  }

  Future<void> _store(Uri url, Uint8List bytes, String etag) async {
    try {
      final file = _cacheFile(url);
      await file.parent.create(recursive: true);
      await file.writeAsBytes(bytes, flush: true);
      await File('${file.path}.etag').writeAsString(etag);
    } catch (_) {
      // read-only or full storage: next launch downloads again
    }
  }

  /// For builds whose manifest carries no hashes: a runtime file, from the
  /// on-device copy when the server confirms (304) it is current. One round
  /// trip with no body, instead of the whole file.
  Future<Uint8List> _revalidated(Uri url) async {
    final local = await _local(url);
    final request = await _client.getUrl(url);
    if (local != null) {
      request.headers.set(HttpHeaders.ifNoneMatchHeader, local.$2);
    }
    final response = await request.close();
    if (response.statusCode == HttpStatus.notModified && local != null) {
      await response.drain<void>();
      engine.onLog?.call(1, '[hosted] ${url.path} unchanged — local copy');
      return local.$1;
    }
    if (response.statusCode != HttpStatus.ok) {
      await response.drain<void>();
      throw HttpException('HTTP ${response.statusCode}', uri: url);
    }
    final bytes = await consolidateHttpClientResponseBytes(response);
    final etag = response.headers.value(HttpHeaders.etagHeader);
    if (etag != null) unawaited(_store(url, bytes, etag));
    return bytes;
  }

  static String _sha(Uint8List bytes) =>
      sha256.convert(bytes).toString().substring(0, 16);

  File _hashFile(String hash) => File(
        '${Directory.systemTemp.path}/fjs_go_hosted/${server.host}/by-hash/$hash',
      );

  /// A program file the manifest names by [manifestPath]. With a hash in
  /// the manifest this is content-addressed: a copy on the device (or the
  /// seed shipped inside fjs go) whose hash matches is used without a
  /// request at all, so an unchanged showcase costs just the manifest.
  /// Without one (an older build) it falls back to [fallback].
  Future<Uint8List> _program(
    String? manifestPath,
    String defaultPath,
    Future<Uint8List> Function(Uri url) fallback,
  ) async {
    final url = _url(manifestPath, defaultPath);
    final hash = manifestPath == null ? null : manifest.hashes[manifestPath];
    if (hash == null) return fallback(url);
    try {
      final file = _hashFile(hash);
      if (await file.exists()) return await file.readAsBytes();
    } catch (_) {
      // unreadable cache entry: download it again
    }
    final seed = _seeds[url.toString()];
    if (seed != null) {
      try {
        final bytes = Uint8List.sublistView(await rootBundle.load(seed));
        if (_sha(bytes) == hash) return bytes;
      } catch (_) {
        // no seed in this build
      }
    }
    final bytes = await _get(url);
    if (_sha(bytes) == hash) {
      unawaited(_storeByHash(hash, bytes));
    } else {
      // served bytes and manifest disagree (a deploy in progress, a stale
      // edge cache): run what arrived, but never file it under this hash
      engine.onLog?.call(2, '[hosted] ${url.path}: content does not match manifest hash');
    }
    return bytes;
  }

  Future<void> _storeByHash(String hash, Uint8List bytes) async {
    try {
      final file = _hashFile(hash);
      await file.parent.create(recursive: true);
      // write-then-rename: a half-written file must never pass for a hit
      final tmp = File('${file.path}.tmp');
      await tmp.writeAsBytes(bytes, flush: true);
      await tmp.rename(file.path);
    } catch (_) {
      // read-only or full storage: next launch downloads again
    }
  }

  /// Drops cached files no current manifest entry refers to, so every
  /// redeploy does not leave the previous build behind on the device.
  Future<void> _pruneByHash() async {
    try {
      final dir = _hashFile('x').parent;
      if (!await dir.exists()) return;
      final live = manifest.hashes.values.toSet();
      await for (final entry in dir.list()) {
        final name = entry.uri.pathSegments.last;
        if (entry is File && !live.contains(name)) await entry.delete();
      }
    } catch (_) {
      // best effort
    }
  }

  Future<Uint8List> _get(Uri url) async {
    final bytes = await _download(_client, url);
    if (bytes == null) throw HttpException('not found', uri: url);
    return bytes;
  }

  /// Page chunks, fetched ahead of navigation. Per-request latency to a
  /// hosted build is what dominates (a second or more before the first
  /// byte, for a few KB), so no page should wait for its own request when
  /// the user taps it. Only bytes are cached — evaluating stays on demand,
  /// as in a release host.
  ///
  /// Two phases, because the first screen needs the bandwidth more than a
  /// page nobody has opened yet: the tab pages ride along with the runtime
  /// (a tab switch is the first thing a user does), everything else starts
  /// once the program is on screen, a few at a time.
  final Map<String, Future<Uint8List?>> _chunks = {};

  static const _backgroundParallel = 4;
  static const _backgroundDelay = Duration(milliseconds: 800);

  bool _closed = false;

  Future<Uint8List?> _chunk(String chunk) =>
      _chunks[chunk] ??= _program(
        manifest.pages[chunk],
        'pages/$chunk.fjsbundle',
        _get,
      ).then<Uint8List?>((b) => b, onError: (Object e) {
        if (!_closed) engine.onLog?.call(3, '[hosted] page $chunk failed: $e');
        _chunks.remove(chunk); // let the next navigation retry it
        return null;
      });

  Future<void> _prefetchRest() async {
    await Future<void>.delayed(_backgroundDelay);
    if (_closed) return;
    final order =
        manifest.pages.keys.where((c) => !_chunks.containsKey(c)).toList();
    if (order.isEmpty) return;
    final started = DateTime.now();
    var next = 0;
    Future<void> worker() async {
      while (next < order.length && !_closed) {
        await _chunk(order[next++]);
      }
    }

    await Future.wait([for (var i = 0; i < _backgroundParallel; i++) worker()]);
    if (_closed) return;
    unawaited(_pruneByHash());
    engine.onLog?.call(
      1,
      '[hosted] prefetched ${order.length} more page chunks in '
      '${DateTime.now().difference(started).inMilliseconds}ms',
    );
  }

  /// Ends the session: aborts any prefetch still in flight.
  void close() {
    _closed = true;
    _client.close(force: true);
  }

  /// Fetches everything the first screen needs, then swaps it in. Fetching
  /// first means a failed reload leaves the running app on screen.
  Future<void> load({bool fresh = false}) async {
    if (fresh) {
      // a manual reload asks what is deployed now, not what was at connect
      manifest = await server.probeWithRetry();
      _chunks.clear();
    }
    final started = DateTime.now();
    // phase 1: runtime + tab pages, all at once
    for (final chunk in manifest.tabChunks) {
      unawaited(_chunk(chunk));
    }
    final (shared, bundle) = await (
      manifest.shared == null
          ? Future<Uint8List?>.value()
          : _program(manifest.shared, 'shared.fjsbundle', _revalidated),
      _program(manifest.bundle, 'bundle.fjsbundle', _revalidated),
    ).wait;
    engine.onLog?.call(
      1,
      '[hosted] runtime fetched in '
      '${DateTime.now().difference(started).inMilliseconds}ms',
    );

    engine.chunkLoader = _chunk;
    engine.stopEventLoop();
    engine.clearPreludes();
    engine.reset();
    if (shared != null) engine.addPrelude(shared);
    engine.runBundle(bundle);
    engine.startEventLoop();
    // phase 2: the rest, once the first screen has the network to itself
    unawaited(_prefetchRest());
  }
}
