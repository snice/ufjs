// The shared static-file semantics of `fjs dev --web` and `fjs preview`
// (spec 082): SPA fallback only for extension-less paths, honest 404s for
// missing assets, traversal confined to the root.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveStaticFile } from '../src/dev/static.js';

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'main-abc123.js'), 'console.log(1)');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const serve = (url: string) => resolveStaticFile(dir, url);

describe('resolveStaticFile', () => {
  it('serves / as index.html', () => {
    expect(serve('/')).toBe(path.join(dir, 'index.html'));
  });

  it('serves an existing asset', () => {
    expect(serve('/assets/main-abc123.js')).toBe(path.join(dir, 'assets', 'main-abc123.js'));
  });

  it('falls back to index.html for an extension-less route', () => {
    expect(serve('/example/canvas')).toBe(path.join(dir, 'index.html'));
  });

  it('404s a missing file that has an extension (no HTML mask)', () => {
    expect(serve('/images/missing.png')).toBeNull();
  });

  it('refuses to walk out of the root', () => {
    expect(serve('/../secret.txt')).toBeNull();
    expect(serve('/..%2F..%2Fetc%2Fpasswd')).toBeNull();
  });

  it('keeps query strings out of the file name', () => {
    expect(serve('/assets/main-abc123.js?v=2')).toBe(path.join(dir, 'assets', 'main-abc123.js'));
  });
});
