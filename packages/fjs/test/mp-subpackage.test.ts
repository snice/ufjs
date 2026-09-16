// Subpackage assignment, product-URL rewriting and the per-package npm
// vendor split (specs/063).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Emitter } from '../src/mp/build.js';
import { appJson } from '../src/mp/project.js';
import {
  assignSubpackages,
  findPathPrefixes,
  matchesFragment,
  mpPageOf,
  rewritePathPrefixes,
  translatePreloadRule,
} from '../src/mp/subpackage.js';
import type { MpPage } from '../src/mp/project.js';

const page = (path: string, meta: Record<string, unknown> = {}): MpPage => ({
  path,
  name: path.split('/').filter(Boolean).join('-'),
  meta,
});

describe('matchesFragment', () => {
  it('matches like mp.exclude: exact path, substring, or page name', () => {
    expect(matchesFragment(page('/example/game/2048'), 'example/game/')).toBe(true);
    expect(matchesFragment(page('/example/game/2048'), '/example/game/2048')).toBe(true);
    expect(matchesFragment(page('/example/game/2048'), 'example-game-2048')).toBe(true);
    expect(matchesFragment(page('/example/style/pseudo'), 'example/game/')).toBe(false);
  });
});

describe('assignSubpackages', () => {
  it('assigns pages by fragment and collects them per root', () => {
    const pages = [page('/'), page('/example/game/2048'), page('/example/canvas/f2'), page('/comp/text')];
    const { ownerOf, subpackages } = assignSubpackages(pages, [
      { root: 'game', pages: ['example/game/'] },
      { root: 'canvas', pages: ['example/canvas/'] },
    ]);
    expect(ownerOf.get('example-game-2048')).toBe('game');
    expect(ownerOf.get('example-canvas-f2')).toBe('canvas');
    expect(ownerOf.has('comp-text')).toBe(false);
    expect(subpackages.map((s) => s.root)).toEqual(['game', 'canvas']);
    expect(subpackages[0].pages.map((p) => p.path)).toEqual(['/example/game/2048']);
  });

  it('rejects a page matching two subpackages', () => {
    expect(() =>
      assignSubpackages([page('/example/game/2048')], [
        { root: 'a', pages: ['example/game'] },
        { root: 'b', pages: ['2048'] },
      ]),
    ).toThrow(/matches several subpackages/);
  });

  it('rejects a tab page inside a subpackage', () => {
    expect(() =>
      assignSubpackages([page('/example/game/2048', { tab: 2 })], [{ root: 'game', pages: ['example/game/'] }]),
    ).toThrow(/tab page/);
  });

  it('rejects reserved, malformed or overlapping roots', () => {
    expect(() => assignSubpackages([], [{ root: 'pages', pages: ['x'] }])).toThrow(/reserved/);
    expect(() => assignSubpackages([], [{ root: 'fjs', pages: ['x'] }])).toThrow(/reserved/);
    expect(() => assignSubpackages([], [{ root: '/game', pages: ['x'] }])).toThrow(/slash/);
    expect(() => assignSubpackages([], [{ root: 'game/', pages: ['x'] }])).toThrow(/slash/);
    expect(() => assignSubpackages([], [{ root: 'a', pages: ['x'] }, { root: 'a/b', pages: ['y'] }])).toThrow(/overlap/);
  });

  it('rejects a public dir claimed twice', () => {
    expect(() =>
      assignSubpackages([], [
        { root: 'a', pages: ['x'], public: ['wm'] },
        { root: 'b', pages: ['y'], public: ['wm'] },
      ]),
    ).toThrow(/claimed by both/);
  });
});

describe('rewritePathPrefixes', () => {
  const pairs = [{ from: '/wm/', to: '/game/wm/' }];

  it('rewrites whole string literals and template heads', () => {
    expect(rewritePathPrefixes("const a = '/wm/f1.png';", pairs)).toBe("const a = '/game/wm/f1.png';");
    expect(rewritePathPrefixes('loadCanvasImage(`/wm/${name}.png`)', pairs)).toBe(
      'loadCanvasImage(`/game/wm/${name}.png`)',
    );
  });

  it('never touches comments or non-leading occurrences', () => {
    const code = [
      "// see /wm/ when the table drops", // line comment
      '/* block /wm/ comment */',
      "const b = '/assets/wm-alias.png';", // does not START with /wm/
      "const c = 'under /wm/ mid-string';", // documented limitation: untouched
    ].join('\n');
    expect(rewritePathPrefixes(code, pairs)).toBe(code);
  });

  it('does not double-rewrite and keeps template expressions intact', () => {
    expect(rewritePathPrefixes("const d = '/game/wm/f1.png';", pairs)).toBe("const d = '/game/wm/f1.png';");
    expect(rewritePathPrefixes('`${x ? "/wm/a" : ""}${name}`', pairs)).toBe('`${x ? "/game/wm/a" : ""}${name}`');
  });
});

