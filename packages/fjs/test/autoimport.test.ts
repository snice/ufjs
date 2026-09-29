// autoimport generators (specs/160): the fixture dump (mmkv.api.json) is
// the REAL dump of the real pub package (captured by fjs_introspect in the
// specs/160 e2e), so these tests pin the generated Dart adapter and TS
// declarations against what actual third-party APIs produce — named
// optional params, enum-typed options omitted by default, etc. The
// callback-tag branch and the `$` disambiguation use small inline dumps.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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
