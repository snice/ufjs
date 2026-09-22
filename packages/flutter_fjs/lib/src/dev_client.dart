// Client for `fjs dev`: fetches the bundle over HTTP and listens on a
// WebSocket for change notifications. Dev bundles are source mode (faster
// round-trip); production builds embed the bytecode artifact instead.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// One parsed `reload` push. Empty [pages] means "reload the whole program";
/// that is also what an unrecognized message parses to, including the retired
/// `reload units:` form (spec 095).
class DevReload {
  const DevReload({this.pages = const []});

  final List<String> pages;

  bool get isFull => pages.isEmpty;
}

class DevClient {
  DevClient(this.host, this.port, {required this.fetchUrl, this.onLog});

  final String host;
  final int port;

  /// How this client talks HTTP: the engine hands in [FjsHttp.fetch], so
  /// the bundle comes down the same client — the same connection pool and
  /// the same lifetime — as JS `fetch()` and a module's own requests.
  final Future<Uint8List> Function(Uri url) fetchUrl;
  final void Function(String message)? onLog;

  WebSocket? _ws;

  /// Called on every change push. [DevReload.pages] names the page chunks to
  /// re-evaluate; empty means the whole program has to be reloaded.
  Future<void> Function(DevReload reload)? onReload;

  /// Called for `eval <id> <source>` pushes, which is how `fjs eval` runs
  /// an expression in this VM. The id comes back in the answer so the tool
  /// that asked can tell its own reply from another one's.
  void Function(String id, String source)? onEval;

  /// `fjs dev`'s `p` key: toggle the performance overlay. A push, not a
  /// request — nothing comes back, which is the point: the overlay's numbers
  /// have to survive on a release device where this socket does not exist.
  void Function()? onPerf;

  /// `debug on <port>` / `debug off` (spec 088): `fjs debug` starting and
  /// stopping its relay. The engine attaches its CDP channel to
  /// host:port — the same host this WebSocket is already talking to — and
  /// a successful attach is followed by a full reload so every script
  /// lands in the debugger's script table.
  void Function(int port)? onDebugAttach;
  void Function()? onDebugDetach;
  bool _closed = false;
  Timer? _retryTimer;
  int _retryAttempt = 0;

  Uri get _base => Uri.http('$host:$port');

  /// Where this server lives, for code that needs to build its own URLs
  /// against it (a module fetching its own dev-time file, say).
  Uri get baseUri => _base;

  Future<Uint8List> fetchBundle() => fetchForBootstrap('/bundle.js');

  /// The BOOTSTRAP fetch: keeps trying until it gets the bytes.
  ///
  /// [query] rides SEPARATELY from [path] on purpose: `Uri.replace(path:)`
  /// percent-encodes a literal `?` (%3F), and the dev server would answer
  /// the mangled path with its plain-text fallback — a 200 that parses as
  /// nothing.
  ///
  /// Why only the bootstrap. Failing to fetch the manifest, the prelude or
  /// the bundle means the app has nothing to run at all — there is no page
  /// left standing to report the failure to, so giving up after one attempt
  /// just leaves a dead app. Everything else on this client
  /// ([fetch] itself: a page's own `fetch()`, and the router's
  /// `/pages/<chunk>.js`) must NOT retry: those fail with a page already on
  /// screen that is supposed to handle it, and a silent retry would turn a
  /// plain 404 into "hangs for 8 seconds, then 404".
  ///
  /// Why it matters that this never gives up: on iOS the first outbound
  /// request raises a system permission sheet ("允许…使用无线数据" and, on
  /// iOS 14+ with NSLocalNetworkUsageDescription, the local-network one).
  /// The sheet is ASYNCHRONOUS — the request that triggered it has already
  /// failed by the time the user sees it. One attempt therefore can never
  /// succeed on a fresh install, no matter how the sheet is answered. The
  /// same shape covers two everyday cases: `fjs dev` not started yet, and
  /// wifi blinking during launch.
  ///
  /// Backoff mirrors the socket's below, then holds at the last step; dev
  /// has no business timing out on its own while the user is starting a
  /// server or reading a permission sheet.
  Future<Uint8List> fetchForBootstrap(String path, {String? query}) async {
    for (var attempt = 0; ; attempt++) {
      try {
        return await fetch(path, query: query);
      } on HttpException {
        // The server answered, and its answer was no. A 404 is not a
        // transient failure — it is how an OLDER dev server says it has no
        // /manifest.json, and fetchManifest below relies on that reaching it
        // so it can fall back to null. Retrying an answer forever would hang
        // the app on exactly the servers that fallback exists for.
        rethrow;
      } catch (e) {
        // Everything else is "could not reach the server": SocketException
        // from the permission sheet, from `fjs dev` not being up yet, from
        // wifi blinking. Those are worth waiting out.
        if (_closed) rethrow;
        final index = attempt < _retryDelays.length
            ? attempt
            : _retryDelays.length - 1;
        final wait = _retryDelays[index];
        // Loud on purpose: a bootstrap that quietly spins looks identical to
        // one that hung (constitution V).
        onLog?.call('$path failed ($e) — retrying in ${wait}s');
        await Future<void>.delayed(Duration(seconds: wait));
        if (_closed) rethrow;
      }
    }
  }