describe('findPathPrefixes', () => {
  const prefixes = ['/wm/', '/fb/'];

  it('reports prefixes at string/template starts and skips comments', () => {
    const code = [
      "const a = '/wm/f1.png';",
      'const b = `/fb/${name}.png`;',
      '// comment /wm/',
      "const c = '/images/test.png';",
    ].join('\n');
    expect(findPathPrefixes(code, prefixes)).toEqual(['/wm/', '/fb/']);
  });

  it('does not match rewritten subpackage paths', () => {
    expect(findPathPrefixes("require('/game/wm/x').load('/game/fb/y')", prefixes)).toEqual([]);
  });
});

describe('translatePreloadRule', () => {
  const pages = [page('/'), page('/example/canvas/f2'), page('/example/game/2048', { tab: 2 })];
  const ownerOf = new Map([
    ['example-canvas-f2', 'canvas'],
    ['example-game-2048', 'game'],
  ]);

  it('translates route keys to real page paths and keeps root references', () => {
    const rule = translatePreloadRule(pages, ownerOf, ['game', 'canvas'], {
      '/example/canvas/f2': { network: 'all', packages: ['game'] },
      'example/game/2048': { packages: ['canvas'] },
    });
    expect(rule).toEqual({
      'canvas/pages/example-canvas-f2/example-canvas-f2': { network: 'all', packages: ['game'] },
      'game/pages/example-game-2048/example-game-2048': { packages: ['canvas'] },
    });
  });

  it('allows __APP__ for the main package', () => {
    const index = { path: '/', name: 'index', meta: {} };
    const rule = translatePreloadRule([index, ...pages.slice(1)], ownerOf, ['canvas'], {
      '/': { packages: ['__APP__'] },
    });
    expect(rule['pages/index/index']).toEqual({ packages: ['__APP__'] });
  });

  it('rejects unknown routes, unknown roots and bad networks', () => {
    expect(() => translatePreloadRule(pages, ownerOf, ['game'], { '/nope': { packages: ['game'] } })).toThrow(
      /does not match any route/,
    );
    expect(() => translatePreloadRule(pages, ownerOf, [], { '/': { packages: ['game'] } })).toThrow(
      /not a subpackages root/,
    );
    expect(() =>
      translatePreloadRule(pages, ownerOf, ['game'], { '/': { network: '5g' as 'all' | 'wifi', packages: ['game'] } }),
    ).toThrow(/must be "all" or "wifi"/);
    expect(() => translatePreloadRule(pages, ownerOf, ['game'], { '/': { packages: [] } })).toThrow(
      /non-empty packages/,
    );
  });
});

describe('mpPageOf', () => {
  it('prefixes subpackaged pages with their root', () => {
    expect(mpPageOf('index', new Map())).toBe('pages/index/index');
    expect(mpPageOf('example-canvas-f2', new Map([['example-canvas-f2', 'canvas']]))).toBe(
      'canvas/pages/example-canvas-f2/example-canvas-f2',
    );
  });
});

describe('appJson subPackages', () => {
  it('emits subPackages entries with page paths relative to the root', () => {
    const json = JSON.parse(
      appJson([page('/comp/text')], 'skyline', {
        subpackages: [{ root: 'game', pages: ['pages/example-game-2048/example-game-2048'] }],
        preloadRule: { 'pages/comp-text/comp-text': { packages: ['game'] } },
      }),
    ) as Record<string, unknown>;
    expect(json.subPackages).toEqual([{ root: 'game', pages: ['pages/example-game-2048/example-game-2048'] }]);
    expect(json.preloadRule).toEqual({ 'pages/comp-text/comp-text': { packages: ['game'] } });
    expect(json.pages).toEqual(['pages/comp-text/comp-text']);
  });

  it('stays byte-identical without subpackages', () => {
    const pages = [page('/comp/text', { tab: 0 }), page('/api/api', { tab: 1 })];
    expect(appJson(pages, 'skyline', { subpackages: [], preloadRule: {} })).toBe(appJson(pages, 'skyline'));
    expect(appJson(pages, 'skyline')).not.toContain('subPackages');
    expect(appJson(pages, 'skyline')).not.toContain('preloadRule');
  });
});

