// spec 114: fjsc is picked by the engine id the binary reports, never by its
// path or file name — 0.1.4 shipped a quickjs-ng build as bin/fjsc. The fakes
// are sh scripts that mimic fjsc's two outputs: the usage line with
// `engine: <id>` on stderr, and `fjsc: in -> out (N bytes, engine <id>)`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileBytecode, locateFjsc } from '../src/bundler/build';

const PRIMJS = 'primjs-4.1.1';
const QUICKJS = 'quickjs-ng-0.9.0';

let tmp: string;
const savedPath = process.env.FJSC_PATH;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-fjsc-locate-'));
  delete process.env.FJSC_PATH;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (savedPath === undefined) delete process.env.FJSC_PATH;
  else process.env.FJSC_PATH = savedPath;
});

let serial = 0;
/** A fake fjsc at `rel` (under tmp) that reports `usageId` and, when
 * compiling, claims `compiledId` — or prints no engine at all for null. */
function fake(rel: string, usageId: string, compiledId: string | null = usageId): string {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const done = compiledId === null ? 'fjsc: $1 -> $2 (4 bytes)' : `fjsc: $1 -> $2 (4 bytes, engine ${compiledId})`;
  fs.writeFileSync(
    file,
    '#!/bin/sh\n' +
      // a unique line keeps the per-path probe cache honest across tests
      `# ${serial++}\n` +
      'if [ "$#" -ne 2 ]; then\n' +
      '  echo "usage: fjsc <input.js> <output.fjsbundle>" >&2\n' +
      `  echo "  engine: ${usageId} (abi 2)" >&2\n` +
      '  exit 2\n' +
      'fi\n' +
      'printf FJSB > "$2"\n' +
      `echo "${done}"\n`,
  );
  fs.chmodSync(file, 0o755);
  return file;
}

const native = () => path.join(tmp, 'native');
const npm = () => path.join(tmp, 'npm');
const lookup = (npmDir: string | null = npm()) => ({ nativeDirs: [native()], npmDir });

// the fakes are POSIX shell scripts; Windows cannot exec them as fjsc
describe.skipIf(process.platform === 'win32')('locateFjsc (spec 114)', () => {
  it('picks the binary that reports the requested engine', () => {
    const p = fake('native/build-native/fjsc', PRIMJS);
    const q = fake('native/build-native-quickjs/fjsc', QUICKJS);
    expect(locateFjsc('primjs', lookup())).toMatchObject({ path: p, source: 'local build', engineId: PRIMJS });
    expect(locateFjsc('quickjs', lookup())).toMatchObject({ path: q, source: 'local build', engineId: QUICKJS });
  });

  it('never hands a primjs build the quickjs tree, and trusts the binary over the tree name', () => {
    fake('native/build-native-quickjs/fjsc', QUICKJS);
    const found = locateFjsc('primjs', lookup(null));
    expect(found.path).toBeNull();
    // a build-native tree configured for quickjs still serves quickjs
    const q = fake('native/build-native/fjsc', QUICKJS);
    fs.rmSync(path.join(native(), 'build-native-quickjs'), { recursive: true });
    expect(locateFjsc('quickjs', lookup(null)).path).toBe(q);
  });

  it('skips a wrong-flavor checkout and falls through to the npm package', () => {
    fake('native/build-native/fjsc', QUICKJS);
    const p = fake('npm/bin/fjsc', PRIMJS);
    const q = fake('npm/bin/fjsc-quickjs', QUICKJS);
    expect(locateFjsc('primjs', lookup())).toMatchObject({ path: p, source: 'npm' });
    fs.rmSync(path.join(native(), 'build-native'), { recursive: true });
    expect(locateFjsc('quickjs', lookup())).toMatchObject({ path: q, source: 'npm' });
  });

  it('serves quickjs from a pre-114 package, and refuses it for primjs', () => {
    const old = fake('npm/bin/fjsc', QUICKJS);
    expect(locateFjsc('quickjs', lookup())).toMatchObject({ path: old, source: 'npm' });
    expect(locateFjsc('primjs', lookup())).toEqual({ path: null, tried: [{ path: old, engineId: QUICKJS }] });
  });

  it('rejects a wrong-flavor FJSC_PATH instead of falling through', () => {
    fake('native/build-native/fjsc', PRIMJS);
    process.env.FJSC_PATH = fake('elsewhere/fjsc', QUICKJS);
    expect(() => locateFjsc('primjs', lookup())).toThrow(/FJSC_PATH=.* is quickjs-ng-0\.9\.0, but this build targets primjs-4\.1\.1/);
    expect(locateFjsc('quickjs', lookup())).toMatchObject({ path: process.env.FJSC_PATH, source: 'FJSC_PATH' });
  });

  it('names every candidate and its engine when none fits', () => {
    const q = fake('native/build-native-quickjs/fjsc', QUICKJS);
    const old = fake('npm/bin/fjsc', QUICKJS);
    fs.writeFileSync(path.join(tmp, 'x.js'), '1');
    expect(() => compileBytecode(path.join(tmp, 'x.js'), tmp, 'app', 'primjs', lookup())).toThrow(
      new RegExp(`no primjs fjsc found[\\s\\S]*${q} — ${QUICKJS}[\\s\\S]*${old} — ${QUICKJS}`),
    );
  });
});

describe.skipIf(process.platform === 'win32')('compileBytecode engine check (spec 114)', () => {
  it('compiles with the matching fjsc', () => {
    fake('native/build-native/fjsc', PRIMJS);
    fs.writeFileSync(path.join(tmp, 'x.js'), '1');
    const out = compileBytecode(path.join(tmp, 'x.js'), tmp, 'app', 'primjs', lookup(null));
    expect(fs.readFileSync(out, 'utf8')).toBe('FJSB');
  });

  it('removes the bundle when the output names another engine', () => {
    fake('native/build-native/fjsc', PRIMJS, QUICKJS);
    fs.writeFileSync(path.join(tmp, 'x.js'), '1');
    expect(() => compileBytecode(path.join(tmp, 'x.js'), tmp, 'app', 'primjs', lookup(null))).toThrow(
      /compiled app\.fjsbundle for quickjs-ng-0\.9\.0, expected primjs-4\.1\.1; the bundle was removed/,
    );
    expect(fs.existsSync(path.join(tmp, 'app.fjsbundle'))).toBe(false);
  });

  it('only warns when the output carries no engine id', () => {
    fake('native/build-native/fjsc', PRIMJS, null);
    fs.writeFileSync(path.join(tmp, 'x.js'), '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = compileBytecode(path.join(tmp, 'x.js'), tmp, 'app', 'primjs', lookup(null));
    expect(fs.existsSync(out)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/cannot read the engine id/));
    warn.mockRestore();
  });
});
