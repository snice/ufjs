// fjs.autoimport — bind a pub package's public API to the object ABI by
// configuration (specs/160).
//
//   { "fjs": { "autoimport": ["mmkv"] } }
//
// The pipeline has two halves that meet at a JSON dump in
// `.fjs/autoimport/<package>.api.json`:
//
//   dart side   fjs_introspect (analyzer, a host dev_dependency) resolves
//               the package's main library and dumps top-level classes and
//               functions as tagged types — the grammar is the contract,
//               documented in specs/160 and mirrored in the Dart tool.
//   node side   this file: caches dumps (keyed by the autoimport list plus
//               the host's pubspec.lock hash), then generates the host's
//               `lib/fjs_objects.dart` (FjsObjectModule adapters, wired via
//               fjsRegisterObjects) and `src/fjs-objects.d.ts` (typed
//               dartModule keys through FjsObjectModules declaration
//               merging).
//
// Runtime behaviour is exactly specs/159 — an autoimported package is just
// an object module whose adapter nobody had to write. Members whose types
// cannot cross the ABI are SKIPPED and listed in the build output
// (constitution V): for a third-party package that is the difference
// between usable and unusable.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// ---- dump grammar (the fjs_introspect <-> generator contract) -------------

export interface FjsType {
  k: 'int' | 'num' | 'bool' | 'string' | 'void' | 'any' |
     'list' | 'map' | 'future' | 'cls' | 'cb' | 'unsupported';
  /** nullable (Dart `T?`) */
  n?: boolean;
  /** list element / future value / map value / setter type */
  e?: FjsType;
  t?: FjsType;
  v?: FjsType;
  /** for cls: the declaring package + class name */
  pkg?: string;
  name?: string;
  /** for unsupported: the Dart type that could not cross */
  dart?: string;
}

export interface FjsParam {
  name: string;
  type: FjsType;
  named?: boolean;
  required?: boolean;
  /** Raw source text of a non-nullable optional parameter's default (in the
   * package's own scope — qualified with the import prefix at emit time).
   * The adapter re-applies it when JS omitted the argument. */
  default?: string;
}

export interface FjsMember {
  name: string;
  params: FjsParam[];
  returns: FjsType;
  isSetter?: boolean;
}

export interface FjsConstructor {
  params: FjsParam[];
}

export interface FjsClass {
  name: string;
  constructors: FjsConstructor[];
  statics: FjsMember[];
  methods: FjsMember[];
  getters: { name: string; returns: FjsType }[];
  setters: { name: string; type: FjsType }[];
}

export interface ApiDump {
  package: string;
  entry: string;
  /** Every public top-level type name, for qualifying default expressions. */
  types?: string[];
  classes: FjsClass[];
  functions: FjsMember[];
  skipped: { what: string; why: string }[];
}

export function parseApiDump(json: string): ApiDump {
  const dump = JSON.parse(json) as ApiDump;
  if (!dump.package || !Array.isArray(dump.classes)) {
    throw new Error(`fjs autoimport: dump is not an ApiDump (package/missing classes)`);
  }
  return dump;
}

// ---- configuration ---------------------------------------------------------

/** One autoimport entry: a pub package name with an optional version
 * constraint (`"mmkv@^2.4.0"`). A bare name resolves to any version. */
export interface AutoimportPackage {
  name: string;
  /** Raw pubspec version constraint, or undefined for any. */
  version?: string;
}

/** Parses `"name" | "name@constraint"` — the constraint text goes into the
 * pubspec verbatim, so every pub syntax works (`^2.4.0`, `2.4.2`, `>=1 <3`). */
export function parseAutoimportEntry(entry: string): AutoimportPackage {
  const at = entry.indexOf('@');
  if (at < 0) return { name: entry };
  const name = entry.slice(0, at);
  const version = entry.slice(at + 1);
  if (!name || !version) {
    throw new Error(
      `fjs.autoimport: malformed entry "${entry}" (expected name or name@version)`,
    );
  }
  return { name, version };
}

/** The host's `fjs.autoimport` list. */
export function readAutoimport(root: string): AutoimportPackage[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      fjs?: { autoimport?: unknown };
    };
    const list = pkg.fjs?.autoimport;
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.some((e) => typeof e !== 'string')) {
      throw new Error(
        'fjs.autoimport must be an array of "name" or "name@version" strings',
      );
    }
    return (list as string[]).map(parseAutoimportEntry);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

