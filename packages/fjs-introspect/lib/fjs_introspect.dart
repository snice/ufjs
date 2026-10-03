// fjs_introspect — dump a pub package's public Dart API as JSON.
//
//   cd <flutter-host>                       # package_config resolves the
//   dart run fjs_introspect \               # autoimported packages
//     --package mmkv --package other --out .fjs/autoimport
//
// Requires `lib/fjs_introspect_entry.dart` to exist (written by
// `fjs autoimport` with one prefixed import per package) — analyzing it is
// what makes the analyzer resolve every package through the host's own
// dependency graph, export chains included.
//
// The JSON grammar is THE contract with @ufjs/cli's generator
// (packages/fjs/src/project/autoimport.ts); specs/160-object-codegen
// documents it. Everything that cannot cross the fjs object ABI is
// reported in `skipped` with a reason — reported, never silently dropped,
// and never fatal for the rest of the dump (a third-party package always
// contains some unbindable surface; one member must not sink the rest).
//
// Analyzer 14 API on purpose (pubspec pins ^14): this line of analyzers
// settled the element model back to unsuffixed names (ClassElement,
// formalParameters, Namespace.definedNames2) after the Element2
// transition; porting across majors is deliberate work, not a bump.
import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/analysis_context_collection.dart';
import 'package:analyzer/dart/analysis/results.dart';
import 'package:analyzer/dart/element/element.dart';
import 'package:analyzer/dart/element/nullability_suffix.dart';
import 'package:analyzer/dart/element/type.dart';
import 'package:args/args.dart';

Future<void> main(List<String> argv) async {
  final parser = ArgParser()
    ..addMultiOption('package', help: 'pub package to dump (repeatable)')
    ..addOption('root', defaultsTo: '.', help: 'flutter host directory')
    ..addOption('out', defaultsTo: '.fjs/autoimport', help: 'dump directory');
  final args = parser.parse(argv);
  final packages = args['package'] as List<String>;
  if (packages.isEmpty) {
    stderr.writeln(parser.usage);
    exitCode = 2;
    return;
  }

  final root = Directory(args['root'] as String).resolveSymbolicLinksSync();
  final libPath = Directory('$root/lib').path;
  final entryPath = '$libPath/fjs_introspect_entry.dart';
  if (!File(entryPath).existsSync()) {
    stderr.writeln('fjs_introspect: $entryPath not found — run fjs autoimport first');
    exitCode = 2;
    return;
  }

  // --out is passed absolute by the CLI (the tool's cwd is the runner
  // package, not the host, so relative would land in the wrong tree)
  final outDir = Directory(args['out'] as String);
  outDir.createSync(recursive: true);

  final collection = AnalysisContextCollection(includedPaths: [libPath]);
  final session = collection.contextFor(libPath).currentSession;
  final result = await session.getResolvedUnit(entryPath);
  if (result is! ResolvedUnitResult || !result.exists) {
    stderr.writeln('fjs_introspect: could not resolve $entryPath — '
        'did `flutter pub get` run?');
    exitCode = 1;
    return;
  }

  final dumper = _Dumper(packages);
  for (final pkg in packages) {
    final library = dumper.libraryFor(result.libraryElement, 'package:$pkg/$pkg.dart');
    if (library == null) {
      stderr.writeln('fjs_introspect: package:$pkg/$pkg.dart is not imported by the '
          'entry file (stale fjs_introspect_entry.dart?)');
      exitCode = 1;
      return;
    }
    final dump = dumper.dumpPackage(pkg, library);
    File('${outDir.path}/$pkg.api.json')
        .writeAsStringSync(const JsonEncoder.withIndent('  ').convert(dump));
    final bound = (dump['classes'] as List).length + (dump['functions'] as List).length;
    final skipped = (dump['skipped'] as List).length;
    stdout.writeln('fjs_introspect: $pkg — $bound top-level binding(s), '
        '$skipped skipped member(s)');
  }
}

