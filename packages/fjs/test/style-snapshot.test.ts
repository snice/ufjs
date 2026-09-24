// specs/119 — the CLI half of the build-time style prewarm: running a bundle
// with the capture hook, and writing the snapshots in front of a chunk. The
// bundles here are hand-written stand-ins for what createFjsApp().mount()
// does in capture mode (fjs-runtime/src/app/flutter.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureStyleSnapshots,
  describeCapture,
  prependSnapshots,
  snapshotStatement,
} from '../src/bundler/style-snapshot.js';

const dirs: string[] = [];
function file(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-snap-test-'));
  dirs.push(dir);
  const p = path.join(dir, name);
  fs.writeFileSync(p, contents);
  return p;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('captureStyleSnapshots', () => {
  it('collects what the app hands the hook, per route', async () => {
    const bundle = file(
      'bundle.js',
      `const hook = globalThis.__fjsCaptureStyles;
       hook.started = true;
       setTimeout(() => hook({ '/a': { v: 1, n: 1 }, '/b': { error: 'Error: boom\\n  at x' } }), 5);`,
    );
    const c = await captureStyleSnapshots(bundle);
    expect(c).not.toBeNull();
    expect(JSON.parse(c!.snapshots['/a'])).toEqual({ v: 1, n: 1 });
    expect(c!.errors['/b']).toBe('Error: boom');
    expect(describeCapture(c!)).toMatch(/1 page captured .*skipped \/b/);
  });

  it('is null, and quick, for a bundle that never takes the hook', async () => {
    const bundle = file('bundle.js', 'globalThis.x = 1;');
    const t0 = Date.now();
    expect(await captureStyleSnapshots(bundle)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('runs without Node globals the device does not have', async () => {
    const bundle = file(
      'bundle.js',
      `const hook = globalThis.__fjsCaptureStyles; hook.started = true;
       hook({ '/': { hasTextEncoder: typeof TextEncoder !== 'undefined', hasProcess: typeof process !== 'undefined' } });`,
    );
    const c = await captureStyleSnapshots(bundle);
    expect(JSON.parse(c!.snapshots['/'])).toEqual({ hasTextEncoder: false, hasProcess: false });
  });

  it('refuses a snapshot holding a NUL character (PrimJS reads it back empty)', async () => {
    const bundle = file(
      'bundle.js',
      `const hook = globalThis.__fjsCaptureStyles; hook.started = true;
       hook({ '/x': { s: 'a\\u0000b' }, '/y': { s: 'ok' } });`,
    );
    const c = await captureStyleSnapshots(bundle);
    expect(c!.snapshots['/x']).toBeUndefined();
    expect(c!.errors['/x']).toMatch(/NUL/);
    expect(c!.snapshots['/y']).toBeDefined();
  });

  it('clears the timers a page left running', async () => {
    const bundle = file(
      'bundle.js',
      `const hook = globalThis.__fjsCaptureStyles; hook.started = true;
       setInterval(() => {}, 10);
       hook({});`,
    );
    // would keep the test process alive (and vitest would time out) if leaked
    expect(await captureStyleSnapshots(bundle)).not.toBeNull();
  });
});

describe('snapshot statement', () => {
  const snapshots = {
    '/vant-form': JSON.stringify({ v: 1, s: 'quote " backslash \\ ctl \u0006 line sep' }),
    '/': '{}',
  };

  it('is one line that fills globalThis.__fjsStyleSnapshots with the JSON strings', () => {
    const stmt = snapshotStatement(snapshots);
    expect(stmt.endsWith('\n')).toBe(true);
    expect(stmt.slice(0, -1)).not.toContain('\n');
    const ctx: Record<string, unknown> = {};
    vm.runInNewContext(stmt, ctx);
    expect(ctx.__fjsStyleSnapshots).toEqual(snapshots);
  });

  it('adds to a table an earlier chunk already started', () => {
    const ctx: Record<string, unknown> = {};
    vm.runInNewContext(snapshotStatement({ '/a': '1' }), ctx);
    vm.runInNewContext(snapshotStatement({ '/b': '2' }), ctx);
    expect(ctx.__fjsStyleSnapshots).toEqual({ '/a': '1', '/b': '2' });
  });

  it('is ES2019 (no ??=, no optional chaining)', () => {
    expect(snapshotStatement(snapshots)).not.toMatch(/\?\?=|\?\./);
  });

  it('writes nothing for no snapshots', () => {
    expect(snapshotStatement({})).toBe('');
  });
});

describe('prependSnapshots', () => {
  it('puts the statement first, so a bundle that mounts while evaluating sees it', () => {
    const js = file('bundle.js', 'globalThis.seen = globalThis.__fjsStyleSnapshots["/"];\n');
    prependSnapshots(js, { '/': '{"v":1}' });
    const ctx: Record<string, unknown> = {};
    vm.runInNewContext(fs.readFileSync(js, 'utf8'), ctx);
    expect(ctx.seen).toBe('{"v":1}');
  });

  it('shifts an external source map down by exactly one line', () => {
    const js = file('bundle.js', 'a();\n');
    fs.writeFileSync(`${js}.map`, JSON.stringify({ version: 3, mappings: 'AAAA;AACA', sources: ['x.ts'] }));
    prependSnapshots(js, { '/': '{}' });
    const map = JSON.parse(fs.readFileSync(`${js}.map`, 'utf8'));
    expect(map.mappings).toBe(';AAAA;AACA');
    expect(fs.readFileSync(js, 'utf8').split('\n')[1]).toBe('a();');
  });

  it('leaves the file alone when there is nothing to add', () => {
    const js = file('bundle.js', 'a();\n');
    prependSnapshots(js, {});
    expect(fs.readFileSync(js, 'utf8')).toBe('a();\n');
  });
});