export const OBJECT_TYPES_FILE = path.join('src', 'fjs-objects.d.ts');

export function autoimportCacheDir(root: string): string {
  return path.join(root, '.fjs', 'autoimport');
}

export function dumpCachePath(root: string, pkg: string): string {
  return path.join(autoimportCacheDir(root), `${pkg}.api.json`);
}

/** Cache key: the autoimport list plus the host's resolved pubspec.lock.
 * Changing the package set re-dumps; a lock change (version bump) does too.
 * A package that changed WITHOUT a lock change needs `fjs autoimport --force`
 * — documented, and the same trade-off `flutter pub get` makes. */
export function autoimportHash(root: string, packages: AutoimportPackage[]): string {
  const lock = path.join(root, 'pubspec.lock');
  const lockText = fs.existsSync(lock) ? fs.readFileSync(lock, 'utf8') : '';
  return createHash('sha256').update(JSON.stringify(packages) + lockText).digest('hex').slice(0, 16);
}

/** The generated entry file fjs_introspect analyzes: one prefixed import
 * per package forces the analyzer to resolve the main library through the
 * full export chain. */
export function introspectEntrySource(packages: AutoimportPackage[]): string {
  const imports = packages
    .map((p, i) => `import 'package:${p.name}/${p.name}.dart' as p${i};\n`)
    .join('');
  return `// generated by fjs autoimport — do not edit.
//
// fjs_introspect analyzes this file to resolve each autoimported package's
// main library. Regenerated on every sync; harmless to keep around.
${imports}
void fjsIntrospectEntry() {} // references nothing; the imports do the work
`;
}

/** The dump tool invocation, run with cwd = the isolated tool package (the
 * analyzed host arrives via --root). */
export function introspectArgs(packages: AutoimportPackage[], outDir: string): string[] {
  const args = ['run', 'fjs_introspect'];
  for (const p of packages) args.push('--package', p.name);
  args.push('--out', outDir);
  return args;
}

// ---- generation (pure: dump[] -> source strings) ---------------------------

/** Qualifies a default-value expression (written in the package's own
 * scope) with the generated import prefix: every dumped top-level type
 * name gets the prefix, so `MMKVMode.SINGLE_PROCESS_MODE` becomes
 * `p0.MMKVMode.SINGLE_PROCESS_MODE`. */
function qualifyDefaults(code: string, dump: ApiDump, prefix: string): string {
  let out = code;
  for (const name of dump.types ?? []) {
    out = out.replace(new RegExp(`(?<![.\\w])${name}\\b`, 'g'), `${prefix}.${name}`);
  }
  return out;
}

function pascal(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}

function moduleInterfaceName(pkg: string): string {
  return `${pascal(pkg)}Module`;
}

/** The decode expression for one call argument: JS numbers arrive as
 * float64 tags (so `as int` would throw — go through num), lists/maps
 * cannot cross as arguments in v1 (skipped upstream), object refs arrive
 * as their live Dart instance. */
function dartArgExpr(type: FjsType, index: number, pkg: string, prefix: string,
                     optional = false, defaultValue?: string): string | null {
  // optional parameters may be absent from the JS call. A nullable one
  // answers null; a non-nullable one re-applies its declared default (the
  // raw source text from the dump, qualified via the package's type names)
  // — passing null to a non-nullable parameter would not even compile.
  const hasDefault = optional && defaultValue !== undefined;
  const nullable = type.n || (optional && !hasDefault);
  const raw = `args[${index}]`;
  const arg = optional
      ? `(args.length > ${index} ? ${raw} : ${hasDefault ? defaultValue : 'null'})`
      : raw;
  switch (type.k) {
    case 'string': return `${arg} as String${nullable ? '?' : ''}`;
    case 'bool': return `${arg} as bool${nullable ? '?' : ''}`;
    // JS numbers cross as float64 tags — `as int` would throw, go via num;
    // nullable params must cast nullable or a null argument throws early
    case 'int': return nullable ? `(${arg} as num?)?.toInt()` : `(${arg} as num).toInt()`;
    case 'num': return nullable ? `(${arg} as num?)?.toDouble()` : `(${arg} as num).toDouble()`;
    case 'any': return arg;
    case 'cb': return `${arg} as FjsCallback`;
    case 'cls':
      if (type.pkg === pkg && type.name) {
        return `${arg} as ${prefix}.${type.name}${nullable ? '?' : ''}`;
      }
      return null; // cross-package object refs: not boundable this run
    default:
      return null; // list/map/future params, unsupported: skip the member
  }
}