/// Walks a resolved library's export namespace and serializes the public
/// surface into the dump grammar.
class _Dumper {
  _Dumper(this.packages);

  final List<String> packages;
  final skipped = <Map<String, String>>[];

  /// The entry file imports each package's main library; match by resolved
  /// URI rather than by prefix — the prefix is tooling bookkeeping. The
  /// imports hang off the library's fragments, not the library element.
  LibraryElement? libraryFor(LibraryElement entry, String uri) {
    for (final fragment in entry.fragments) {
      for (final imp in fragment.libraryImports) {
        if (imp.importedLibrary?.identifier == uri) {
          return imp.importedLibrary;
        }
      }
    }
    return null;
  }

  Map<String, Object?> dumpPackage(String pkg, LibraryElement library) {
    skipped.clear();
    final classes = <Map<String, Object?>>[];
    final functions = <Map<String, Object?>>[];

    // definedNames2/get2: the transitional names this analyzer line settled
    // on after dropping the legacy Namespace API
    final names = library.exportNamespace.definedNames2.keys.toList()..sort();
    for (final name in names) {
      final element = library.exportNamespace.get2(name);
      if (element == null || !element.isPublic) continue;
      if (element is ClassElement) {
        // EnumElement / MixinElement / ExtensionElement are SIBLINGS of
        // ClassElement (all implement InterfaceElement), so this test only
        // catches plain classes — exactly what v1 binds.
        classes.add(_dumpClass(name, element, pkg));
      } else if (element is TopLevelFunctionElement) {
        final member = _function(name, element);
        if (member != null) functions.add(member);
      } else {
        _skip(name, '${element.runtimeType} (only classes and functions bind in v1)');
      }
    }
    // every top-level type name: the generator qualifies default-value
    // expressions (which are written in THIS package's scope) with its
    // import prefix
    final types = <String>[];
    for (final name in names) {
      final element = library.exportNamespace.get2(name);
      if (element == null || !element.isPublic) continue;
      if (element is InterfaceElement || element is TypeAliasElement) {
        types.add(name);
      }
    }

    return {
      'package': pkg,
      'entry': library.identifier,
      'types': types,
      'classes': classes,
      'functions': functions,
      'skipped': List.of(skipped),
    };
  }