describe('Emitter subpackage ownership', () => {
  let tmp = '';

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-mp-sub-'));
    // a resolvable stub dependency for writeNpm's esbuild pass
    const pkgDir = path.join(tmp, 'node_modules', 'tiny-lib');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'tiny-lib', main: 'index.js' }));
    fs.writeFileSync(path.join(pkgDir, 'index.js'), 'export const value = 1;\n');
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', version: '1.0.0', dependencies: { 'tiny-lib': '*' } }),
    );
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const mpDir = (): string => path.join(tmp, 'dist', 'miniprogram');

  it('routes imports and assets per owner and splits the vendor', async () => {
    const root = tmp;
    const dir = mpDir();
    const emitter = new Emitter(root, dir, ['game']);

    const mainMod = path.join(root, 'src', 'main.ts');
    const subMod = path.join(root, 'src', 'sub.ts');
    const mainShim = emitter.resolveFor(path.join(dir, 'pages', 'a'), mainMod, 'tiny-lib');
    const subShim = emitter.resolveFor(path.join(dir, 'game', 'pages', 'b'), subMod, 'tiny-lib');
    expect(mainShim).toEqual({ kind: 'path', target: '../../fjs/npm/tiny-lib' });
    expect(subShim).toEqual({ kind: 'path', target: '../../fjs/npm/tiny-lib' });

    const mainImg = emitter.resolveFor(path.join(dir, 'pages', 'a'), mainMod, '@/pic.png');
    const subImg = emitter.resolveFor(path.join(dir, 'game', 'pages', 'b'), subMod, '@/pic.png');
    // the hash is md5 of the source abs path (Emitter's asset naming)
    const hash = createHash('md5').update(path.join(root, 'src', 'pic.png')).digest('hex').slice(0, 6);
    expect(mainImg).toEqual({ kind: 'const', target: `"/assets/pic-${hash}.png"` });
    expect(subImg).toEqual({ kind: 'const', target: `"/game/assets/pic-${hash}.png"` });

    await emitter.writeNpm();

    // main imported tiny-lib too, so the vendor must live in MAIN (single
    // instance, subpackages may require main); each shim points there —
    // "./vendor.js" for the main one, a climb for the subpackage's
    expect(fs.existsSync(path.join(dir, 'fjs', 'npm', 'vendor.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'game', 'fjs', 'npm', 'vendor.js'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'fjs', 'npm', 'tiny-lib.js'), 'utf8')).toContain(
      'require("./vendor.js")',
    );
    expect(fs.readFileSync(path.join(dir, 'game', 'fjs', 'npm', 'tiny-lib.js'), 'utf8')).toContain(
      'require("../../../fjs/npm/vendor.js")',
    );
  });

  it('gives a subpackage its own vendor when only it imports the spec', async () => {
    const root = tmp;
    const dir = mpDir();
    const emitter = new Emitter(root, dir, ['game']);
    const subMod = path.join(root, 'src', 'sub.ts');
    emitter.resolveFor(path.join(dir, 'game', 'pages', 'b'), subMod, 'tiny-lib');
    await emitter.writeNpm();

    expect(fs.existsSync(path.join(dir, 'game', 'fjs', 'npm', 'vendor.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'fjs', 'npm', 'vendor.js'))).toBe(false);
    const shim = fs.readFileSync(path.join(dir, 'game', 'fjs', 'npm', 'tiny-lib.js'), 'utf8');
    // sub vendor sits next to the shim: ./vendor.js; the runtime forwarders
    // inside must climb to the main package runtime
    expect(shim).toContain('require("./vendor.js")');
    const vendor = fs.readFileSync(path.join(dir, 'game', 'fjs', 'npm', 'vendor.js'), 'utf8');
    expect(vendor).toContain('require("../../../fjs/runtime.js")');
  });
});