function dartReturnStmt(expr: string, returns: FjsType, indent = '        '): string {
  if (returns.k === 'void' && !returns.n) return `${expr};\n${indent}return null;`;
  return `return ${expr};`;
}

/** Module-level binding names: classes by name, static methods and
 * top-level functions flattened (a static factory `MMKV.defaultMMKV()` is
 * how mmkv hands out instances — JS writes `m.defaultMMKV()`). `$` joins
 * when a bare name is taken. */
export function moduleBindings(dump: ApiDump): Map<string, { kind: 'class' | 'member'; cls?: FjsClass; member?: FjsMember }> {
  const bindings = new Map<string, { kind: 'class' | 'member'; cls?: FjsClass; member?: FjsMember }>();
  const put = (name: string, v: { kind: 'class' | 'member'; cls?: FjsClass; member?: FjsMember }) => {
    if (!bindings.has(name)) bindings.set(name, v);
  };
  // priority: classes own their names first, then statics, then top-level
  // functions — a first-come rule the d.ts generator mirrors exactly
  for (const cls of dump.classes) {
    if (cls.constructors.length > 0) put(cls.name, { kind: 'class', cls });
  }
  for (const cls of dump.classes) {
    for (const stat of cls.statics) {
      const bare = stat.name;
      put(bindings.has(bare) ? `${cls.name}$${stat.name}` : bare, {
        kind: 'member', cls, member: stat,
      });
    }
  }
  for (const fn of dump.functions) {
    put(bindings.has(fn.name) ? `${fn.name}$fn` : fn.name, { kind: 'member', member: fn });
  }
  return bindings;
}

function isBindableReturn(t: FjsType, pkg: string): boolean {
  switch (t.k) {
    case 'void': case 'int': case 'num': case 'bool': case 'string':
    case 'any': case 'cb':
      return true;
    case 'cls':
      return t.pkg === pkg && !!t.name;
    case 'future':
      return t.t ? isBindableReturn(t.t, pkg) : false;
    case 'list':
      return t.e ? isBindableReturn(t.e, pkg) : true;
    case 'map':
      return t.v ? isBindableReturn(t.v, pkg) : true;
    default:
      return false; // unsupported params/returns: skip
  }
}

function bindableParams(params: FjsParam[], pkg: string, prefix: string): FjsParam[] | null {
  for (const p of params) {
    const optional = p.required === false;
    if (dartArgExpr(p.type, 0, pkg, prefix, optional) === null) {
      if (!optional) return null; // a required unbindable param skips the member
      // an optional one is omitted from the call instead
    }
  }
  return params;
}

/** Generated `lib/fjs_objects.dart`: one FjsObjectModule per autoimported
 * package. Only members whose full signature is bindable appear; the rest
 * were already listed by the dump's `skipped` + the generator's own pass. */
/** One call-site argument: named parameters pass by name (JS supplies them
 * positionally in declaration order — the d.ts says exactly that). */
function dartCallArgs(params: FjsParam[], dump: ApiDump, prefix: string): string | null {
  const parts: string[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const optional = p.required === false;
    let expr = dartArgExpr(p.type, i, dump.package, prefix, optional, p.default);
    if (expr === null) {
      if (optional) continue; // omitted: the Dart default applies
      return null; // a required unbindable param skips the whole member
    }
    if (optional && p.default !== undefined) {
      expr = qualifyDefaults(expr, dump, prefix);
    }
    if (expr === null) {
      if (optional) continue; // omitted: the Dart default applies
      return null; // a required unbindable param skips the whole member
    }
    parts.push(p.named ? `${p.name}: ${expr}` : expr);
  }
  return parts.join(', ');
}

