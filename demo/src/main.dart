// fjsAttachHost — the host's Dart-side entry, copied verbatim to
// lib/fjs_attach.dart on every run and awaited before runApp (see the
// generated main.dart).
//
// The object-ABI page drives the mmkv adapter that `fjs autoimport`
// GENERATED into lib/fjs_objects.dart (package.json fjs.autoimport:
// ["mmkv"], specs/160). Plugin-level setup lives here, in the host: mmkv
// requires `await MMKV.initialize()` before any instance — fjsAttachHost
// is awaited before runApp, so by the time a page constructs one the
// plugin is ready. JS must NOT call initialize itself: a page setup runs
// synchronously and cannot await (and a half-initialized MMKV would race).
import 'dart:io' show Directory;

import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:mmkv/mmkv.dart';
import 'package:progress/progress.dart' as progress;

Future<void> fjsAttachHost(FjsEngine engine) async {
  final rootDir = '${Directory.systemTemp.path}/demo-mmkv';
  await Directory(rootDir).create(recursive: true);
  await MMKV.initialize(rootDir: rootDir);
  // the dart-progress page's dialog needs a BuildContext: hand it one
  // under the mounted FjsApp (specs/202)
  progress.progressContext = () => FjsApp.currentContext;
}
