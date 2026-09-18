// fjs go — the Expo Go-style dev client.
//
// One prebuilt app (this one) connects to a running `fjs dev` server and
// renders whatever project it serves, so iterating on JS/Vue never requires
// rebuilding the native layer. The engine, host modules and widget mapping
// are exactly the ones an embedded host would use; only the program source
// differs (network instead of assets).
//
//   cd examples/hello-fjs && fjs dev
//   → run this app, enter the address fjs dev prints
import 'dart:io' show Platform;

import 'package:fjs_iconmind/fjs_iconmind.dart';
import 'package:fjs_webgl/fjs_webgl.dart';
import 'package:fjs_webview/fjs_webview.dart';
import 'package:flutter/material.dart';
import 'package:flutter_fjs/flutter_fjs.dart';

import 'src/connect_screen.dart';
import 'src/dev_server.dart';
import 'src/hosted_build.dart';
import 'src/log_store.dart';
import 'src/recent_servers.dart';
import 'src/session_screen.dart';
import 'src/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final recents = await RecentServers.load();
  runApp(FjsGoApp(recents: recents));
}

class FjsGoApp extends StatelessWidget {
  const FjsGoApp({super.key, required this.recents});

  final RecentServers recents;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'fjs go',
      debugShowCheckedModeBanner: false,
      theme: buildGoTheme(Brightness.light),
      darkTheme: buildGoTheme(Brightness.dark),
      home: _Home(recents: recents),
    );
  }
}

class _Home extends StatefulWidget {
  const _Home({required this.recents});

  final RecentServers recents;

  @override
  State<_Home> createState() => _HomeState();
}

class _HomeState extends State<_Home> {
  /// Skips the connect screen when the address is already known:
  ///   flutter run -d macos --dart-define=FJS_DEV=127.0.0.1:38900
  static const _autoConnect = String.fromEnvironment('FJS_DEV');

  final LogStore _logs = LogStore();

  @override
  void initState() {
    super.initState();
    if (_autoConnect.isEmpty) return;
    try {
      final server = DevServer.parse(_autoConnect);
      WidgetsBinding.instance.addPostFrameCallback((_) => _connect(server));
    } on FormatException catch (e) {
      _logs.add(LogLevel.error, 'FJS_DEV: ${e.message}');
    }
  }
  FjsEngine? _engine;
  DevServer? _server;
  DevManifest _manifest = const DevManifest.unknown();

  /// Set when the session is a hosted release build rather than fjs dev.
  HostedBuild? _hosted;
  String? _error;
  bool _busy = false;

  /// A fresh engine per session: disposing the old one is what guarantees a
  /// disconnected project leaves no timers or host modules behind.
  FjsEngine _createEngine({AssetBundle? assets}) {
    final engine = FjsEngine();
    // before the modules register: iconmind warms its icon set right away
    if (assets != null) engine.assetBundle = assets;
    engine.onLog = _logs.addEngineLog;
    engine.host.register('device', (args) => {
          'platform': Platform.operatingSystem,
          'locale': Platform.localeName,
          'args': args,
        });
    // the Dart halves of the fjs modules a project may use — what autolink
    // registers in a generated host, registered by hand here
    FjsIconmind.register(engine);
    FjsWebgl.register(engine);
    FjsWebview.register(engine);
    return engine;
  }

  Future<void> _connect(DevServer server) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    _logs.add(LogLevel.status, 'connecting to ${server.label}…');
    FjsEngine? engine;
    HostedBuild? hosted;
    try {
      // probe first: an unreachable host would otherwise surface as an
      // opaque socket error from inside the engine's dev client
      final manifest = await server.probe();
      engine = _createEngine(
        assets: manifest.isHosted ? HostedAssetBundle(server.origin) : null,
      );
      if (manifest.isHosted) {
        hosted = HostedBuild(engine, server, manifest);
        await hosted.load();
      } else {
        await engine.connectDev(server.host, server.port);
      }
      // the showcase has its own permanent entry; listing it again is noise
      if (server != DevServer.showcase) await widget.recents.remember(server);
      _logs.add(LogLevel.status, 'connected — ${manifest.displayName}');
      if (!mounted) {
        hosted?.close();
        engine.dispose();
        return;
      }
      setState(() {
        _engine = engine;
        _server = server;
        _manifest = manifest;
        _hosted = hosted;
        _busy = false;
      });
    } catch (e) {
      hosted?.close();
      engine?.dispose();
      _logs.add(LogLevel.error, 'connect failed: $e');
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _explain(e, server);
      });
    }
  }

  /// Connection failures are the single most common thing a user hits here,
  /// so they get a hint instead of a bare exception string.
  String _explain(Object error, DevServer server) {
    final text = error.toString();
    final unreachable = error is Exception &&
        (text.contains('SocketException') ||
            text.contains('Connection refused') ||
            text.contains('TimeoutException'));
    if (error is FormatException) return error.message;
    if (!unreachable) return text;
    // an internet host: none of the LAN advice below applies
    if (server.secure) return '连不上 ${server.label}。\n请检查网络连接后重试。';
    // iOS 14+ gates every LAN connection behind the local-network prompt,
    // and a denied one fails exactly like an unplugged cable — worse, the
    // broadcast discovery may already be running, so the server shows up in
    // the list and then refuses to connect. Nothing in the error says so.
    final hint = Platform.isAndroid
        ? '模拟器访问宿主机请用 10.0.2.2。真机需与电脑同一 Wi-Fi'
            '（访客网络 / AP 隔离会把手机和电脑隔开）。'
            '扫码请对准 `fjs dev` 终端里的码（默认端口 38900），不是 `fjs dev --web`。'
        : Platform.isIOS
            ? '若装上后点过"不允许"，到 设置 → fjs go → 本地网络 打开；'
                '模拟器可用 127.0.0.1，真机需与电脑同一局域网。'
            : '模拟器可用 127.0.0.1；真机需与电脑同一局域网。';
    return '连不上 ${server.label}。\n确认 fjs dev 正在运行，且地址可达。\n$hint';
  }

  Future<void> _reload() async {
    final engine = _engine;
    if (engine == null) return;
    _logs.add(LogLevel.status, 'manual reload');
    try {
      final hosted = _hosted;
      if (hosted != null) {
        await hosted.load(fresh: true);
      } else {
        await engine.reloadDev();
      }
    } catch (e) {
      _logs.add(LogLevel.error, 'reload failed: $e');
    }
  }

  void _disconnect() {
    final engine = _engine;
    final hosted = _hosted;
    _logs.add(LogLevel.status, 'disconnected');
    setState(() {
      _engine = null;
      _server = null;
      _manifest = const DevManifest.unknown();
      _hosted = null;
    });
    hosted?.close();
    engine?.disconnectDev();
    engine?.dispose();
  }

  @override
  void dispose() {
    _hosted?.close();
    _engine?.disconnectDev();
    _engine?.dispose();
    _logs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final engine = _engine;
    final server = _server;
    // a cross-fade rather than a route push: the connect screen is not
    // somewhere the back gesture inside a project should return to
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 280),
      child: engine != null && server != null
          ? SessionScreen(
              key: const ValueKey('session'),
              engine: engine,
              server: server,
              manifest: _manifest,
              logs: _logs,
              onReload: _reload,
              onDisconnect: _disconnect,
            )
          : ConnectScreen(
              key: const ValueKey('connect'),
              recents: widget.recents,
              onConnect: _connect,
              error: _error,
              busy: _busy,
            ),
    );
  }
}