export function dartAdapterSource(dumps: ApiDump[]): string | null {
  if (dumps.length === 0) return null;
  const prefixOf = new Map(dumps.map((d, i) => [d.package, `p${i}`] as const));
  const imports = dumps
    .map((d, i) => `import 'package:${d.package}/${d.package}.dart' as p${i};\n`)
    .join('');
  const registrations = dumps
    .map((d) => `  engine.objects.registerModule('${d.package}', const _${moduleInterfaceName(d.package)}());\n`)
    .join('');
  const classes = dumps.map((dump) => {
    const pkg = dump.package;
    const prefix = prefixOf.get(pkg)!; // built from the same dumps
    const clsName = `_${moduleInterfaceName(pkg)}`;
    const ctor = dump.classes.some((c) => c.constructors.length > 0) || dump.classes.length > 0;

    // construct: classes by name, then the flattened module-level members
    const bindings = moduleBindings(dump);
    const constructCases: string[] = [];
    for (const [name, binding] of bindings) {
      if (binding.kind === 'class' && binding.cls) {
        const c = binding.cls.constructors[0];
        const params = bindableParams(c?.params ?? [], pkg, prefix);
        if (!params) continue; // unbindable constructor: class not constructable
        const expr = `${prefix}.${binding.cls.name}(${dartCallArgs(params, dump, prefix)})`;
        constructCases.push(`      case '${name}':\n        ${dartReturnStmt(expr, { k: 'cls', pkg, name: binding.cls.name })}`);
      } else if (binding.member) {
        const m = binding.member;
        const params = bindableParams(m.params, pkg, prefix);
        if (!params || !isBindableReturn(m.returns, pkg)) continue;
        const owner = binding.cls; // set for static methods, absent for top-level functions
        const target = owner ? `${prefix}.${owner.name}.${m.name}` : `${prefix}.${m.name}`;
        const expr = `${target}(${dartCallArgs(params, dump, prefix)})`;
        constructCases.push(`      case '${name}':\n        ${dartReturnStmt(expr, m.returns)}`);
      }
    }

    const invokeCases: string[] = [];
    const getCases: string[] = [];
    const setCases: string[] = [];
    for (const cls of dump.classes) {
      const guardOpen = `      case ${prefix}.${cls.name} self:\n        switch (member) {`;
      const body: string[] = [];
      for (const m of cls.methods) {
        const params = bindableParams(m.params, pkg, prefix);
        if (!params || !isBindableReturn(m.returns, pkg)) continue;
        const expr = `self.${m.name}(${dartCallArgs(params, dump, prefix)})`;
        body.push(`          case '${m.name}':\n            ${dartReturnStmt(expr, m.returns, '            ')}`);
      }
      for (const g of cls.getters) {
        if (!isBindableReturn(g.returns, pkg)) continue;
        body.push(`          case '${g.name}':\n            return self.${g.name};`);
      }
      if (body.length > 0) {
        invokeCases.push(`${guardOpen}\n${body.join('\n')}\n        }`);
      }
      const getBody = cls.getters
        .filter((g) => isBindableReturn(g.returns, pkg))
        .map((g) => `          case '${g.name}':\n            return self.${g.name};`);
      if (getBody.length > 0) {
        getCases.push(`${guardOpen}\n${getBody.join('\n')}\n        }`);
      }
      const setBody = cls.setters
        .filter((s) => bindableParams([s], pkg, prefix) !== null)
        .map((s) => `          case '${s.name}':\n            self.${s.name} = ${dartArgExpr(s.type, 0, pkg, prefix, false)};\n            return;`);
      if (setBody.length > 0) {
        setCases.push(`${guardOpen}\n${setBody.join('\n')}\n        }`);
      }
    }

    const ctorBlock = ctor
      ? `  @override
  Object? construct(String className, List<Object?> args) {
    switch (className) {
${constructCases.join('\n')}
    }
    throw StateError('${pkg} has no binding "\$className" (not generated — see fjs autoimport output)');
  }
`
      : '';
    return `class ${clsName} extends FjsObjectModule {
  const ${clsName}();

${ctorBlock}  @override
  Object? invoke(Object instance, String member, List<Object?> args) {
    switch (instance) {
${invokeCases.join('\n')}
    }
    throw StateError('${pkg}: no binding "\$member" (not generated — see fjs autoimport output)');
  }

  @override
  Object? get(Object instance, String member) {
    switch (instance) {
${getCases.join('\n')}
    }
    return FjsMethod.instance;
  }
${setCases.length > 0 ? `
  @override
  void set(Object instance, String member, Object? value) {
    switch (instance) {
${setCases.join('\n')}
    }
  }
` : ''}}
`;
  });

  return `// generated by fjs autoimport — do not edit.
//
// Adapters binding the fjs.autoimport packages' public API to the object
// ABI (specs/159/160). Regenerated from .fjs/autoimport/*.api.json by
// \`fjs autoimport\` / \`fjs run\`; main.dart reaches this through
// fjsRegisterModules -> fjsRegisterObjects.
import 'package:flutter_fjs/flutter_fjs.dart';
${imports}
void fjsRegisterObjects(FjsEngine engine) {
${registrations}}

${classes.join('\n')}`;
}

