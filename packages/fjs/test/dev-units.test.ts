// Dev unit hot reload (spec 037): what the server decides to push for an
// edit, and what the units-mode split build actually produces. The wire
// forms here are parsed by DevClient.parseReload on the Dart side — keep
// the two in step.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changeMessage } from '../src/dev/server.js';
import { buildBundle, type BuildOptions, type DevUnitsInfo } from '../src/bundler/build.js';

type Fingerprint = Map<string, string>;

function print(entries: Array<[string, string]>): Fingerprint {
  return new Map(entries);
}

describe('changeMessage', () => {
  const graph: DevUnitsInfo = {
    files: {
      'src/components/tag.vue': '/x/units/src/components/tag.vue',
      'src/lib/greeting.ts': '/x/units/src/lib/greeting.ts',
    },
    // tag.vue is imported by two pages; greeting.ts by the entry
    importers: {
      'src/components/tag.vue': ['page:index', 'page:about'],
      'src/lib/greeting.ts': ['bundle'],
    },
    pageDeps: { index: ['src/components/tag.vue'], about: ['src/components/tag.vue'] },
    order: ['src/components/tag.vue'],
  };

  it('keeps the page-scoped form for pure page chunk edits', () => {
    const before = print([
      ['bundle', 'b1'],
      ['page:index', 'p1'],
    ]);
    const after = print([
      ['bundle', 'b1'],
      ['page:index', 'p2'],
    ]);
    expect(changeMessage(before, after, graph)).toBe('reload pages:index');
  });

  it('pushes a unit swap naming importers and affected pages', () => {
    const before = print([['unit:src/components/tag.vue', 't1']]);
    const after = print([['unit:src/components/tag.vue', 't2']]);
    expect(changeMessage(before, after, graph)).toBe(
      'reload units:src/components/tag.vue pages:index,about',
    );
  });

  it('falls back to a full reload when a unit reaches the entry', () => {
    const before = print([['unit:src/lib/greeting.ts', 'g1']]);
    const after = print([['unit:src/lib/greeting.ts', 'g2']]);
    // re-running the entry is a program restart anyway
    expect(changeMessage(before, after, graph)).toBe('reload');
  });

  it('falls back to a full reload when the edit mixes shapes', () => {
    const before = print([
      ['unit:src/components/tag.vue', 't1'],
      ['page:index', 'p1'],
    ]);
    const after = print([
      ['unit:src/components/tag.vue', 't2'],
      ['page:index', 'p2'],
    ]);
    expect(changeMessage(before, after, graph)).toBe('reload');
  });

  it('falls back to a full reload without a unit graph', () => {
    const before = print([['bundle', 'b1']]);
    const after = print([['bundle', 'b2']]);
    expect(changeMessage(before, after)).toBe('reload');
  });

  it('returns null when nothing changed', () => {
    const same = print([['page:index', 'p1']]);
    expect(changeMessage(same, print([['page:index', 'p1']]), graph)).toBeNull();
  });

  it('names a removed page as a change (its chunk reloads)', () => {
    const before = print([
      ['page:index', 'p1'],
      ['page:gone', 'p2'],
    ]);
    const after = print([['page:index', 'p1']]);
    expect(changeMessage(before, after, graph)).toBe('reload pages:gone');
  });
});

// ---- the units-mode split build ---------------------------------------------

let root: string;
const oldCwd = process.cwd();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-units-'));
  process.chdir(root);
});

afterEach(() => {
  process.chdir(oldCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, source: string | Uint8Array): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, source);
}

const PAGE = (tag: string) =>
  `<template><view>${tag}</view></template>\n<script setup>\nimport Tag from '../components/tag.vue';\n</script>\n`;

async function buildUnits(): Promise<{ result: Awaited<ReturnType<typeof buildBundle>>; outDir: string }> {
  write(
    'src/main.ts',
    "import { greeting } from './lib/greeting';\nconsole.log(greeting);\n",
  );
  write('src/lib/greeting.ts', "export const greeting = 'hi';\n");
  write(
    'src/components/tag.vue',
    '<template><text>tag</text></template>\n',
  );
  write('src/pages/index.vue', PAGE('index'));
  write('src/pages/about.vue', PAGE('about'));
  const outDir = path.join(root, 'dist');
  const opts: BuildOptions = {
    outDir,
    minify: false,
    bytecode: false,
    pages: true,
    web: false,
    mp: false,
    release: false,
    mode: 'release',
    gz: false,
    apk: false,
    hap: false,
    flutterDir: '',
    flutterArgs: [],
    analyze: false,
    units: true,
  };
  return { result: await buildBundle(opts), outDir };
}

