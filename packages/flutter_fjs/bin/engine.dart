// Engine-flavor materializer (spec 091) — THE one copy implementation.
//
//   dart run flutter_fjs:engine quickjs     # from any host that depends on
//   dart run flutter_fjs:engine primjs      # this package (path dep)
//
// Copies the requested flavor from this package's abi/ cache over the
// locations each platform's build consumes (android jniLibs, ios/macos
// xcframeworks, ohos libs) and stamps abi/.materialized. Idempotent: a
// flavor already in place is a no-op. `fjs run/build --js-engine` shells
// out to this runner; pure Flutter hosts (fjs-go) run it by hand before
// `flutter run`, or pass --dart-define=FJS_JS_ENGINE=... and let the build
// hooks (gradle task / podspec script / ohos hvigorfile) copy during the
// build.
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

const _engineIds = <String, String>{
  'primjs': 'primjs-4.1.1',
  'quickjs': 'quickjs-ng-0.9.0',
};

void main(List<String> args) {
  final engine = args.isNotEmpty ? args.first : (Platform.environment['FJS_JS_ENGINE'] ?? '');
  if (engine != 'primjs' && engine != 'quickjs') {
    stderr.writeln(
        "usage: dart run flutter_fjs:engine <primjs|quickjs> — got '${args.isEmpty ? '' : args.first}'");
    exit(64);
  }
  // --host <dir>: the host project, so the Xcode caches under its build/
  // can be invalidated too. Pure Flutter hosts: run this from the project
  // root and the same caches are found via the CWD fallback.
  String? hostDir;
  for (var i = 1; i < args.length - 1; i++) {
    if (args[i] == '--host') hostDir = args[i + 1].replaceAll(RegExp(r'/+$'), '');
  }

  final root = _findPackageRoot();
  var changed = false;

  final android = Directory('$root/abi/$engine/android');
  if (android.existsSync()) {
    for (final abi in android.listSync().whereType<Directory>()) {
      final dest = Directory('$root/android/src/main/jniLibs/${_name(abi.path)}');
      for (final so in abi.listSync().whereType<File>()) {
        if (_copyFile(so.path, '${dest.path}/${_name(so.path)}')) changed = true;
      }
      if (engine == 'quickjs') {
        // the CDP inspector binds LEPUS_* symbols; it can never work
        // against a quickjs engine and must not reach an APK
        final dbg = File('${dest.path}/libfjs_debugger.so');
        if (dbg.existsSync()) {
          dbg.deleteSync();
          changed = true;
        }
      }
    }
  }

  for (final platform in ['ios', 'macos']) {
    final src = Directory('$root/abi/$engine/$platform');
    if (!src.existsSync()) continue;
    // the engine framework exists in both flavors; the debugger framework
    // exists ONLY for primjs — quickjs has no debugger ABI at all, so its
    // materialization removes the framework instead of swapping bytes
    if (_copyDir('${src.path}/fjs.xcframework', '$root/$platform/fjs.xcframework')) {
      changed = true;
    }
    final dbgSrc = Directory('${src.path}/fjs_debugger.xcframework');
    final dbgDest = Directory('$root/$platform/fjs_debugger.xcframework');
    if (dbgSrc.existsSync()) {
      if (_copyDir(dbgSrc.path, dbgDest.path)) changed = true;
    } else if (dbgDest.existsSync()) {
      dbgDest.deleteSync(recursive: true);
      changed = true;
    }
  }

  final ohos = Directory('$root/abi/$engine/ohos/arm64-v8a');
  if (ohos.existsSync()) {
    for (final so in ohos.listSync().whereType<File>()) {
      if (_copyFile(so.path, '$root/ohos/libs/arm64-v8a/${_name(so.path)}')) {
        changed = true;
      }
    }
    if (engine == 'quickjs') {
      final dbg = File('$root/ohos/libs/arm64-v8a/libfjs_debugger.so');
      if (dbg.existsSync()) {
        dbg.deleteSync();
        changed = true;
      }
    }
  }

  // The shim compiles against this header to declare exactly the ABI the
  // linked flavor has — quickjs has no fjs_vm_debugger_* and must not
  // reference it even in DEBUG. This runner is its only writer.
  for (final platform in ['ios', 'macos']) {
    final header = File('$root/$platform/Classes/fjs_engine_flavor.h');
    if (!header.existsSync()) continue;
    final tmp = File('${header.path}.tmp');
    tmp.writeAsStringSync(_flavorHeader(engine));
    if (_copyFile(tmp.path, header.path)) changed = true;
    tmp.deleteSync();
  }

  // Xcode caches the extracted xcframework slice under the host's
  // build/<config>/XCFrameworkIntermediates/ and does not notice the source
  // archive's content changed — and its incremental bookkeeping may skip
  // the Ld of the flutter_fjs framework entirely. Dropping the extraction
  // cache and the linked product forces the next build to re-extract and
  // relink for real.
  for (final hostBuild in [
    if (hostDir != null) Directory('$hostDir/build'),
    Directory('build'),
  ]) {
    if (!hostBuild.existsSync()) continue;
    for (final config in hostBuild.listSync().whereType<Directory>()) {
      final stale = Directory('${config.path}/XCFrameworkIntermediates/flutter_fjs');
      if (stale.existsSync()) {
        stale.deleteSync(recursive: true);
        changed = true;
      }
      final product = Directory('${config.path}/flutter_fjs/flutter_fjs.framework');
      if (product.existsSync()) {
        product.deleteSync(recursive: true);
        changed = true;
      }
    }
  }

  File('$root/abi/.materialized').writeAsStringSync('$engine\n');
  if (changed) {
    // The debugger framework's PRESENCE is decided by the podspecs at pod
    // install (quickjs ships none), and flutter skips pod install when the
    // plugin set is unchanged — touch the Podfiles so the next flutter
    // build re-runs it and re-evaluates the vendored list.
    for (final podfile in [
      if (hostDir != null) '$hostDir/ios/Podfile',
      'ios/Podfile',
    ]) {
      final f = File(podfile);
      if (f.existsSync()) f.setLastModifiedSync(DateTime.now());
    }
    stdout.writeln('fjs: materialized ${_engineIds[engine]} engine into the flutter_fjs plugin');
  } else {
    stdout.writeln('fjs: engine flavor already ${_engineIds[engine]} — nothing to copy');
  }
}

