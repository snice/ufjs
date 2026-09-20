// fjs upgrade — move @ufjs/cli, @ufjs/runtime and the host's flutter_fjs
// together.
//
// The three packages are one system: the CLI drives the runtime's protocol
// and the host's FFI, so they must share a minor (fjs doctor warns when
// they do not). Upgrading them by hand is the classic foot-gun — bump one,
// forget the other, and the app fails in ways that look like bugs. This
// picks the latest @ufjs/cli from npm, the NEWEST runtime and flutter_fjs
// on the SAME minor (a runtime that outpaces its CLI does not exist), and
// moves all three in one go.
//
// Network facts (npm view, pub.dev) are pulled at the edges; everything
// decision-shaped — pairing a minor, choosing the host constraint — is a
// pure function with its own tests.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { flutterDir as configuredFlutterDir } from '../project/config.js';
import { installedVersion, minor, readPackage } from './doctor.js';

export interface UpgradePlan {
  cli: { from: string | null; to: string | null };
  runtime: { from: string | null; to: string | null };
  /** null target = nothing to touch (path dependency, or pub.dev unreachable) */
  flutterFjs: { from: string | null; to: string | null; constraint: string | null };
}

export function upgradeCommand(argv: string[]): Promise<void> {
  let check = false;
  for (const arg of argv) {
    if (arg === '--check') check = true;
    else throw new Error(`unknown upgrade option: ${arg}`);
  }
  return run(check);
}

