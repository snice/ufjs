// spec 105: engine flavor selection from the CLI. The runner (flutter_fjs's
// bin/engine.dart) is stubbed — what matters here is that the flavor reaches
// the environment later `flutter` children inherit, and that a missing or
// failing runner is never silent.
import { afterEach, describe, expect, it } from 'vitest';
import type { spawnSync } from 'node:child_process';
import { materializeJsEngine } from '../src/project/engine';

type Spawn = typeof spawnSync;
const saved = process.env.FJS_JS_ENGINE;
afterEach(() => {
  if (saved === undefined) delete process.env.FJS_JS_ENGINE;
  else process.env.FJS_JS_ENGINE = saved;
});

const noDart = (() => ({ error: new Error('spawnSync dart ENOENT') })) as unknown as Spawn;
const failing = (() => ({ status: 69, stdout: '', stderr: 'fjs: the quickjs engine on ohos needs…' })) as unknown as Spawn;
const ok = (calls: string[][]) =>
  ((cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    return { status: 0, stdout: 'fjs: engine flavor quickjs-ng-0.9.0 — …', stderr: '' };
  }) as unknown as Spawn;

describe('materializeJsEngine (specs/105)', () => {
  it('exports the flavor for the flutter children and runs the runner for the host', () => {
    const calls: string[][] = [];
    materializeJsEngine('quickjs', { flutterDir: '/tmp/host', explicit: true, spawn: ok(calls) });
    expect(process.env.FJS_JS_ENGINE).toBe('quickjs');
    expect(calls).toEqual([['dart', 'run', 'flutter_fjs:engine', 'quickjs', '--host', '/tmp/host']]);
  });

  it('throws when an explicit flavor cannot reach the runner', () => {
    expect(() => materializeJsEngine('quickjs', { explicit: true, spawn: noDart })).toThrow(/cannot run 'dart'/);
    expect(() => materializeJsEngine('primjs', { explicit: true, spawn: noDart })).toThrow(/cannot run 'dart'/);
  });

  it('throws when the runner fails for a non-default flavor', () => {
    expect(() => materializeJsEngine('quickjs', { spawn: failing })).toThrow(/runner failed/);
  });

  it('warns — not silently — when the default flavor cannot reach the runner', () => {
    const warnings: string[] = [];
    materializeJsEngine('primjs', { spawn: noDart, warn: (l) => warnings.push(l) });
    materializeJsEngine('primjs', { spawn: failing, warn: (l) => warnings.push(l) });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/runner skipped/);
    expect(warnings[1]).toMatch(/runner failed/);
    expect(process.env.FJS_JS_ENGINE).toBe('primjs');
  });
});
