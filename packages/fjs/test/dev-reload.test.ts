// Page hot reload (spec 095): an edit confined to page chunks reloads those
// pages; anything else restarts the program. Shared app modules live in
// shared.js and are read back through __FJS_SHARED — there is no unit registry.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changeMessage } from '../src/dev/server.js';
import { buildBundle, type BuildOptions } from '../src/bundler/build.js';

type Fingerprint = Map<string, string>;

function print(entries: Array<[string, string]>): Fingerprint {
  return new Map(entries);
}

describe('changeMessage', () => {
  it('keeps the page-scoped form for pure page chunk edits', () => {
    const before = print([
      ['bundle', 'b1'],
      ['shared', 's1'],
      ['page:index', 'p1'],
    ]);
    const after = print([
      ['bundle', 'b1'],
      ['shared', 's1'],
      ['page:index', 'p2'],
    ]);
    expect(changeMessage(before, after)).toBe('reload pages:index');
  });

  it('reloads everything when the shared prelude changes', () => {
    const before = print([
      ['shared', 's1'],
      ['page:index', 'p1'],
    ]);
    const after = print([
      ['shared', 's2'],
      ['page:index', 'p1'],
    ]);
    expect(changeMessage(before, after)).toBe('reload');
  });

  it('reloads everything when a page edit is mixed with the bundle', () => {
    const before = print([
      ['bundle', 'b1'],
      ['page:index', 'p1'],
    ]);
    const after = print([
      ['bundle', 'b2'],
      ['page:index', 'p2'],
    ]);
    expect(changeMessage(before, after)).toBe('reload');
  });

  it('returns null when nothing changed', () => {
    const same = print([['page:index', 'p1']]);
    expect(changeMessage(same, print([['page:index', 'p1']]))).toBeNull();
  });

  it('names a removed page as a change (its chunk reloads)', () => {
    const before = print([
      ['page:index', 'p1'],
      ['page:gone', 'p2'],
    ]);
    const after = print([['page:index', 'p1']]);
    expect(changeMessage(before, after)).toBe('reload pages:gone');
  });
});

let root: string;
const oldCwd = process.cwd();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-reload-'));
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

async function buildSplit(
  extra: Partial<BuildOptions> = {},
): Promise<{ result: Awaited<ReturnType<typeof buildBundle>>; outDir: string }> {
  write(
    'src/main.ts',
    "import { greeting } from './lib/greeting';\nconsole.log(greeting);\n",
  );
  write('src/lib/greeting.ts', "export const greeting = 'hi';\n");
  write('src/components/tag.vue', '<template><text>tag</text></template>\n');
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
    ipa: false,
    aab: false,
    flutterDir: '',
    flutterArgs: [],
    analyze: false,
    ...extra,
  };
  return { result: await buildBundle(opts), outDir };
}

describe('split dev build', () => {
  it('puts shared app modules in shared.js and stubs them from page chunks', async () => {
    const { result } = await buildSplit();
    const shared = fs.readFileSync(result.sharedPath!, 'utf8');
    expect(shared).toContain('greeting');
    expect(shared).toContain('__FJS_SHARED');
    expect(shared).not.toContain('__fjsRequireUnit');
    const index = fs.readFileSync(result.pageChunks!.index, 'utf8');
    expect(index).toContain('__FJS_SHARED["./src/components/tag.vue"]');
    expect(index).not.toContain('__fjsRequireUnit');
    expect(fs.existsSync(path.join(path.dirname(result.jsPath), 'units.js'))).toBe(false);
  });

  it('writes Vue source maps for page chunks and the shared prelude', async () => {
    const off = await buildSplit();
    expect(fs.readFileSync(off.result.pageChunks!.index, 'utf8')).not.toContain('sourceMappingURL');
    expect(fs.existsSync(`${off.result.sharedPath}.map`)).toBe(false);

    const on = await buildSplit({ sourcemap: true });
    const indexJs = fs.readFileSync(on.result.pageChunks!.index, 'utf8');
    expect(indexJs).toContain('//# sourceMappingURL=fjs-map:');
    const sharedJs = fs.readFileSync(on.result.sharedPath!, 'utf8');
    expect(sharedJs).toContain('//# sourceMappingURL=fjs-map:');

    const pageMap = JSON.parse(fs.readFileSync(`${on.result.pageChunks!.index}.map`, 'utf8')) as {
      sources?: string[];
      sourcesContent?: string[];
    };
    expect(pageMap.sources).toContain(path.posix.relative('pages', 'src/pages/index.vue'));
    expect((pageMap.sources ?? []).some((s) => s.includes('fjs-shared-stub'))).toBe(false);
    expect((pageMap.sources ?? []).some((s) => s.includes('node_modules'))).toBe(false);
    expect((pageMap.sourcesContent ?? []).join('\n')).toContain('<view>index</view>');

    const sharedMap = JSON.parse(fs.readFileSync(`${on.result.sharedPath}.map`, 'utf8')) as {
      sources?: string[];
      sourcesContent?: string[];
    };
    expect(sharedMap.sources).toContain('src/components/tag.vue');
    expect(sharedMap.sources).toContain('src/lib/greeting.ts');
    expect((sharedMap.sources ?? []).some((s) => s.includes('node_modules'))).toBe(false);
    expect((sharedMap.sourcesContent ?? []).join('\n')).toContain('<text>tag</text>');
    expect((sharedMap.sourcesContent ?? []).join('\n')).toContain("export const greeting = 'hi'");
  });

  it('inlines an imported image into the page chunk', async () => {
    write('src/assets/hero.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write(
      'src/pages/asset.vue',
      `<template><image :src="hero" /></template>
<script setup lang="ts">
import hero from '../assets/hero.png';
</script>
`,
    );
    const { result } = await buildSplit();
    const chunk = fs.readFileSync(result.pageChunks!['asset'], 'utf8');
    expect(chunk).toMatch(/assets\/hero-[A-Za-z0-9_-]+\.png/);
    expect(chunk).not.toContain('__fjsRequireUnit');
  });
});