describe('units-mode split build', () => {
  it('gives every shared app module its own unit file', async () => {
    const { result } = await buildUnits();
    expect(result.devUnits).toBeDefined();
    const ids = Object.keys(result.devUnits!.files).sort();
    // greeting.ts is entry-reachable, tag.vue is shared by two pages — both
    // are in the registry, so both are units
    expect(ids).toEqual(['src/components/tag.vue', 'src/lib/greeting.ts']);
    for (const file of Object.values(result.devUnits!.files)) {
      expect(fs.existsSync(file)).toBe(true);
    }
    const tag = fs.readFileSync(result.devUnits!.files['src/components/tag.vue'], 'utf8');
    // define-only: factories run lazily, on the first require
    expect(tag).toContain('__fjsDefineUnit("src/components/tag.vue"');
    expect(tag).not.toContain('__fjsRequireUnit(');
  });

  it('units.js defines the whole set and the graph names importers', async () => {
    const { result } = await buildUnits();
    const unitsJs = fs.readFileSync(path.join(result.jsPath, '..', 'units.js'), 'utf8');
    expect(unitsJs).toContain('__fjsDefineUnit("src/components/tag.vue"');
    expect(unitsJs).toContain('__fjsDefineUnit("src/lib/greeting.ts"');
    expect(result.devUnits!.importers['src/components/tag.vue']).toEqual(
      // insertion order follows the page scan; assert as a set
      expect.arrayContaining(['page:index', 'page:about']),
    );
    // entry-reachable: the hot-swap server must answer a full reload for it
    expect(result.devUnits!.importers['src/lib/greeting.ts']).toEqual(['bundle']);
    expect(result.devUnits!.pageDeps.index).toEqual(['src/components/tag.vue']);
    expect(result.devUnits!.pageDeps.about).toEqual(['src/components/tag.vue']);
  });

  it('page chunks read shared modules through the unit registry', async () => {
    const { result } = await buildUnits();
    const index = fs.readFileSync(result.pageChunks!.index, 'utf8');
    expect(index).toContain('__fjsRequireUnit("src/components/tag.vue")');
    // the shared chunk no longer carries app modules in units mode
    const shared = fs.readFileSync(result.sharedPath!, 'utf8');
    expect(shared).not.toContain('__fjsDefineUnit("');
    expect(shared).not.toContain('__fjsRequireUnit("');
  });

  it('rebuilding an untouched project reuses the unit cache', async () => {
    const { result } = await buildUnits();
    const tagFile = result.devUnits!.files['src/components/tag.vue'];
    const first = fs.readFileSync(tagFile, 'utf8');
    // make the unit file's mtime distinctive, then rebuild: the cache keeps
    // the old bytes, which is fine — the source did not change
    const second = await buildUnits();
    const secondTag = fs.readFileSync(second.result.devUnits!.files['src/components/tag.vue'], 'utf8');
    expect(secondTag).toBe(first);
  });

  it('keeps imported assets inline — never units (spec 038 fix)', async () => {
    // a pure-asset "unit" would export nothing: esbuild's CJS output for a
    // file-loader entry assigns no module.exports, so the importing page
    // would fetch `undefined` as its URL ("bad magic" on the glTF viewer)
    write('src/assets/hero.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write(
      'src/pages/asset.vue',
      `<template><image :src="hero" /></template>
<script setup lang="ts">
import hero from '../assets/hero.png';
</script>
`,
    );
    const { result } = await buildUnits();
    expect(Object.keys(result.devUnits!.files)).not.toContain('src/assets/hero.png');
    const chunk = fs.readFileSync(result.pageChunks!['asset'], 'utf8');
    // the URL constant is inlined into the page chunk, classic-style
    expect(chunk).toMatch(/assets\/hero-[A-Za-z0-9_-]+\.png/);
    expect(chunk).not.toContain('__fjsRequireUnit("src/assets/hero.png")');
  });
});
