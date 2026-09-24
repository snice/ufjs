// Engine-flavor runner (spec 091, reshaped by spec 105).
//
//   dart run flutter_fjs:engine quickjs     # from any host that depends on
//   dart run flutter_fjs:engine primjs      # this package
//
// Android, iOS and macOS no longer need it to switch engines: their build
// files pick the flavor themselves (android/build.gradle points jniLibs at
// abi/<flavor>/android; the podspecs vendor <platform>/abi/<flavor>/), so
// this package's directory is never written for them. That matters because
// for most hosts the directory is the shared pub cache: copying a flavor
// over it (what spec 091 did) let two projects clobber each other, let a
// release build of one strip the debugger out of another's debug build,
// and made `pub publish` ship whatever the last run left on disk.
//
// What is left here:
//
//  - ohos: a HAR packages native libraries from the module's libs/ only, so
//    the flavor still has to be copied into ohos/libs. The copy compares
//    bytes first (the default primjs set ships in place, so the common case
//    writes nothing) and is refused when this package sits in the pub cache
//    — use a path dependency to run a non-default flavor on ohos. Skipped
//    entirely for hosts without an ohos/ directory.
//  - the HOST's CocoaPods state: the podspecs choose the flavor at pod
//    install, and flutter skips pod install when nothing it tracks changed.
//    The last flavor is recorded in the host's .dart_tool; on a change the
//    host Podfile is touched and the host's Xcode xcframework caches are
//    dropped, so the next build re-installs and relinks. Host files only.
//
// --no-debugger is accepted for compatibility and does nothing: release and
// profile builds already leave the debugger out at the build layer (gradle
// exclude, the linker never pulling the unreferenced archive, the ohos
// buildModeBinder filter).
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
        "usage: dart run flutter_fjs:engine <primjs|quickjs> [--host <dir>] — "
        "got '${args.isEmpty ? '' : args.first}'");
    exit(64);
  }
  // --host <dir>: the host project. Defaults to the working directory, which
  // is where a pure Flutter host runs this from.
  var hostDir = Directory.current.path;
  for (var i = 1; i < args.length; i++) {
    if (args[i] == '--host' && i < args.length - 1) {
      hostDir = args[i + 1].replaceAll(RegExp(r'/+$'), '');
    }
  }

  final root = _findPackageRoot();
  final ohos = _selectOhos(root, hostDir, engine);
  final pods = _markHostFlavor(hostDir, engine);
  stdout.writeln('fjs: engine flavor ${_engineIds[engine]} — android/ios/macos '
      'select it at build time; ohos libs $ohos; host pods $pods');
}

/// Makes ohos/libs hold [engine]'s libraries. Returns a word for the
/// summary line; exits when a copy is needed but not allowed.
String _selectOhos(String root, String host, String engine) {
  if (!Directory('$host/ohos').existsSync()) return 'not used by this host';
  final src = Directory('$root/abi/$engine/ohos/arm64-v8a');
  if (!src.existsSync()) {
    stderr.writeln('fjs: engine flavor incomplete — missing ${src.path}');
    exit(66);
  }
  final dest = Directory('$root/ohos/libs/arm64-v8a');
  final wanted = {for (final f in src.listSync().whereType<File>()) _name(f.path): f};
  final present = dest.existsSync()
      ? {for (final f in dest.listSync().whereType<File>()) _name(f.path): f}
      : <String, File>{};
  final same = wanted.length == present.length &&
      wanted.entries.every((e) => present[e.key] != null && _sameBytes(e.value, present[e.key]!));
  if (same) return 'already $engine';
  final cache = _pubCacheRoot();
  if (cache != null && _isWithin(root, cache)) {
    stderr.writeln(
        'fjs: the $engine engine on ohos needs its libraries copied into flutter_fjs/ohos/libs,\n'
        'but this flutter_fjs is in the shared pub cache ($root) and is not modified.\n'
        'Depend on flutter_fjs through a path dependency to use a non-default engine on ohos.');
    exit(69);
  }
  dest.createSync(recursive: true);
  // quickjs has no debugger module; a primjs one left behind would bind
  // LEPUS_* symbols the quickjs engine does not have
  for (final name in present.keys) {
    if (!wanted.containsKey(name)) present[name]!.deleteSync();
  }
  for (final e in wanted.entries) {
    e.value.copySync('${dest.path}/${e.key}');
  }
  return 'switched to $engine';
}

