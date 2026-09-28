// specs/149: Flutter bundles keep the class syntax both device engines run
// natively. Lowered under target es2019, a class field became an
// Object.defineProperty per field per construction — for every dependency,
// since esbuild uses define semantics for .js files whatever the tsconfig
// says — about 4x a plain assignment on PrimJS. Static fields, static blocks
// and `#x in o` are still lowered: PrimJS mis-scopes a static initializer
// that names its own class, and rejects the other two.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { flutterEsbuildPlatform } from '../src/bundler/build.js';

const LIB = `
export class Counter {
  count = 0;
  #step = 1;
  #bump() { this.count += this.#step; }
  get step() { return this.#step; }
  static limit() { return 9; }
  tick() { this.#bump(); return this.count; }
}
export class Color {
  static WHITE = new Color(1);
  static #BLACK = new Color(0);
  constructor(v) { this.v = v; }
  static black() { return Color.#BLACK; }
}
export class Late {
  static { Late.ready = true; }
  #tag = 1;
  static owns(o) { return #tag in o; }
}
`;

async function bundle(file: string, source: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-class-'));
  const pkg = path.join(dir, 'node_modules', 'lib');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'lib', module: file }));
  fs.writeFileSync(path.join(pkg, file), source);
  fs.writeFileSync(path.join(dir, 'entry.js'), 'import * as lib from "lib"; globalThis.lib = lib;\n');
  const result = await esbuild.build({
    absWorkingDir: dir,
    entryPoints: ['entry.js'],
    bundle: true,
    write: false,
    outfile: 'out.js',
    format: 'iife',
    target: 'es2019',
    ...flutterEsbuildPlatform(),
  });
  return result.outputFiles[0].text;
}

describe('Flutter bundles keep native class syntax (specs/149)', () => {
  it('leaves instance fields, private fields and private methods native in a dependency', async () => {
    const js = await bundle('index.js', LIB.slice(0, LIB.indexOf('export class Color')));
    expect(js).not.toContain('__publicField');
    expect(js).not.toContain('WeakMap');
    expect(js).toMatch(/count = 0;/);
    expect(js).toMatch(/#step = 1;/);
    expect(js).toMatch(/#bump\(\)/);
  });

  it('lowers static fields, so an initializer can name its own class', async () => {
    // native, PrimJS throws "lexical variable is not initialized" here;
    // esbuild lowers the whole class once any static field is lowered
    const js = await bundle('index.js', LIB.slice(LIB.indexOf('export class Color'), LIB.indexOf('export class Late')));
    expect(js).not.toMatch(/static WHITE =/);
    expect(js).not.toMatch(/static #BLACK =/);
    expect(js).toMatch(/__publicField\(_?Color, "WHITE", new _?Color\(1\)\)/);
  });

  it('keeps them native in TypeScript sources too', async () => {
    const js = await bundle('index.ts', 'export class A { x: number = 1; #y = 2; get y(): number { return this.#y; } }\n');
    expect(js).not.toContain('__publicField');
    expect(js).toMatch(/x = 1;/);
    expect(js).toMatch(/#y = 2;/);
  });

  it('still lowers static blocks and `#x in obj`, which PrimJS rejects', async () => {
    const js = await bundle('index.js', LIB);
    expect(js).not.toMatch(/static\s*\{/);
    expect(js).not.toMatch(/#tag in /);
  });
});
