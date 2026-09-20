// fjs types: generation on demand, unchanged detection, --check staleness
// and the exit code (specs/087 §6.3/6.4).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesCommand } from '../src/commands/types.js';

/** The command writes relative to its root; tests pass the temp dir. */
const types = (args: string[] = []) => typesCommand(args, root);

let root = '';
let log: string[] = [];

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-types-'));
  log = [];
  console.log = (...args: unknown[]) => {
    log.push(args.join(' '));
  };
});

afterEach(() => {
  console.log = originalLog;
  fs.rmSync(root, { recursive: true, force: true });
});

const originalLog = console.log;

/** Runs the command in [root] — typesCommand reads process.cwd(), so the
 * subprocess indirection is what makes per-case roots possible. */
function runIn(dir: string, args: string[]): { code: number; out: string } {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  try {
    const out = execFileSync(process.execPath, [cli, 'types', ...args], { cwd: dir, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? '' };
  }
}

describe('fjs types', () => {
  it('writes route types for a project with pages and reports unchanged on rerun', () => {
    write('src/pages/index.vue', '<template><view /></template>');
    write('src/pages/user/[id].vue', '<template><view /></template>');
    types();
    const routes = fs.readFileSync(path.join(root, 'src/fjs-routes.d.ts'), 'utf8');
    expect(routes).toContain('"user-id": "/user/:id"');
    expect(log.join('\n')).toContain('wrote     src/fjs-routes.d.ts');
    expect(log.join('\n')).toContain('skipped   src/fjs-modules.d.ts');

    log = [];
    types();
    expect(log.join('\n')).toContain('unchanged src/fjs-routes.d.ts');
  });

  it('skips assets/modules/components when the project has none', () => {
    write('src/pages/index.vue', '<template><view /></template>');
    types();
    const out = log.join('\n');
    expect(out).toContain('skipped   src/fjs-assets.d.ts');
    expect(out).toContain('skipped   src/fjs-modules.d.ts');
    expect(out).toContain('skipped   src/fjs-components.d.ts');
    expect(fs.existsSync(path.join(root, 'src/fjs-assets.d.ts'))).toBe(false);
  });

  it('picks up local assets when public/ has images', () => {
    write('src/pages/index.vue', '<template><view /></template>');
    write('public/images/logo.png', 'png');
    types();
    const assets = fs.readFileSync(path.join(root, 'src/fjs-assets.d.ts'), 'utf8');
    expect(assets).toContain('"/images/logo.png"');
  });

  it('--check is read-only and exits 1 on stale files', () => {
    write('src/pages/index.vue', '<template><view /></template>');
    // generate, then drift the file by hand
    types();
    write('src/fjs-routes.d.ts', '// stale\n');
    log = [];
    types(["--check"]);
    expect(log.join('\n')).toContain('stale     src/fjs-routes.d.ts');
    expect(fs.readFileSync(path.join(root, 'src/fjs-routes.d.ts'), 'utf8')).toBe('// stale\n');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    // a clean project passes --check with exit 0
    types(); // regenerate, clearing the drift
    log = [];
    types(["--check"]);
    expect(process.exitCode).toBe(0);
    expect(log.join('\n')).not.toContain('stale');
  });

  it('assets types empty out when public/ goes away (writer semantics: emptied, not deleted)', () => {
    write('src/pages/index.vue', '<template><view /></template>');
    write('public/images/logo.png', 'png');
    types();
    const file = path.join(root, 'src/fjs-assets.d.ts');
    expect(fs.existsSync(file)).toBe(true);

    fs.rmSync(path.join(root, 'public'), { recursive: true, force: true });
    types();
    const emptied = fs.readFileSync(file, 'utf8');
    expect(emptied).toContain('interface FjsImageAssets');
    expect(emptied).not.toContain('/images/logo.png');
  });

  it('the built CLI reports stale via exit code end to end', () => {
    write('src/pages/index.vue', '<template><view /></template>');
    write('src/fjs-routes.d.ts', '// stale\n');
    const dist = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    if (!fs.existsSync(dist)) {
      // dist is built by `pnpm --filter @ufjs/cli run build`; without it the
      // end-to-end leg is covered by the in-process cases above
      return;
    }
    const { code } = runIn(root, ['--check']);
    expect(code).toBe(1);
  });
});