  Map<String, Object?> _dumpClass(String name, ClassElement cls, String pkg) {
    final constructors = <Map<String, Object?>>[];
    for (final ctor in cls.constructors) {
      if (!ctor.isPublic) continue;
      // v1: the unnamed constructor only — a named one would need its own
      // JS-side binding name, which is a v2 question. This analyzer names
      // the unnamed one 'new'; older ones left it empty.
      if (ctor.name != null && ctor.name!.isNotEmpty && ctor.name != 'new') {
        _skip('${name}.${ctor.name}', 'named constructor (v1 binds the unnamed one)');
        continue;
      }
      final params = _params(name, ctor.formalParameters);
      if (params == null) continue;
      constructors.add({'params': params});
    }

    final statics = <Map<String, Object?>>[];
    for (final m in cls.methods.where((m) => m.isStatic && m.isPublic)) {
      final one = _method(name, m.name ?? '', m);
      if (one != null) statics.add(one);
    }
    final methods = <Map<String, Object?>>[];
    for (final m in cls.methods.where((m) => !m.isStatic && m.isPublic)) {
      final one = _method(name, m.name ?? '', m);
      if (one != null) methods.add(one);
    }

    // Fields read as getters; explicit accessors fill in what fields don't
    // cover. Synthetic accessors (the ones the compiler makes for a field)
    // are already represented by the field itself.
    final getters = <Map<String, Object?>>[];
    final fieldNames = <String>{};
    for (final f in cls.fields.where((f) => f.isPublic && !f.isStatic)) {
      fieldNames.add(f.name ?? '');
      final t = _type(f.type, '${name}.${f.name}');
      if (t == null) continue; // _type filed the skipped entry
      getters.add({'name': f.name, 'returns': t});
    }
    for (final g in cls.getters) {
      // the new element model only lists DECLARED accessors — a field's
      // implicit getter never appears here, so no synthetic check exists
      if (!g.isPublic || g.isStatic) continue;
      if (fieldNames.contains(g.name)) continue;
      final t = _type(g.returnType, '${name}.${g.name}');
      if (t == null) continue;
      getters.add({'name': g.name, 'returns': t});
    }
    final setters = <Map<String, Object?>>[];
    // a field is writable from JS when it has a setter — a plain public field
    // gets an implicit one that may be absent from cls.setters (specs/201).
    // `isFinal` is no help: the new element model also lists a getter-only
    // accessor as a synthetic non-final field, so ask for the setter itself.
    final setterNames = <String>{};
    for (final f in cls.fields.where((f) => f.isPublic && !f.isStatic)) {
      final setter = f.setter;
      if (setter == null || !setter.isPublic) continue;
      final t = _type(f.type, '${name}.${f.name}=');
      if (t == null) continue;
      setterNames.add(f.name ?? '');
      setters.add({'name': f.name ?? '', 'type': t});
    }
    for (final st in cls.setters) {
      if (!st.isPublic || st.isStatic) continue;
      if (setterNames.contains(st.name)) continue;
      final t = _type(st.formalParameters.first.type, '${name}.${st.name}=');
      if (t == null) continue;
      setters.add({'name': st.name ?? '', 'type': t});
    }

    return {
      'name': name,
      'constructors': constructors,
      'statics': statics,
      'methods': methods,
      'getters': getters,
      'setters': setters,
    };
  }

  Map<String, Object?>? _method(String clsName, String name, ExecutableElement m) {
    final tags = _params(clsName, m.formalParameters);
    if (tags == null) return null;
    final ret = _type(m.returnType, '$clsName.$name (return)');
    if (ret == null) return null;
    return {'name': name, 'params': tags, 'returns': ret};
  }

  Map<String, Object?>? _function(String name, TopLevelFunctionElement fn) {
    final tags = _params(name, fn.formalParameters);
    if (tags == null) return null;
    final ret = _type(fn.returnType, '$name (return)');
    if (ret == null) return null;
    return {'name': name, 'params': tags, 'returns': ret};
  }

  /// Null when a REQUIRED parameter cannot cross — the whole member goes
  /// then. An optional one is merely omitted from the list (with a skipped
  /// entry): the generated adapter calls the member without it and the
  /// Dart default applies. This is what keeps real-world constructors like
  /// `MMKV(String id, {MMKVMode mode = …})` bindable despite their enum
  /// options.
  List<Map<String, Object?>>? _params(String owner, List<FormalParameterElement> ps) {
    final out = <Map<String, Object?>>[];
    for (final p in ps) {
      final t = _type(p.type, '$owner(${p.displayName})');
      if (t == null) {
        // _type filed the skipped entry
        if (!p.isOptional) return null;
        continue;
      }
      out.add({
        'name': p.name,
        'type': t,
        'named': p.isNamed,
        'required': !p.isOptional,
        // for optional non-nullable params the generated adapter re-applies
        // the default when JS omitted the argument (raw source text, in the
        // package's own scope — qualified by the generator via `types`)
        if (p.isOptional && p.defaultValueCode != null)
          'default': p.defaultValueCode,
      });
    }
    return out;
  }