// ---- TS types --------------------------------------------------------------

function tsType(t: FjsType, pkg: string): string {
  const base = ((): string => {
    switch (t.k) {
      case 'int': case 'num': return 'number';
      case 'bool': return 'boolean';
      case 'string': return 'string';
      case 'void': return 'void';
      case 'any': return 'unknown';
      case 'cb': return '(...args: never[]) => unknown';
      case 'cls': return t.name ?? 'unknown';
      case 'list': return `Array<${t.e ? tsType(t.e, pkg) : 'unknown'}>`;
      case 'map': return `Record<string, ${t.v ? tsType(t.v, pkg) : 'unknown'}>`;
      case 'future': return `Promise<${t.t ? tsType(t.t, pkg) : 'void'}>`;
      default: return 'never';
    }
  })();
  return t.n ? `${base} | null` : base;
}

function tsParams(params: FjsParam[], pkg: string): string {
  return params
    .map((p) => {
      const opt = !p.required ? '?' : '';
      return `${p.name}${opt}: ${tsType(p.type, pkg)}`;
    })
    .join(', ');
}

/** Generated `src/fjs-objects.d.ts`: the module interfaces plus the
 * FjsObjectModules augmentation that makes `dartModule('mmkv')` typed. */
export function objectTypesSource(dumps: ApiDump[]): string | null {
  if (dumps.length === 0) return null;
  const blocks: string[] = [];
  const entries: string[] = [];
  for (const dump of dumps) {
    const pkg = dump.package;
    const modName = moduleInterfaceName(pkg);
    const lines: string[] = [];
    const ctorNames = new Set<string>(); // Ctor interfaces actually emitted
    for (const cls of dump.classes) {
      const members: string[] = [];
      for (const g of cls.getters) {
        if (!isBindableReturn(g.returns, pkg)) continue;
        members.push(`  readonly ${g.name}: ${tsType(g.returns, pkg)};`);
      }
      for (const m of cls.methods) {
        const params = bindableParams(m.params, pkg, pkg);
        if (!params || !isBindableReturn(m.returns, pkg)) continue;
        members.push(`  ${m.name}(${tsParams(params, pkg)}): ${tsType(m.returns, pkg)};`);
      }
      for (const s of cls.setters) {
        if (dartArgExpr(s.type, 0, pkg, pkg) === null) continue;
        members.push(`  ${s.name}: ${tsType(s.type, pkg)};`);
      }
      if (members.length === 0 && cls.constructors.length === 0) continue;
      if (members.length > 0) {
        lines.push(`export interface ${cls.name} {\n${members.join('\n')}\n}`);
      }
      if (cls.constructors.length > 0) {
        const params = bindableParams(cls.constructors[0].params, pkg, pkg);
        if (params) {
          // a CALL signature, not `new`: module members are plain functions
          // over the construct op — `new m.MMKV()` would crash at runtime
          lines.push(`export interface ${cls.name}Ctor {\n  (${tsParams(params, pkg)}): ${cls.name};\n}`);
          ctorNames.add(cls.name);
        }
      }
    }
    const moduleMembers: string[] = [];
    const bindings = moduleBindings(dump);
    for (const [name, binding] of bindings) {
      const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
      if (binding.kind === 'class' && binding.cls) {
        // mirrors the Dart side: a class entry exists only when its
        // constructor was bindable
        if (!ctorNames.has(binding.cls.name)) continue;
        moduleMembers.push(`  ${key}: ${binding.cls.name}Ctor;`);
      } else if (binding.member) {
        const m = binding.member;
        const params = bindableParams(m.params, pkg, pkg);
        if (!params || !isBindableReturn(m.returns, pkg)) continue;
        moduleMembers.push(`  ${key}(${tsParams(params, pkg)}): ${tsType(m.returns, pkg)};`);
      }
    }
    if (moduleMembers.length === 0) continue;
    lines.push(`export interface ${modName} {\n${moduleMembers.join('\n')}\n}`);
    blocks.push(lines.join('\n\n'));
    entries.push(`    ${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(pkg) ? pkg : JSON.stringify(pkg)}: ${modName};`);
  }
  if (blocks.length === 0) return null;
  return `// generated by fjs autoimport — do not edit.
//
// Types for the fjs.autoimport packages, merged into dartModule's key
// lookup (specs/160). Regenerated from .fjs/autoimport/*.api.json.

declare module '@ufjs/runtime' {
  interface FjsObjectModules {
${entries.join('\n')}
  }
}

${blocks.join('\n\n')}
`;
}

