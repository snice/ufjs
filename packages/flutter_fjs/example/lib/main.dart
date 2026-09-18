// The smallest Flutter host that runs a JS bundle built by @ufjs/cli.
//
// This is the package's integration example; the full sample app lives in
// examples/hello-fjs. Produce a bundle first (`fjs build` in a JS project,
// which writes dist/app/bundle.fjsbundle and, for code-split apps, a
// pages/ directory), then run this host one of two ways:
//
//   flutter run --dart-define=FJS_DEV=192.168.x.x:38900   # fjs dev, hot reload
//   flutter run                                           # bundle from assets
//
// The release path expects the bundle under assets/fjs/ (declared in the
// host app's pubspec); it is the same layout `fjs build --release` bakes
// into a generated host.
import 'dart:convert' show jsonDecode;

import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final engine = FjsEngine();
  engine.onLog = (level, message) =>
      debugPrint('[js:${FjsLogLevel.of(level).name}] $message');
  // Host modules are the Dart half of JS's synchronous module calls.
  engine.host.register(
    'device',
    (args) => {'platform': defaultTargetPlatform.name, 'args': args},
  );

  const dev = String.fromEnvironment('FJS_DEV');
  if (dev.isEmpty) {
    // Release: assets, no network, no waiting worth showing a spinner for.
    await loadReleaseAssets(engine);
    runApp(_ExampleApp(engine: engine, dev: ''));
    return;
  }
  // Dev: PAINT FIRST, connect after. The first outbound request may raise
  // a LAN permission sheet, and a sheet needs a foregrounded UI to be
  // answered; connectDev's backoff picks the bundle up afterwards.
  runApp(_ExampleApp(engine: engine, dev: dev));
  engine.connectDevString(dev).ignore();
}

extension on FjsEngine {
  Future<void> connectDevString(String value) async {
    final uri = Uri.parse(value.contains('://') ? value : 'http://$value');
    if (uri.host.isEmpty) {
      throw ArgumentError('FJS_DEV must be host:port, got "$value"');
    }
    await connectDev(uri.host, uri.hasPort ? uri.port : 38900);
  }
}

/// The release path: bundle (and, for split apps, page chunks) from
/// Flutter assets — the layout `fjs build --release` bakes into a
/// generated host.
Future<void> loadReleaseAssets(FjsEngine engine) async {
  Map<String, Object?>? pages;
  try {
    final manifest = jsonDecode(
      await rootBundle.loadString('assets/fjs/manifest.json'),
    );
    pages = (manifest['pages'] as Map?)?.cast<String, Object?>();
  } catch (_) {
    pages = null;
  }
  engine.chunkLoader = (chunk) async {
    try {
      final path =
          pages?[chunk]?.toString() ?? 'assets/fjs/pages/$chunk.fjsbundle';
      return (await rootBundle.load(path)).toUint8List();
    } catch (_) {
      return null;
    }
  };
  final bundle = await rootBundle.load('assets/fjs/bundle.fjsbundle');
  engine.runBundle(bundle.toUint8List());
  engine.startEventLoop();
}

class _ExampleApp extends StatelessWidget {
  const _ExampleApp({required this.engine, required this.dev});

  final FjsEngine engine;
  final String dev;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'flutter_fjs example',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
      home: Scaffold(
        body: FjsApp(
          engine: engine,
          // Shown while a pushed route waits for its JS chunk to arrive.
          placeholder: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const CircularProgressIndicator(),
                if (dev.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text('waiting for fjs dev at $dev', softWrap: false),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
