// fjs lint: findings, positions, severity and exit-code semantics
// (specs/087 §6.1). The scanner runs on in-memory SFC/css written into a
// temp project so file positions are real.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintTargets } from '../src/commands/lint.js';

let root = '';

function write(rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-lint-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function rel(f: { file: string; line: number; column: number; level: string; message: string }) {
  return `${f.file}:${f.line}:${f.column}`;
}

describe('drops', () => {
  it('flags the css-compat ❌ set: properties, display, units, selectors, at-rules', () => {
    write(
      'src/pages/a.vue',
      `<template><view class="a">x</view></template>
<style>
#header { color: red; }
.legacy ~ .b { color: red; }
.row:nth-child(2) { color: red; }
.cell:not(.x) { color: red; }
input::selection { color: red; }
input::placeholder { color: red; }
.card[type=big] { color: red; }
.t { word-break: break-all; }
.t { text-overflow: ellipsis; }
.t { filter: blur(1px); }
.t { backdrop-filter: blur(1px); }
.t { display: grid; }
.t { margin-left: 10vw; }
.t { width: max-content; }
.t { max-width: fit-content; }
@import './other.css';
@supports (display: grid) { .x { color: red; } }
</style>`,
    );
    const { findings } = lintTargets(root, []);
    const msgs = findings.filter((f) => f.level === 'drop').map((f) => f.message);
    const codes = findings.map((f) => f.code);
    const hasDecl = (name: string) => codes.some((c) => c.startsWith(name));
    expect(msgs.join('\n')).toContain('id selectors');
    expect(msgs.join('\n')).toContain('~ sibling combinator');
    expect(msgs.join('\n')).toContain(':nth-child');
    expect(msgs.join('\n')).toContain(':not(.x)');
    expect(msgs.join('\n')).toContain('::selection');
    // ::placeholder is engine-supported since specs/100 — no drop finding
    expect(msgs.join('\n')).not.toContain('::placeholder');
    expect(msgs.join('\n')).toContain('[type=big]');
    expect(hasDecl('word-break')).toBe(true);
    expect(hasDecl('text-overflow')).toBe(true);
    expect(hasDecl('filter')).toBe(true);
    expect(hasDecl('backdrop-filter')).toBe(true);
    expect(msgs.join('\n')).toContain('display: grid');
    expect(msgs.join('\n')).toContain('vw unit');
    expect(msgs.join('\n')).toContain('width: max-content');
    expect(msgs.join('\n')).toContain('max-width: fit-content');
    expect(codes.some((c) => c.startsWith('@import'))).toBe(true);
    expect(codes.some((c) => c.startsWith('@supports'))).toBe(true);
    // every finding above is a drop, no warns invented
    expect(findings.every((f) => f.level === 'drop')).toBe(true);
  });

  it('reports exact file:line:column', () => {
    write(
      'src/pages/pos.vue',
      `<template><view /></template>

<style scoped>
.a {
  color: red;
  word-break: break-all;
}
</style>
`,
    );
    const { findings } = lintTargets(root, []);
    // the word-break declaration sits on line 6, column 3 of the file
    expect(findings).toHaveLength(1);
    expect(rel(findings[0]!)).toBe('src/pages/pos.vue:6:3');
  });

  it('checks static style="…" attributes in templates', () => {
    write(
      'src/pages/attr.vue',
      `<template>
  <view style="filter: blur(1px); color: red" />
</template>
`,
    );
    const { findings } = lintTargets(root, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('filter: blur(1px)');
    expect(findings[0]!.line).toBe(2);
  });

  it('scans plain .css files and multiple comma branches of @media', () => {
    write(
      'src/x.css',
      `@media (prefers-reduced-motion: reduce) { .a { color: red; } }
@media (min-width: 600px) { .a { color: red; } }
@media print { .a { color: red; } }
.b { width: 100vh; }`,
    );
    const { findings } = lintTargets(root, ['src/x.css']);
    const msgs = findings.map((f) => f.message).join('\n');
    expect(msgs).toContain('prefers-reduced-motion');
    expect(msgs).toContain('media type "print"');
    expect(msgs).toContain('vh unit');
    // the healthy branch is NOT reported
    expect(msgs).not.toContain('min-width');
  });

  it(':active/:hover are fine on the subject compound, dropped earlier', () => {
    write(
      'src/pages/act.vue',
      `<template><view /></template>
<style>
.btn:active { background-color: black; }
.list:active .title { color: red; }
</style>`,
    );
    const { findings } = lintTargets(root, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain(':active is only supported on the last compound');
  });
});

describe('warns', () => {
  it('transition / bitmap background / keyframes / content / font-face', () => {
    write(
      'src/pages/warn.vue',
      `<template><view class="s">x</view></template>
<style>
.s { transition: filter 1s; }
.s { background-image: url(/bg.png); }
@keyframes pulse { from { background-color: red; } to { background-color: blue; } }
.tip::before { content: attr(data-tip); }
@font-face {
  font-family: x;
  src: url(https://cdn.example.com/x.woff2);
  unicode-range: U+0-7F;
}
</style>`,
    );
    const { findings } = lintTargets(root, []);
    expect(findings.every((f) => f.level === 'warn')).toBe(true);
    const msgs = findings.map((f) => f.message).join('\n');
    expect(msgs).toContain('filter transition(s) do not animate');
    expect(msgs).toContain('bitmap backgrounds');
    expect(msgs).toContain('background-color');
    expect(msgs).toContain('attr()');
    expect(msgs).toContain('cannot register on the App');
    expect(msgs).toContain('unicode-range');
    // the keyframes warning fires once per property, not per frame
    expect(findings.filter((f) => f.code === 'background-color: …')).toHaveLength(1);
  });

  it(':root keeps custom properties but warns on real declarations', () => {
    write(
      'src/pages/root.vue',
      `<template><view /></template>
<style>
:root {
  --brand: #07c160;
  color: red;
}
</style>`,
    );
    const { findings } = lintTargets(root, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.level).toBe('warn');
    expect(findings[0]!.code).toBe('color: red');
  });
});

describe('clean files and command semantics', () => {
  it('a supported stylesheet produces zero findings', () => {
    write(
      'src/pages/clean.vue',
      `<template><view class="c">x</view></template>
<style scoped>
.c {
  display: flex;
  flex-direction: row;
  padding: 8 16;
  width: 50%;
  gap: 4px;
  height: fit-content;
}
.fit {
  width: fit-content;
  width: -webkit-fit-content;
  border-bottom: 1px solid #eee;
}
.c:active { opacity: 0.6; }
.row:first-child { color: red; }
.p:not(:last-child) { margin-bottom: 4px; }
[class*="van-hairline"]::after { content: ''; }
@media screen and (min-width: 600px) and (orientation: landscape) { .c { padding: 24; } }
em { font-size: 0.8em; }
</style>`,
    );
    const { findings } = lintTargets(root, []);
    expect(findings).toEqual([]);
  });

  it('a broken SFC is skipped with a warn, not a crash', () => {
    write('src/pages/bad.vue', '<template><view /></template></template>\n<style>.a { color: red }</style>');
    const { findings, fileCount } = lintTargets(root, []);
    expect(fileCount).toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('could not parse SFC');
  });
});