/// Records [engine] in the host's .dart_tool and, when it changed, makes the
/// next Xcode build re-run pod install and relink. Host files only.
String _markHostFlavor(String host, String engine) {
  // v2 (spec 112): hosts that ran spec 105's runner hold a v1 stamp that
  // may already name the new flavor while their build still links the old
  // one (the cache drop never matched), so the v1 stamp is not trusted.
  final stamp = File('$host/.dart_tool/flutter_fjs/engine_flavor.v2');
  // no stamp: we cannot know what the last build linked — invalidate once
  // (one pod install and a relink) rather than guess
  final previous = stamp.existsSync() ? stamp.readAsStringSync().trim() : null;
  if (previous == engine) return 'unchanged';
  stamp.parent.createSync(recursive: true);
  stamp.writeAsStringSync('$engine\n');
  // flutter skips pod install when the plugin set is unchanged — a newer
  // Podfile makes it re-run, and the podspec re-evaluates the flavor
  for (final platform in ['ios', 'macos']) {
    final podfile = File('$host/$platform/Podfile');
    if (podfile.existsSync()) podfile.setLastModifiedSync(DateTime.now());
  }
  _dropXcodeCaches(Directory('$host/build'));
  return 'invalidated (${previous ?? 'unknown'} → $engine)';
}

/// Deletes, anywhere under the host's build dir, the copy of the engine
/// slice Xcode extracted (`XCFrameworkIntermediates/flutter_fjs`) and the
/// linked plugin framework (`flutter_fjs/flutter_fjs.framework`).
///
/// Both flavors ship a `libfjs.a` under the same name, and the CocoaPods
/// copy phase re-runs only when its input is NEWER than its output — a
/// quickjs archive checked out earlier than the last primjs copy looked
/// up to date, and a switch kept linking primjs (spec 112). The search is
/// recursive because Flutter nests these a few levels down:
///   build/ios/Debug-iphonesimulator/XCFrameworkIntermediates/flutter_fjs
///   build/macos/Build/Products/Debug/XCFrameworkIntermediates/flutter_fjs
/// Spec 091 looked only at build/<one level>/…, which never matched; it
/// did not show then because every switch re-copied files with fresh
/// timestamps. Keep in step with tool/test/xcode_cache_paths_check.mjs.
void _dropXcodeCaches(Directory build, [int depth = 0]) {
  if (depth > 6 || !build.existsSync()) return;
  for (final entry in build.listSync(followLinks: false).whereType<Directory>()) {
    final name = _name(entry.path);
    if (name == 'XCFrameworkIntermediates') {
      final stale = Directory('${entry.path}/flutter_fjs');
      if (stale.existsSync()) stale.deleteSync(recursive: true);
      continue;
    }
    if (name == 'flutter_fjs') {
      final product = Directory('${entry.path}/flutter_fjs.framework');
      if (product.existsSync()) product.deleteSync(recursive: true);
      continue;
    }
    // bundles never contain either; skipping them keeps the walk cheap
    if (name.endsWith('.app') || name.endsWith('.framework') || name.endsWith('.dSYM')) continue;
    _dropXcodeCaches(entry, depth + 1);
  }
}

String? _pubCacheRoot() {
  final env = Platform.environment;
  final explicit = env['PUB_CACHE'];
  if (explicit != null && explicit.isNotEmpty) return explicit;
  if (Platform.isWindows) {
    final local = env['LOCALAPPDATA'];
    return local == null ? null : '$local\\Pub\\Cache';
  }
  final home = env['HOME'];
  return home == null ? null : '$home/.pub-cache';
}

bool _isWithin(String path, String dir) {
  final p = Directory(path).absolute.uri.normalizePath().path;
  var d = Directory(dir).absolute.uri.normalizePath().path;
  if (!d.endsWith('/')) d = '$d/';
  return p.startsWith(d);
}

String _name(String p) => p.split(Platform.pathSeparator).last;

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