String _flavorHeader(String engine) => '''
/* Generated by the fjs engine runner (bin/engine.dart) — do not edit.
 * Declares which engine flavor the linked fjs.xcframework carries this
 * build; the plugin shim gates its declarations on it (spec 091). */
#ifndef FJS_ENGINE_FLAVOR_H
#define FJS_ENGINE_FLAVOR_H
#define FJS_ENGINE_${engine.toUpperCase()} 1
#endif
''';

String _name(String p) => p.split(Platform.pathSeparator).last;

/// Copies [src] over [dest] only when the bytes differ, so an
/// already-materialized flavor leaves mtimes (and Xcode/Gradle caches)
/// alone. Returns true when a copy happened.
bool _copyFile(String src, String dest) {
  final s = File(src), d = File(dest);
  if (d.existsSync() && _sameBytes(s, d)) return false;
  d.parent.createSync(recursive: true);
  s.copySync(dest);
  return true;
}

bool _copyDir(String srcPath, String destPath) {
  final srcDir = Directory(srcPath);
  if (!srcDir.existsSync()) {
    throw FileSystemException('engine flavor incomplete — missing $srcPath');
  }
  var copied = false;
  final dest = Directory(destPath);
  dest.createSync(recursive: true);
  for (final e in srcDir.listSync(recursive: true)) {
    final rel = e.path.substring(srcDir.path.length + 1);
    final target = '${dest.path}/$rel';
    if (e is Directory) {
      Directory(target).createSync(recursive: true);
    } else if (e is File) {
      if (_copyFile(e.path, target)) copied = true;
    }
  }
  return copied;
}

bool _sameBytes(File a, File b) {
  if (a.lengthSync() != b.lengthSync()) return false;
  final da = a.readAsBytesSync(), db = b.readAsBytesSync();
  for (var i = 0; i < da.length; i++) {
    if (da[i] != db[i]) return false;
  }
  return true;
}

/// Locates this package's own checkout. `dart run` executes a kernel
/// snapshot, so Platform.script points into .dart_tool — resolve the
/// package root from the host's package_config instead (the same mechanism
/// `dart run` itself used to find us), walking up for good measure.
String _findPackageRoot() {
  final resolved = Isolate.resolvePackageUriSync(Uri.parse('package:flutter_fjs/'));
  if (resolved != null && resolved.scheme == 'file') {
    // package URIs point at the package's lib/ — the root is one up
    return Directory(resolved.toFilePath()).parent.absolute.path;
  }
  var dir = Directory.current;
  while (true) {
    final cfg = File('${dir.path}/.dart_tool/package_config.json');
    if (cfg.existsSync()) {
      final map = jsonDecode(cfg.readAsStringSync()) as Map<String, dynamic>;
      for (final p in (map['packages'] as List<dynamic>).cast<Map<String, dynamic>>()) {
        if (p['name'] == 'flutter_fjs') {
          final rootUri = Uri.parse(p['rootUri'] as String);
          return Directory(cfg.parent.uri.resolveUri(rootUri).toFilePath()).absolute.path;
        }
      }
    }
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  throw const FileSystemException(
      'cannot locate the flutter_fjs package — run from a host that depends on it');
}
