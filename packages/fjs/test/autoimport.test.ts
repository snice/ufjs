// autoimport generators (specs/160): the fixture dump (mmkv.api.json) is
// the REAL dump of the real pub package (captured by fjs_introspect in the
// specs/160 e2e), so these tests pin the generated Dart adapter and TS
// declarations against what actual third-party APIs produce — named
// optional params, enum-typed options omitted by default, etc. The
// callback-tag branch and the `$` disambiguation use small inline dumps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  autoimportHash,
  autoimportPubspecEntry,
  readAutoimport,
  syncAutoimport,
  validateLocalPackage,
  dartAdapterSource,
  introspectEntrySource,
  moduleBindings,
  objectTypesSource,
  parseApiDump,
  parseAutoimportEntry,
  type ApiDump,
} from '../src/project/autoimport.js';

const fixture: ApiDump = parseApiDump(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'mmkv.api.json'), 'utf8'),
);

describe('dartAdapterSource (real mmkv dump)', () => {
  const source = dartAdapterSource([fixture])!;

  it('registers one module per package and imports it prefixed', () => {
    expect(source).toContain("import 'package:mmkv/mmkv.dart' as p0;");
    expect(source).toContain("engine.objects.registerModule('mmkv', const _MmkvModule());");
  });

  it('binds the class constructor: required positional + qualified defaults', () => {
    // mode is an optional enum-typed option — omitted when JS does not pass
    // it, and the Dart default is re-applied, package-qualified
    expect(source).toContain(
      "case 'MMKV':\n" +
        '        return p0.MMKV(args[0] as String, ' +
        'mode: (args.length > 1 ? args[1] : p0.MMKVMode.SINGLE_PROCESS_MODE) as p0.MMKVMode, ',
    );
  });

  it('passes named params by name with guarded optional access', () => {
    expect(source).toContain(
      'self.encodeString(args[0] as String, args[1] as String?, ' +
        '((args.length > 2 ? args[2] : null) as num?)?.toInt());',
    );
    // defaultValue is an optional non-nullable bool with default false: the
    // adapter re-applies the default instead of passing a null
    expect(source).toContain(
      'self.decodeBool(args[0] as String, defaultValue: (args.length > 1 ? args[1] : false) as bool);',
    );
  });

  it('flattens static factories into module-level bindings', () => {
    expect(source).toContain(
      "case 'defaultNameSpace':\n        return p0.MMKV.defaultNameSpace();",
    );
  });

  it('exposes getters as fields and falls back to FjsMethod.instance', () => {
    expect(source).toContain("case 'allKeys':\n            return self.allKeys;");
    expect(source).toContain('return FjsMethod.instance;');
  });

  it('keeps unbindable members out of the generated switches', () => {
    // the enum-typed option is omitted from the call, never cast
    expect(source).not.toContain('as p0.MMKVLogLevel');
    // Uint8List-shaped members are skipped entirely
    expect(source).not.toContain('asList');
  });

  it('produces no file for an empty autoimport set', () => {
    expect(dartAdapterSource([])).toBeNull();
  });
});

describe('objectTypesSource (real mmkv dump)', () => {
  const source = objectTypesSource([fixture])!;

  it('merges the module key into FjsObjectModules', () => {
    expect(source).toContain('interface FjsObjectModules {\n    mmkv: MmkvModule;\n  }');
  });

  it('types the class with nullable members and a call-signature ctor', () => {
    expect(source).toContain('decodeString(key: string): string | null;');
    expect(source).toContain('(mmapID: string, mode?: MMKVMode');
  });

  it('flattens static factories into the module interface', () => {
    expect(source).toContain('defaultNameSpace(): NameSpace;');
  });

  it('lists list answers as real arrays (FJS_T_JSON materializes them)', () => {
    expect(source).toContain('readonly allKeys: Array<string>;');
  });

  it('produces no file for an empty autoimport set', () => {
    expect(objectTypesSource([])).toBeNull();
  });
});

describe('dartAdapterSource (synthetic: callback tag)', () => {
  const dump: ApiDump = {
    package: 'x',
    entry: 'package:x/x.dart',
    types: [],
    classes: [
      {
        name: 'A',
        constructors: [{ params: [] }],
        statics: [
          {
            name: 'run',
            params: [{ name: 'cb', type: { k: 'cb' } }],
            returns: { k: 'void' },
          },
        ],
        methods: [],
        getters: [],
        setters: [],
      },
    ],
    functions: [],
    skipped: [],
  };
  const source = dartAdapterSource([dump])!;

  it('encodes function-typed parameters as FjsCallback', () => {
    expect(source).toContain('p0.A.run(args[0] as FjsCallback);');
  });
});