/** The isolated tool package where fjs_introspect runs: its analyzer must
 * NEVER join the host's dependency graph — the Flutter SDK pins packages
 * (meta, …) that newer analyzers outgrow, and the version fight would make
 * autoimport unusable on half the SDKs out there. Materialized under
 * `.fjs/autoimport-tool/`, resolved and run with its own pubspec; the host
 * only ever sees the autoimported packages themselves. */
export const TOOL_DIR = path.join('.fjs', 'autoimport-tool');

function findRepoPackage(name: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', '..', '..', name),
    path.resolve(here, '..', '..', '..', 'packages', name),
    path.resolve(process.cwd(), 'packages', name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'pubspec.yaml'))) return candidate;
  }
  return null;
}

/** The tool package's pubspec: a checkout resolves fjs_introspect by path,
 * a published CLI by pub version — the same rule as flutter_fjs. */
export function toolPubspecSource(): string {
  const tool = findRepoPackage('fjs-introspect');
  const dep = tool
    ? `  fjs_introspect:\n    path: ${tool.split(path.sep).join('/')}\n`
    : '  fjs_introspect: ^0.1.0\n';
  return `# generated by fjs autoimport — do not edit.
#
# Isolated runner for fjs_introspect: kept OUT of the host's dependency
# graph on purpose (its analyzer must not fight the Flutter SDK's pins).
name: fjs_autoimport_tool
publish_to: 'none'
version: 0.1.0

environment:
  sdk: ^3.11.0

dependencies:
${dep}`;
}

/** Idempotently adds `name: <constraint>` under the pubspec's [section];
 * an existing line for [name] is REWRITTEN when it differs (a bare `mmkv:`
 * from an earlier run upgrades to the configured constraint). */
function ensurePubspecEntry(pubspec: string, section: 'dependencies' | 'dev_dependencies', name: string, entry: string): void {
  let text = fs.readFileSync(pubspec, 'utf8');
  const line = new RegExp(`^  ${name}:.*$`, 'm');
  const existing = line.exec(text);
  if (existing) {
    const wanted = entry.replace(/\n$/, '');
    if (existing[0] !== wanted) {
      text = text.replace(line, wanted);
      fs.writeFileSync(pubspec, text);
    }
    return;
  }
  const anchor = new RegExp(`^${section}:\\n`, 'm');
  const m = anchor.exec(text);
  if (!m) {
    text += `\n${section}:\n${entry}`;
  } else {
    text = `${text.slice(0, m.index + m[0].length)}${entry}${text.slice(m.index + m[0].length)}`;
  }
  fs.writeFileSync(pubspec, text);
}

export interface SyncAutoimportOptions {
  root: string;
  hostDir: string;
  /** re-dump even when the cache key matches */
  force?: boolean;
  /** stdout reporter, defaults to console.log */
  log?: (line: string) => void;
  /** injected for tests: the dump step */
  runDump?: (args: string[], cwd: string) => void;
  /** defaults to `flutter pub get` in the host; injectable for tests */
  runPubGet?: (cwd: string) => void;
  /** defaults to `dart pub get` in the tool package; injectable for tests */
  runToolPubGet?: (cwd: string) => void;
}

export interface SyncAutoimportResult {
  packages: AutoimportPackage[];
  dumped: boolean;
  skippedMembers: { what: string; why: string }[];
}

/** The full pipeline, run inside the flutter-host sync (`fjs run`). Pure
 * steps are injectable so tests can exercise it without Flutter. */
