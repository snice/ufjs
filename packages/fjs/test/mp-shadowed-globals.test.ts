import { describe, expect, it } from 'vitest';
import { shadowedGlobalsImport } from '../src/mp/script.js';

// spec 060: the mini-program module wrapper shadows requestAnimationFrame /
// cancelAnimationFrame with its own undefined bindings, so every module that
// names one gets the wx runtime's imported in. The "it already has its own"
// test used to run over the raw source text: a comment that merely said the
// word `import` next to the name cancelled the injection, and the module
// threw `requestAnimationFrame is not a function` on a device only.

const injects = (code: string): boolean => shadowedGlobalsImport(code).length > 0;

describe('shadowedGlobalsImport', () => {
  it('injects for a plain use', () => {
    expect(shadowedGlobalsImport('raf = requestAnimationFrame(tick);')).toBe(
      "import { requestAnimationFrame } from '@ufjs/runtime/wx';\n",
    );
  });

  it('injects both names when both are used', () => {
    const out = shadowedGlobalsImport('requestAnimationFrame(f); cancelAnimationFrame(id);');
    expect(out).toContain('requestAnimationFrame, cancelAnimationFrame');
  });

  it('injects setImmediate — the Node branch of a browser probe (spec 061)', () => {
    // Anime.js picks its main loop with `isBrowser ? requestAnimationFrame :
    // setImmediate` while its module evaluates; on this host that bare read
    // threw `setImmediate is not defined` before any page code could run
    const out = shadowedGlobalsImport('const loop = isBrowser ? requestAnimationFrame : setImmediate;');
    expect(out).toContain('requestAnimationFrame, setImmediate');
  });

  it('injects nothing when neither name appears', () => {
    expect(shadowedGlobalsImport('const a = setTimeout(f, 16);')).toBe('');
  });

  it('ignores the word import inside a line comment (spec 060 regression)', () => {
    const code = [
      '// the mini program build imports the wx runtime one into this module',
      'Platform.requestRender = (render) => {',
      '  requestAnimationFrame(() => render());',
      '};',
    ].join('\n');
    expect(injects(code)).toBe(true);
  });

  it('ignores a block comment that names a declaration', () => {
    const code = [
      '/* a page may write `const requestAnimationFrame = …` itself */',
      'requestAnimationFrame(tick);',
    ].join('\n');
    expect(injects(code)).toBe(true);
  });

  it('ignores string and template literals', () => {
    expect(injects('log("import { requestAnimationFrame } from x"); requestAnimationFrame(f);')).toBe(true);
    expect(injects('log(`import requestAnimationFrame`); requestAnimationFrame(f);')).toBe(true);
  });

  it('still sees code inside a template expression', () => {
    expect(injects('const s = `${requestAnimationFrame(f)}`;')).toBe(true);
  });

  it('skips a module that really imports the name', () => {
    expect(injects("import { requestAnimationFrame } from 'fjs';\nrequestAnimationFrame(f);")).toBe(false);
    expect(
      injects("import { cancelAnimationFrame, requestAnimationFrame as raf } from 'fjs';\nraf(f);"),
    ).toBe(false);
    expect(injects("import requestAnimationFrame from './raf';\nrequestAnimationFrame(f);")).toBe(false);
    expect(injects("import * as requestAnimationFrame from './raf';\nrequestAnimationFrame.now();")).toBe(
      false,
    );
  });

  it('skips a module that declares the name', () => {
    expect(injects('function requestAnimationFrame(cb) { return setTimeout(cb, 16); }\nrequestAnimationFrame(f);')).toBe(
      false,
    );
    expect(injects('const requestAnimationFrame = globalThis.rAF;\nrequestAnimationFrame(f);')).toBe(false);
  });

  it('does not read a regex literal ending in an escaped slash as a comment', () => {
    // `/\//` puts two slashes side by side; the backslash before them is
    // what tells the scanner it is not a line comment
    expect(injects('const re = /\\//; requestAnimationFrame(f);')).toBe(true);
  });
});