describe('moduleBindings', () => {
  it('flattens statics and functions, disambiguating with $ on collision', () => {
    const dump: ApiDump = {
      package: 'x',
      entry: 'package:x/x.dart',
      classes: [
        {
          name: 'A',
          constructors: [{ params: [] }],
          statics: [{ name: 'create', params: [], returns: { k: 'cls', pkg: 'x', name: 'A' } }],
          methods: [],
          getters: [],
          setters: [],
        },
        {
          name: 'create', // a CLASS named create — collides with the static
          constructors: [{ params: [] }],
          statics: [],
          methods: [],
          getters: [],
          setters: [],
        },
      ],
      functions: [{ name: 'create', params: [], returns: { k: 'string' } }],
      skipped: [],
    };
    const bindings = moduleBindings(dump);
    // A keeps its name; the static owns the bare `create`; the rest get the
    // $-joined forms
    expect([...bindings.keys()].sort()).toEqual(['A', 'A$create', 'create', 'create$fn']);
  });
});

describe('introspectEntrySource', () => {
  it('writes one prefixed import per package', () => {
    const src = introspectEntrySource([{ name: 'mmkv' }, { name: 'other_pkg' }]);
    expect(src).toContain("import 'package:mmkv/mmkv.dart' as p0;");
    expect(src).toContain("import 'package:other_pkg/other_pkg.dart' as p1;");
  });

  it('parses name@version entries and keeps bare names as any', () => {
    expect(parseAutoimportEntry('mmkv')).toEqual({ name: 'mmkv' });
    expect(parseAutoimportEntry('mmkv@^2.4.0')).toEqual({ name: 'mmkv', version: '^2.4.0' });
    expect(parseAutoimportEntry('mmkv@2.4.2')).toEqual({ name: 'mmkv', version: '2.4.2' });
    expect(() => parseAutoimportEntry('@^2.4.0')).toThrow(/malformed/);
    expect(() => parseAutoimportEntry('mmkv@')).toThrow(/malformed/);
  });
});

// ---- local packages and typed callbacks (specs/201) -------------------------

const local: ApiDump = parseApiDump(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'local.api.json'), 'utf8'),
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-autoimport-'));
}

/** A minimal local Dart package under root/dart/<name>. */
function writeLocalPackage(root: string, name: string, body = 'class A {}\n'): void {
  const dir = path.join(root, 'dart', name);
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pubspec.yaml'), `name: ${name}\nenvironment:\n  sdk: ^3.0.0\n`);
  fs.writeFileSync(path.join(dir, 'lib', `${name}.dart`), body);
}

describe('object entries', () => {
  it('parses { name, path } and rejects malformed objects', () => {
    expect(parseAutoimportEntry({ name: 'playground', path: 'dart/playground' })).toEqual({
      name: 'playground',
      path: 'dart/playground',
    });
    expect(() => parseAutoimportEntry({ name: 'x' })).toThrow(/malformed/);
    expect(() => parseAutoimportEntry({ path: 'x' })).toThrow(/malformed/);
    expect(() => parseAutoimportEntry({ name: '', path: 'x' })).toThrow(/malformed/);
  });

  it('reads mixed string and object entries from package.json', () => {
    const root = tmpProject();
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ fjs: { autoimport: ['mmkv@^2.4.2', { name: 'p', path: 'dart/p' }] } }),
    );
    expect(readAutoimport(root)).toEqual([
      { name: 'mmkv', version: '^2.4.2' },
      { name: 'p', path: 'dart/p' },
    ]);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ fjs: { autoimport: [42] } }));
    expect(() => readAutoimport(root)).toThrow(/must be an array/);
  });
});