export function syncAutoimport(opts: SyncAutoimportOptions): SyncAutoimportResult {
  const { root, hostDir, force = false } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));
  const packages = readAutoimport(root);
  const skippedMembers: { what: string; why: string }[] = [];

  const pubspec = path.join(hostDir, 'pubspec.yaml');
  if (packages.length > 0 && fs.existsSync(pubspec)) {
    // the host takes the autoimported packages and NOTHING else — the dump
    // tool lives in TOOL_DIR, outside this dependency graph
    for (const pkg of packages) {
      const constraint = pkg.version ?? '';
      // `name:` (any) when no version was configured, `name: ^2.4.0` otherwise
      ensurePubspecEntry(
        pubspec,
        'dependencies',
        pkg.name,
        constraint ? `  ${pkg.name}: ${constraint}\n` : `  ${pkg.name}:\n`,
      );
    }
    const entry = path.join(hostDir, 'lib', 'fjs_introspect_entry.dart');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, introspectEntrySource(packages));
  }

  const toolDir = path.join(root, TOOL_DIR);
  const toolPubspec = path.join(toolDir, 'pubspec.yaml');
  const toolSource = toolPubspecSource();
  const toolReady =
    fs.existsSync(toolPubspec) && fs.readFileSync(toolPubspec, 'utf8') === toolSource;
  if (packages.length > 0 && !toolReady) {
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(toolPubspec, toolSource);
    opts.runToolPubGet?.(toolDir) ??
      (() => {
        const r = spawnSync('dart', ['pub', 'get'], { cwd: toolDir, stdio: 'inherit' });
        if (r.status !== 0) {
          throw new Error(
            'fjs autoimport: tool `dart pub get` failed — the bundled analyzer needs ' +
              'a Dart SDK new enough for it (see docs/modules.md troubleshooting)',
          );
        }
      })();
  }

  const keyFile = path.join(autoimportCacheDir(root), 'key');
  const key = packages.length > 0 ? autoimportHash(root, packages) : '';
  const cached = fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8') === key && key !== '';
  const dumped = !cached || force;

  if (dumped && packages.length > 0) {
    const runPubGet =
      opts.runPubGet ??
      ((cwd: string) => {
        const r = spawnSync('flutter', ['pub', 'get'], { cwd, stdio: 'inherit' });
        if (r.status !== 0) throw new Error('fjs autoimport: flutter pub get failed');
      });
    runPubGet(hostDir);
    // absolute --root/--out: the dump runs from the tool package's directory
    const args = introspectArgs(packages, path.resolve(root, autoimportCacheDir(root)));
    args.push('--root', path.resolve(hostDir));
    (opts.runDump ?? ((a, cwd) => {
      const r = spawnSync('dart', a, { cwd, stdio: 'inherit' });
      if (r.status !== 0) {
        throw new Error(`fjs autoimport: dump failed (dart ${a.join(' ')})`);
      }
    }))(args, toolDir);
    fs.mkdirSync(autoimportCacheDir(root), { recursive: true });
    fs.writeFileSync(keyFile, key);
  }

  const dumps: ApiDump[] = [];
  for (const pkg of packages) {
    const file = dumpCachePath(root, pkg.name);
    if (!fs.existsSync(file)) continue;
    const dump = parseApiDump(fs.readFileSync(file, 'utf8'));
    dumps.push(dump);
    skippedMembers.push(...dump.skipped);
  }

  const libDir = path.join(hostDir, 'lib');
  if (fs.existsSync(libDir)) {
    const adapter = path.join(libDir, 'fjs_objects.dart');
    const source = dumps.length > 0 ? dartAdapterSource(dumps) : null;
    if (source === null) {
      if (fs.existsSync(adapter)) fs.rmSync(adapter);
    } else {
      fs.writeFileSync(adapter, source);
    }
  }

  if (dumps.length > 0) {
    for (const why of skippedMembers) log(`autoimport: skipped ${why.what} — ${why.why}`);
  }
  return { packages, dumped, skippedMembers };
}

/** The dumps currently in the cache, sorted by package name (stable
 * generated output). Empty when nothing was ever dumped on this machine. */
export function loadCachedDumps(root: string): ApiDump[] {
  const dir = autoimportCacheDir(root);
  const dumps: ApiDump[] = [];
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith('.api.json')) continue;
      dumps.push(parseApiDump(fs.readFileSync(path.join(dir, entry), 'utf8')));
    }
  }
  return dumps;
}

/** Writes `src/fjs-objects.d.ts` from the CACHED dumps (no dart involved —
 * this runs on `fjs types` and at dev-server start, including web-only
 * projects). */
export function writeAutoimportTypes(root: string): void {
  const dumps = loadCachedDumps(root);
  const target = path.join(root, OBJECT_TYPES_FILE);
  const source = objectTypesSource(dumps);
  if (source === null) {
    if (fs.existsSync(target)) fs.rmSync(target);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}