  /// GETs one path from the dev server. Split builds serve `/shared.js`
  /// (the prelude) and `/pages/<chunk>.js` next to `/bundle.js`.
  Future<Uint8List> fetch(String path, {String? query}) async {
    final started = DateTime.now();
    try {
      final bytes = await fetchUrl(_base.replace(path: path, query: query));
      // closed while this was in flight: whoever asked has moved on, and
      // applying a bundle after a disconnect is worse than failing
      if (_closed) throw const HttpException('dev client closed');
      final ms = DateTime.now().difference(started).inMilliseconds;
      onLog?.call('GET $path ${bytes.length} bytes in ${ms}ms');
      return bytes;
    } catch (e) {
      final ms = DateTime.now().difference(started).inMilliseconds;
      onLog?.call('GET $path failed in ${ms}ms: $e');
      rethrow;
    }
  }

  /// The dev server's manifest, or null when it cannot be read (an older
  /// server, or a transient failure — neither is worth failing a connect).
  Future<Map<String, Object?>?> fetchManifest() async {
    try {
      final bytes = await fetchForBootstrap('/manifest.json');
      final value = jsonDecode(utf8.decode(bytes));
      return value is Map<String, Object?> ? value : null;
    } catch (e) {
      onLog?.call('manifest unavailable: $e');
      return null;
    }
  }

  /// Opens the change socket. A failure here fails the connect (the caller
  /// has nothing to show yet), but a socket that drops later — `fjs dev`
  /// restarted, wifi blinked, the device slept — is retried in the
  /// background: HTTP keeps working either way, so a dead socket would
  /// otherwise leave the session looking connected while silently never
  /// reloading again.
  Future<void> listen() => _openSocket();

  Future<void> _openSocket() async {
    final ws = await WebSocket.connect(
      _base.replace(scheme: 'ws', path: '/ws').toString(),
    );
    if (_closed) {
      await ws.close();
      return;
    }
    _ws = ws;
    _retryAttempt = 0;
    // spec 088: tells the server this is a native app, not a browser page
    // or a tool. The server answers with `debug on <port>` when a
    // `fjs debug` relay is already up, which is how an app that starts (or
    // hot restarts) after `fjs debug` still gets attached.
    ws.add(jsonEncode({'fjs': 'app'}));
    ws.listen(
      (data) {
        if (_closed) return;
        final msg = data.toString();
        if (msg.startsWith('eval ')) {
          final rest = msg.substring('eval '.length);
          final space = rest.indexOf(' ');
          if (space > 0) {
            onEval?.call(rest.substring(0, space), rest.substring(space + 1));
          }
          return;
        }
        if (msg == 'perf') {
          onPerf?.call();
          return;
        }
        if (msg.startsWith('debug ')) {
          // Wire form (server: dev/server.ts, the `fjs:debug` case — keep
          // in sync): `debug on <port>` / `debug off`. An unknown `debug`
          // push from a newer server is ignored rather than guessed at:
          // guessing could attach to a port that means something else.
          final rest = msg.substring('debug '.length);
          if (rest == 'off') {
            onDebugDetach?.call();
          } else if (rest.startsWith('on ')) {
            final port = int.tryParse(rest.substring(3).trim());
            if (port != null && port > 0) onDebugAttach?.call(port);
          }
          return;
        }
        if (msg == 'reload' || msg.startsWith('reload')) {
          final reload = parseReload(msg);
          onLog?.call(
            reload.isFull
                ? 'change detected — reloading'
                : 'change detected — hot-swapping ${reload.pages.join(', ')}',
          );
          onReload?.call(reload);
        }
      },
      onError: (Object e) {
        if (!_closed) onLog?.call('dev socket error: $e');
      },
      onDone: () {
        if (_closed) return;
        onLog?.call('dev server disconnected — retrying');
        _scheduleRetry();
      },
    );
  }