describe('local package host wiring', () => {
  it('writes a path dependency relative to the host pubspec directory', () => {
    const root = '/proj';
    const entry = autoimportPubspecEntry(root, '/proj/.fjs/flutter', { name: 'playground', path: 'dart/playground' });
    expect(entry).toBe('  playground:\n    path: ../../dart/playground\n');
    expect(autoimportPubspecEntry(root, '/proj/.fjs/flutter', { name: 'mmkv', version: '^2.4.2' })).toBe(
      '  mmkv: ^2.4.2\n',
    );
  });

  it('validates the directory, the pubspec name and the main library', () => {
    const root = tmpProject();
    expect(() => validateLocalPackage(root, { name: 'p', path: 'dart/p' })).toThrow(/no pubspec\.yaml/);
    writeLocalPackage(root, 'p');
    expect(() => validateLocalPackage(root, { name: 'p', path: 'dart/p' })).not.toThrow();
    expect(() => validateLocalPackage(root, { name: 'other', path: 'dart/p' })).toThrow(/does not match/);
    fs.rmSync(path.join(root, 'dart', 'p', 'lib', 'p.dart'));
    expect(() => validateLocalPackage(root, { name: 'p', path: 'dart/p' })).toThrow(/main library lib\/p\.dart/);
  });

  it('keys the cache on the local sources, not only on the lock', () => {
    const root = tmpProject();
    writeLocalPackage(root, 'p');
    const pkgs = [{ name: 'p', path: 'dart/p' }];
    const before = autoimportHash(root, pkgs);
    expect(autoimportHash(root, pkgs)).toBe(before); // stable when nothing changed
    fs.appendFileSync(path.join(root, 'dart', 'p', 'lib', 'p.dart'), 'int f() => 1;\n');
    expect(autoimportHash(root, pkgs)).not.toBe(before);
  });

  it('syncs the host pubspec: adds, stays idempotent, rewrites a pub entry', () => {
    const root = tmpProject();
    writeLocalPackage(root, 'playground');
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ fjs: { autoimport: [{ name: 'playground', path: 'dart/playground' }] } }),
    );
    const hostDir = path.join(root, '.fjs', 'flutter');
    fs.mkdirSync(path.join(hostDir, 'lib'), { recursive: true });
    const pubspec = path.join(hostDir, 'pubspec.yaml');
    // an earlier run (or hand edit) left the pub form behind
    fs.writeFileSync(pubspec, 'name: host\ndependencies:\n  flutter:\n    sdk: flutter\n  playground: ^1.0.0\n  other: ^2.0.0\n');
    const opts = { root, hostDir, log: () => {}, runDump: () => {}, runPubGet: () => {}, runToolPubGet: () => {} };
    syncAutoimport(opts);
    const once = fs.readFileSync(pubspec, 'utf8');
    expect(once).toContain('  playground:\n    path: ../../dart/playground\n');
    expect(once).not.toContain('^1.0.0');
    expect(once).toContain('  other: ^2.0.0'); // neighbours untouched
    syncAutoimport(opts);
    expect(fs.readFileSync(pubspec, 'utf8')).toBe(once);
  });
});

describe('typed callbacks and writable fields (real local dump)', () => {
  const dart = dartAdapterSource([local])!;
  const dts = objectTypesSource([local])!;

  it('wraps a JS function into a closure of the declared arity', () => {
    expect(dart).toContain('self.onTick((a0) => (args[0] as FjsCallback).call([a0]));');
  });

  it('answers a returned Dart closure as a function and types it', () => {
    // JS numbers reach the closure as double: the wrapper converts per the
    // declared parameter type instead of calling `int Function(int)` raw
    expect(dart).toContain(
      "case 'makeAdder':\n        return ((fn) => (Object? a0) => fn((a0 as num).toInt()))(p0.makeAdder((args[0] as num).toInt()));",
    );
    expect(dts).toContain('makeAdder(n: number): (a0: number) => number;');
    expect(dts).toContain('onTick(fn: (a0: number) => void): void;');
  });

  it('writes a field through the setter VALUE and drops readonly for it', () => {
    expect(dart).toContain("case 'step':\n            self.step = (value as num).toInt();");
    expect(dts).toContain('  step: number;');
    expect(dts).not.toContain('readonly step');
    // getter-only members stay readonly, and a field is declared once
    expect(dts).toContain('  readonly value: number;');
    expect(dts.match(/\bstep: number;/g)).toHaveLength(1);
  });

  it('turns module-level Futures into promises', () => {
    expect(dts).toContain('waitFor(ms: number): Promise<number>;');
  });
});

describe('typed callbacks (synthetic)', () => {
  const dump: ApiDump = {
    package: 'x',
    entry: 'package:x/x.dart',
    types: [],
    classes: [
      {
        name: 'A',
        constructors: [{ params: [] }],
        statics: [],
        methods: [
          {
            name: 'ask',
            params: [
              {
                name: 'fn',
                required: true,
                type: { k: 'cb', n: true, params: [{ type: { k: 'string' } }], ret: { k: 'int' } },
              },
              { name: 'wide', required: true, type: { k: 'cb' } },
            ],
            returns: { k: 'void' },
          },
        ],
        getters: [],
        setters: [],
      },
    ],
    functions: [],
    skipped: [],
  };

  it('converts the answer by the declared return type and honours nullability', () => {
    const dart = dartAdapterSource([dump])!;
    expect(dart).toContain(
      'args[0] == null ? null : (a0) => ((args[0] as FjsCallback).call([a0]) as num).toInt()',
    );
    // the pre-201 bare cb keeps its exact output
    expect(dart).toContain('args[1] as FjsCallback');
  });

  it('parenthesizes a nullable function type and keeps the bare one wide', () => {
    const dts = objectTypesSource([dump])!;
    expect(dts).toContain('fn: ((a0: string) => number) | null');
    expect(dts).toContain('wide: (...args: never[]) => unknown');
  });
});
