// Address of a `fjs dev` server, plus the probe that runs before the engine
// connects: a bad host would otherwise surface as an opaque socket error
// from deep inside the engine.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show immutable;

@immutable
class DevServer {
  const DevServer(this.host, this.port, {this.secure = false});

  factory DevServer.parse(String input) {
    var text = input.trim();
    if (text.isEmpty) throw const FormatException('address is empty');
    // accept pasted URLs (http://1.2.3.4:38900/bundle.js) as well as host:port
    if (text.contains('://')) {
      final uri = Uri.parse(text);
      if (uri.host.isEmpty) throw FormatException('no host in "$input"');
      // an https URL is a hosted build behind a normal web server; its
      // port is the scheme's, never fjs dev's
      if (uri.scheme == 'https') {
        return DevServer(uri.host, uri.hasPort ? uri.port : 443, secure: true);
      }
      return DevServer(uri.host, uri.hasPort ? uri.port : defaultPort);
    }
    text = text.split('/').first;
    final colon = text.lastIndexOf(':');
    if (colon < 0) {
      // A bare public domain (showcase.example.dev) is a hosted build:
      // nobody runs fjs dev on the internet on port 38900. LAN names
      // (localhost, *.local, a lone machine name) and IPs keep the dev port.
      return _looksPublic(text)
          ? DevServer(text, 443, secure: true)
          : DevServer(text, defaultPort);
    }
    final port = int.tryParse(text.substring(colon + 1));
    if (port == null) throw FormatException('bad port in "$input"');
    return DevServer(text.substring(0, colon), port);
  }

  static bool _looksPublic(String host) {
    if (!host.contains('.')) return false;
    if (host.endsWith('.local') || host.endsWith('.lan')) return false;
    return InternetAddress.tryParse(host) == null;
  }

  static const defaultPort = 38900;

  /// The hosted hello-fjs showcase: something to run without a computer,
  /// for a first launch (and for App Review).
  static const showcase =
      DevServer('fjs-showcase.zhuzhe.dev', 443, secure: true);

  final String host;
  final int port;

  /// https. Only hosted builds use it: `fjs dev` itself is plain http.
  final bool secure;

  /// What the user sees and what [parse] reads back (recents persist it).
  String get label {
    if (!secure) return '$host:$port';
    return port == 443 ? 'https://$host' : 'https://$host:$port';
  }

  Uri get origin =>
      Uri(scheme: secure ? 'https' : 'http', host: host, port: port);

  Uri get bundleUrl => origin.replace(path: '/bundle.js');

  /// Asks the server what project it is serving. Doubles as the reachability
  /// check: a connect attempt only proceeds if this succeeds.
  /// Asks until it gets an answer: a hosted build is reached over the
  /// internet (a cold TLS handshake on a slow network can take seconds, and
  /// one dropped attempt is common), so it gets a longer timeout and one
  /// retry. A LAN `fjs dev` answers in milliseconds or not at all.
  Future<DevManifest> probeWithRetry() async {
    if (!secure) return probe();
    try {
      return await probe(timeout: const Duration(seconds: 12));
    } on FormatException {
      rethrow; // an answer, just not one we can use: retrying won't help
    } catch (_) {
      return probe(timeout: const Duration(seconds: 12));
    }
  }

  Future<DevManifest> probe({Duration timeout = const Duration(seconds: 4)}) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final req = await client
          .getUrl(origin.replace(path: '/manifest.json'))
          .timeout(timeout);
      final res = await req.close().timeout(timeout);
      if (res.statusCode == 404) return const DevManifest.unknown();
      if (res.statusCode != 200) {
        throw HttpException('dev server returned ${res.statusCode}');
      }
      final body = await res.transform(utf8.decoder).join().timeout(timeout);
      final trimmed = body.trimLeft();
      // `fjs dev --web` is a static site: unknown paths fall through to
      // index.html. Connecting that URL looks like "the server is up" until
      // jsonDecode throws a pile of markup.
      if (trimmed.startsWith('<')) {
        throw const FormatException(
          '这不是 App 端的 fjs dev。扫码或填写应对准 `fjs dev` / `fjs dev --pages`（默认端口 38900），不是 `fjs dev --web`。',
        );
      }
      try {
        return DevManifest.fromJson(jsonDecode(body) as Map<String, dynamic>);
      } on FormatException {
        throw const FormatException(
          '服务器没有返回 fjs 的 manifest。确认跑的是 `fjs dev` 或 `fjs dev --pages`。',
        );
      }
    } finally {
      client.close(force: true);
    }
  }

  @override
  bool operator ==(Object other) =>
      other is DevServer &&
      other.host == host &&
      other.port == port &&
      other.secure == secure;

  @override
  int get hashCode => Object.hash(host, port, secure);

  @override
  String toString() => label;
}

/// What `GET /manifest.json` reports. Servers that predate the endpoint
/// answer 404 and land on [DevManifest.unknown].
///
/// Two kinds of server answer it. `fjs dev` reports name / entry / split
/// and serves source over `/bundle.js` + a reload socket. A hosted release
/// build (`fjs build` output copied to a static web server, e.g. the
/// showcase) ships the manifest `fjs build` writes for assets, which names
/// its bytecode files under [bundle], [shared] and [pages] — and has no
/// socket, so it loads once and never live-reloads.
@immutable
class DevManifest {
  const DevManifest({
    required this.name,
    required this.entry,
    this.bundle,
    this.shared,
    this.pages = const {},
    this.tabChunks = const [],
    this.hashes = const {},
  });
  const DevManifest.unknown()
      : name = null,
        entry = null,
        bundle = null,
        shared = null,
        pages = const {},
        tabChunks = const [],
        hashes = const {};

  factory DevManifest.fromJson(Map<String, dynamic> json) {
    final pages = json['pages'];
    // tab pages, in tab order: the ones a user reaches first
    final tabs = <(num, String)>[
      for (final route in json['routes'] is List ? json['routes'] as List : [])
        if (route is Map &&
            route['chunk'] is String &&
            route['meta'] is Map &&
            (route['meta'] as Map)['tab'] is num)
          ((route['meta'] as Map)['tab'] as num, route['chunk'] as String),
    ]..sort((a, b) => a.$1.compareTo(b.$1));
    return DevManifest(
      name: json['name'] as String?,
      entry: json['entry'] as String?,
      bundle: json['bundle'] as String?,
      shared: json['shared'] as String?,
      pages: pages is Map
          ? {
              for (final e in pages.entries)
                if (e.value is String) e.key.toString(): e.value as String,
            }
          : const {},
      tabChunks: [for (final t in tabs) t.$2],
      hashes: json['hashes'] is Map
          ? {
              for (final e in (json['hashes'] as Map).entries)
                if (e.value is String) e.key.toString(): e.value as String,
            }
          : const {},
    );
  }

  final String? name;
  final String? entry;

  /// Release-build asset paths (`assets/fjs/...`), hosted builds only.
  final String? bundle;
  final String? shared;
  final Map<String, String> pages;

  /// Chunks of the tab-bar pages, in tab order (hosted builds only).
  final List<String> tabChunks;

  /// Content hash of each program file, keyed by the path the manifest
  /// names it by (`fjs build --release` writes them; hosted builds only).
  final Map<String, String> hashes;

  /// A static release build rather than a live `fjs dev`.
  bool get isHosted => bundle != null;

  String get displayName => name ?? 'fjs project';
}