  /// Backoff between reconnect attempts, in seconds; the last value repeats.
  static const List<int> _retryDelays = [1, 2, 3, 5, 8];

  void _scheduleRetry() {
    if (_closed || _retryTimer != null) return;
    _ws = null;
    final index = _retryAttempt < _retryDelays.length
        ? _retryAttempt
        : _retryDelays.length - 1;
    _retryAttempt++;
    _retryTimer = Timer(Duration(seconds: _retryDelays[index]), () async {
      _retryTimer = null;
      if (_closed) return;
      try {
        await _openSocket();
      } catch (e) {
        onLog?.call('reconnect failed: $e');
        _scheduleRetry();
        return;
      }
      if (_closed) return;
      // Edits made while the socket was down are not replayed, so the
      // bundle in the VM may already be stale: reload once on reconnect.
      onLog?.call('dev server reconnected — reloading');
      await onReload?.call(const DevReload());
    });
  }

  /// Forwards one console line to the dev server, where `fjs log` is
  /// listening. Best-effort: a dropped socket must never break the app,
  /// and the reconnect loop will pick it up again.
  void sendLog(int level, String text) {
    final ws = _ws;
    if (ws == null || _closed) return;
    try {
      ws.add(jsonEncode({'fjs': 'log', 'level': level, 'text': text}));
    } catch (_) {
      // socket closing under us: the next reconnect re-establishes it
    }
  }

  /// The page chunks a `reload pages:a,b` push names, or null for the
  /// plain `reload` that means "everything".
  static List<String>? changedPages(String message) {
    const marker = 'reload pages:';
    if (!message.startsWith(marker)) return null;
    final chunks = message
        .substring(marker.length)
        .split(',')
        .where((chunk) => chunk.isNotEmpty)
        .toList();
    return chunks.isEmpty ? null : chunks;
  }

  /// Parses one `reload` push into what to do with it.
  ///
  /// Wire forms (server: `dev/server.ts` `changeMessage` — keep in sync):
  ///   `reload`             — everything
  ///   `reload pages:a,b`   — page chunks only
  ///
  /// `reload units:…` used to mean a module hot swap (spec 037). That tier
  /// is gone (spec 095); a push that still names units is a full reload,
  /// which is always a correct answer. Anything else that starts with
  /// `reload` parses the same way: silently ignoring a push would leave
  /// the VM stale (constitution V).
  static DevReload parseReload(String message) {
    if (message == 'reload') return const DevReload();
    if (!message.startsWith('reload ')) return const DevReload();
    if (message.contains('units:')) return const DevReload();
    var pages = const <String>[];
    for (final token in message.substring('reload '.length).split(' ')) {
      final values = _csvAfter(token, 'pages:');
      if (values == null) return const DevReload();
      pages = values;
    }
    return DevReload(pages: pages);
  }

  static List<String>? _csvAfter(String token, String marker) {
    if (!token.startsWith(marker)) return null;
    return token
        .substring(marker.length)
        .split(',')
        .where((id) => id.isNotEmpty)
        .toList();
  }

  void close() {
    _closed = true;
    _retryTimer?.cancel();
    _retryTimer = null;
    _ws?.close();
    _ws = null;
  }
}
