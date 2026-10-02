// specs/170: every runtime helper @vue/compiler-vapor can emit must resolve
// on every vapor entry — a missing one is a module-load TypeError on the
// page that used the matching syntax. The list is read out of the compiler
// itself, so a compiler upgrade that emits something new turns this red.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function compilerHelpers(): string[] {
  const require = createRequire(import.meta.url);
  const pkg = path.dirname(require.resolve('@vue/compiler-vapor/package.json'));
  const src = fs.readFileSync(path.join(pkg, 'dist', 'compiler-vapor.cjs.js'), 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/helper\("([A-Za-z]+)"\)/g)) names.add(m[1]);
  // helpers named through a variable (v-model kinds, setProp variants…)
  for (const m of src.matchAll(/"((?:set|apply|on|create|with|get|insert)[A-Z][A-Za-z]*)"/g)) names.add(m[1]);
  // built-in components (<Transition> → VaporTransition…)
  for (const m of src.matchAll(/"(Vapor[A-Z][A-Za-z]*)"/g)) names.add(m[1]);
  return [...names].sort();
}

describe('compiler-vapor helper parity (specs/170)', () => {
  const helpers = compilerHelpers();

  it('reads a plausible helper list out of the compiler', () => {
    expect(helpers).toContain('createIf');
    expect(helpers).toContain('applyTextModel');
    expect(helpers.length).toBeGreaterThan(50);
  });

  for (const entry of ['index', 'flutter-pure'] as const) {
    it(`vapor/${entry} exports every one of them`, async () => {
      const mod = (await import(`../src/vapor/${entry}.ts`)) as Record<string, unknown>;
      const missing = helpers.filter((h) => !(h in mod));
      expect(missing).toEqual([]);
    });
  }
});