  /// The dump grammar. Returns null for "cannot cross" — after filing a
  /// `skipped` entry. This never throws on a weird type.
  Map<String, Object?>? _type(DartType t, String where) {
    final n = t.nullabilitySuffix == NullabilitySuffix.question;
    Map<String, Object?> tag(Map<String, Object?> raw) => n ? {...raw, 'n': true} : raw;

    if (t is VoidType) return tag({'k': 'void'});
    if (t is DynamicType) return tag({'k': 'any'});
    if (t is InvalidType) {
      _skip(where, 'unresolvable type (missing import?)');
      return null;
    }
    if (t.isDartCoreBool) return tag({'k': 'bool'});
    if (t.isDartCoreString) return tag({'k': 'string'});
    if (t.isDartCoreInt) return tag({'k': 'int'});
    if (t.isDartCoreDouble || t.isDartCoreNum) {
      // one tag for both: JS numbers are float64 on the wire either way
      return tag({'k': 'num'});
    }
    if (t.isDartCoreList) {
      final args = t is InterfaceType ? t.typeArguments : const <DartType>[];
      final e = args.isNotEmpty ? _type(args[0], '$where<List>') : null;
      if (e == null) return null; // _type filed the reason
      return tag({'k': 'list', 'e': e});
    }
    if (t.isDartCoreMap) {
      final args = t is InterfaceType ? t.typeArguments : const <DartType>[];
      if (args.length < 2) {
        _skip(where, 'map without type arguments');
        return null;
      }
      if (_display(args[0]) != 'String') {
        _skip(where, 'map key must be String, got ${_display(args[0])}');
        return null;
      }
      final v = _type(args[1], '$where<Map>');
      if (v == null) return null;
      return tag({'k': 'map', 'v': v});
    }
    if (t.isDartAsyncFuture || t.isDartAsyncFutureOr) {
      final args = t is InterfaceType ? t.typeArguments : const <DartType>[];
      if (args.isEmpty || _display(args[0]) == 'void') {
        return tag({'k': 'future', 't': {'k': 'void'}});
      }
      final v = _type(args[0], '$where<Future>');
      if (v == null) return null;
      return tag({'k': 'future', 't': v});
    }
    if (t is FunctionType) return tag(_callable(t, where));
    if (t is InterfaceType) {
      final element = t.element;
      final pkg = _packageOf(element);
      if (pkg != null && packages.contains(pkg)) {
        return tag({'k': 'cls', 'pkg': pkg, 'name': element.displayName});
      }
      _skip(where, 'unsupported type ${_display(t)}');
      return null;
    }
    _skip(where, 'unsupported type ${_display(t)}');
    return null;
  }

  /// A function type with its signature: the adapter needs the arity to wrap
  /// a JS function into a Dart closure, and the d.ts needs the types
  /// (specs/201). Anything the closure cannot model — named/optional
  /// parameters, a parameter or return type that cannot cross — widens to
  /// the bare `cb` (the old behaviour) with one note, rather than dropping
  /// the whole member: a callback's real arguments are JS values anyway.
  Map<String, Object?> _callable(FunctionType t, String where) {
    final mark = skipped.length; // inner types file skips while probing
    final params = <Map<String, Object?>>[];
    String? widen;
    for (final p in t.formalParameters) {
      if (p.isNamed || p.isOptional) {
        widen = 'named/optional parameter "${p.displayName}"';
        break;
      }
      final pt = _type(p.type, '$where(fn param)');
      if (pt == null) {
        widen = 'parameter type ${_display(p.type)}';
        break;
      }
      params.add({'name': p.name, 'type': pt});
    }
    Map<String, Object?>? ret;
    if (widen == null) {
      ret = _type(t.returnType, '$where(fn return)');
      if (ret == null) widen = 'return type ${_display(t.returnType)}';
    }
    if (widen != null) {
      skipped.removeRange(mark, skipped.length);
      _skip(where, 'callback signature widened — $widen');
      return {'k': 'cb'};
    }
    return {'k': 'cb', 'params': params, 'ret': ret};
  }

  String? _packageOf(Element element) {
    final uri = element.library?.identifier ?? '';
    final m = RegExp('^package:([^/]+)/').firstMatch(uri);
    return m?.group(1);
  }

  String _display(DartType t) => t.getDisplayString();

  void _skip(String what, String why) {
    skipped.add({'what': what, 'why': why});
  }
}