async function run(check: boolean): Promise<void> {
  const root = process.cwd();
  const cliFrom = installedVersion(root, '@ufjs/cli');
  const runtimeFrom = installedVersion(root, '@ufjs/runtime');

  const cliLatest = npmView('version', '@ufjs/cli');
  if (cliLatest === null) {
    throw new Error('could not read @ufjs/cli from the npm registry (npm view failed)');
  }
  const runtimeTo = npmRuntimeTarget(cliLatest);

  const flutterTo = await pubDevSameMinor(cliLatest);
  const plan: UpgradePlan = {
    cli: { from: cliFrom, to: cliLatest },
    runtime: { from: runtimeFrom, to: runtimeTo },
    flutterFjs: readHostConstraint(root, flutterTo),
  };

  const line = (name: string, from: string | null, to: string | null, note = '') =>
    console.log(
      `  ${name.padEnd(14)} ${from ?? '?'} → ${to ?? '(unchanged)'}${note}`,
    );
  line('@ufjs/cli', plan.cli.from, plan.cli.to);
  line('@ufjs/runtime', plan.runtime.from, plan.runtime.to);
  line(
    'flutter_fjs',
    plan.flutterFjs.from,
    plan.flutterFjs.to,
    plan.flutterFjs.constraint === null ? '  (host pubspec not touched)' : '',
  );

  if (check) return;

  if (plan.cli.to !== null) {
    const pm = packageManager(root);
    if (pm === null) {
      console.log('\nthis looks like the ufjs monorepo checkout — upgrade by editing');
      console.log('the workspace package versions; fjs upgrade does not run installers here');
      return;
    }
    const result = spawnSync(pm, ['add', `@ufjs/cli@${plan.cli.to}`, ...(runtimeTo ? [`@ufjs/runtime@${runtimeTo}`] : [])], {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.error || result.status !== 0) {
      throw new Error(`${pm} add failed${result.status !== null ? ` (exit ${result.status})` : ''}`);
    }
  }

  if (plan.flutterFjs.constraint !== null) {
    const dir = path.resolve(root, configuredFlutterDir(root));
    rewriteHostConstraint(dir, plan.flutterFjs.constraint);
    const pub = spawnSync('flutter', ['pub', 'get'], { cwd: dir, stdio: 'inherit' });
    if (pub.error || pub.status !== 0) {
      throw new Error('flutter pub get failed — resolve it in the host and rerun');
    }
  }
  console.log('\nupgraded. run fjs doctor to confirm the three agree');
}

// ------------------------------------------------------------------ plan

/** The host pubspec's flutter_fjs as a constraint string, plus the from
 * version for display. A path dependency or a missing host yields a null
 * constraint — nothing to rewrite there. */
function readHostConstraint(root: string, target: string | null): UpgradePlan['flutterFjs'] {
  const dir = path.resolve(root, configuredFlutterDir(root));
  const pubspec = path.join(dir, 'pubspec.yaml');
  if (!fs.existsSync(pubspec)) {
    return { from: null, to: null, constraint: null };
  }
  const text = fs.readFileSync(pubspec, 'utf8');
  const local = /flutter_fjs:\s*\n\s*path:\s*(\S+)/.exec(text);
  const hosted = /flutter_fjs:\s*(\S+)/.exec(text);
  if (local !== null) {
    return { from: local[1], to: null, constraint: null };
  }
  const current = hosted !== null ? hosted[1].replace(/^\^/, '') : null;
  if (target === null || current === target) {
    return { from: current, to: target, constraint: null };
  }
  return { from: current, to: target, constraint: `^${target}` };
}

/** Rewrites the host pubspec's `flutter_fjs:` line to [constraint]. */
function rewriteHostConstraint(dir: string, constraint: string): void {
  const pubspec = path.join(dir, 'pubspec.yaml');
  const text = fs.readFileSync(pubspec, 'utf8');
  if (/flutter_fjs:\s*\S+/.test(text)) {
    fs.writeFileSync(pubspec, text.replace(/flutter_fjs:\s*\S+/, `flutter_fjs: ${constraint}`));
  } else {
    console.warn(`warning: no flutter_fjs line in ${pubspec} — add ${constraint} by hand`);
  }
}

/** The newest version among [all] sharing @ufjs/cli's major.minor, or null
 * when the registry knows none (a brand-new CLI minor with no runtime yet). */
export function sameMinor(all: string[], cli: string): string | null {
  let best: string | null = null;
  for (const v of all) {
    if (minor(v) !== minor(cli)) continue;
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

/** Numeric semver-ish ordering; prereleases sort below their release. */
export function compareVersions(a: string, b: string): number {
  const core = (v: string) => v.split('-')[0].split('.').map(Number);
  const [ax, ay, az] = core(a);
  const [bx, by, bz] = core(b);
  for (const [l, r] of [
    [ax, bx],
    [ay, by],
    [az, bz],
  ] as Array<[number, number]>) {
    if (l !== r) return l - r;
  }
  const pre = (v: string) => (v.includes('-') ? v.split('-')[1] : null);
  const [pa, pb] = [pre(a), pre(b)];
  if (pa === pb) return 0;
  if (pa === null) return 1;
  if (pb === null) return -1;
  return pa < pb ? -1 : 1;
}

// ------------------------------------------------------------- registries

function npmView(field: string, pkg: string): string | null {
  const out = npmViewJson(field, pkg);
  if (out === null) return null;
  try {
    const parsed: unknown = JSON.parse(out);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function npmViewJson(field: string, pkg: string): string | null {
  const result = spawnSync('npm', ['view', pkg, field, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.toString().trim() || null;
}

/** The newest runtime on the CLI's minor; a failed or junky versions list
 * yields null and the plan shows the runtime as unchanged. */
function npmRuntimeTarget(cli: string): string | null {
  const raw = npmViewJson('versions', '@ufjs/runtime');
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const versions = parsed.filter((v): v is string => typeof v === 'string');
    return sameMinor(versions, cli);
  } catch {
    return null;
  }
}

/** The newest pub.dev flutter_fjs on the CLI's minor, or null when pub.dev
 * is unreachable — the pubspec part is then skipped with a printed plan. */
async function pubDevSameMinor(cli: string): Promise<string | null> {
  let versions: string[];
  try {
    const response = await fetch('https://pub.dev/api/packages/flutter_fjs', {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      versions?: Array<{ version?: string }>;
    };
    versions = (body.versions ?? [])
      .map((v) => v.version)
      .filter((v): v is string => typeof v === 'string');
  } catch {
    return null;
  }
  return sameMinor(versions, cli);
}

/** pnpm / yarn / npm / bun from the lockfile, the packageManager field
 * first. null = the ufjs monorepo checkout (workspace symlinks make a
 * package-manager install the wrong move). */
function packageManager(root: string): string | null {
  if (fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))) return null;
  const declared = readPackage(root)?.packageManager;
  if (typeof declared === 'string') return declared.split('@')[0];
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) {
    return 'bun';
  }
  return 'npm';
}
