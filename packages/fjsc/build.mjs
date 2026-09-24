#!/usr/bin/env node
// Builds the fjsc bytecode compiler for one target and lays it out as an npm
// package under packages/fjsc/npm/<name>/.
//
// fjsc has to come from the same engine sources the runtime embeds — a
// bundle compiled by a mismatched fjsc is rejected at load time by the engine
// id check in fjs_bundle_check. That is why this builds from
// packages/flutter_fjs/native rather than downloading anything.
//
// The engine is linked into the binary, so each engine flavor (spec 091) is
// its own binary. Both go into the same per-platform package (spec 114):
// bin/fjsc is primjs, the default, and bin/fjsc-quickjs is quickjs-ng. One
// package keeps the two locked to one version and the release at five
// packages; @ufjs/cli picks between them by the engine id each binary
// reports, never by file name — 0.1.4 shipped a quickjs-ng build as bin/fjsc
// because the cmake call below did not name a flavor.
//
// A target is packaged from prebuilt/<target>/ when a binary is sitting there,
// and compiled from source otherwise. Linux and Windows binaries cannot be
// produced on macOS, so .github/workflows/fjsc-release.yml builds them on
// native runners; you unzip its artifact into prebuilt/ at release time.
// prebuilt/ is gitignored — see docs/publishing.md.
//
//   node build.mjs                  # host platform
//   node build.mjs darwin-x64       # one target
//   node build.mjs --all            # every target @ufjs/cli declares
//   node build.mjs --all-darwin     # both macOS targets
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const nativeDir = path.join(repo, 'packages', 'flutter_fjs', 'native');
const outRoot = path.join(here, 'npm');
const prebuiltRoot = path.join(here, 'prebuilt');
const version = JSON.parse(
  fs.readFileSync(path.join(repo, 'packages', 'fjs', 'package.json'), 'utf8'),
).version;

/** target -> extra cmake flags. Everything else builds natively. */
const TARGETS = {
  'darwin-arm64': ['-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0'],
  'darwin-x64': ['-DCMAKE_OSX_ARCHITECTURES=x86_64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=10.15'],
  'linux-x64': [],
  'linux-arm64': [],
  'win32-x64': [],
};

function hostTarget() {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  return `${process.platform}-${arch}`;
}

/** flavor -> engine id the binary must report, and its file name in bin/. */
const FLAVORS = {
  primjs: { id: 'primjs-4.1.1', name: 'fjsc' },
  quickjs: { id: 'quickjs-ng-0.9.0', name: 'fjsc-quickjs' },
};

/** Compiles the `flavor` fjsc for `target` and returns the path of the binary. */
function compile(target, flavor, exe) {
  const flags = TARGETS[target];
  // one tree per flavor: toggling FJS_JS_ENGINE in a configured tree fights
  // the CMake cache (see native/CMakeLists.txt)
  const buildDir = path.join(here, 'build', `${target}-${flavor}`);

  console.log(`==> compiling fjsc (${flavor}) for ${target}`);
  fs.rmSync(buildDir, { recursive: true, force: true });
  execFileSync(
    'cmake',
    [
      '-S', nativeDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release',
      `-DFJS_JS_ENGINE=${flavor}`,
      // fjsc never loads the debugger module; skip building it
      '-DFJS_DEBUGGER=OFF',
      ...flags,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  execFileSync('cmake', ['--build', buildDir, '--target', 'fjsc', '--config', 'Release'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // multi-config generators (Visual Studio) nest the binary under Release/
  const candidates = [path.join(buildDir, exe), path.join(buildDir, 'Release', exe)];
  const built = candidates.find((p) => fs.existsSync(p));
  if (!built) throw new Error(`fjsc not found after build (looked in ${candidates.join(', ')})`);
  return built;
}

/** The engine id `binary` reports (fjsc without arguments prints its usage
 * and `engine: <id> (abi N)` on stderr), or null. */
function reportedEngine(binary) {
  try {
    execFileSync(binary, [], { stdio: 'pipe' });
  } catch (e) {
    const out = `${e.stderr ?? ''}${e.stdout ?? ''}`;
    return /engine: (\S+)/.exec(out)?.[1] ?? null;
  }
  return null;
}

/** True when this machine can compile for `target` at all. */
function buildable(target) {
  if (target.startsWith('darwin')) return process.platform === 'darwin';
  if (target.startsWith('win32')) return process.platform === 'win32';
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  return process.platform === 'linux' && target === `linux-${arch}`;
}

function build(target) {
  if (!TARGETS[target]) {
    throw new Error(`unknown target ${target} (have: ${Object.keys(TARGETS).join(', ')})`);
  }

  const pkgDir = path.join(outRoot, `fjsc-${target}`);
  const ext = target.startsWith('win32') ? '.exe' : '';
  const binaries = [];
  for (const [flavor, { id, name }] of Object.entries(FLAVORS)) {
    const exe = `${name}${ext}`;
    const committed = path.join(prebuiltRoot, target, exe);
    let built;
    let origin;
    if (fs.existsSync(committed)) {
      // a binary CI produced — trust it over a local build, so `--all` gives the
      // same set of packages wherever it runs
      built = committed;
      origin = `prebuilt/${target}`;
    } else if (buildable(target)) {
      // the cmake target is always called fjsc; the flavor picks the file name
      built = compile(target, flavor, `fjsc${ext}`);
      origin = 'compiled';
    } else {
      throw new Error(
        `${target} cannot be built on ${process.platform}-${os.arch()} and ` +
          `packages/fjsc/prebuilt/${target}/${exe} is missing.\n` +
          `Run the "Build fjsc binaries" GitHub Actions workflow and unzip its ` +
          `fjsc-prebuilt artifact into packages/fjsc/ (nothing to commit).`,
      );
    }
    // a wrong flavor here is exactly what shipped in 0.1.4; only a binary
    // this machine can run can be asked
    let check = 'not verified on this machine';
    if (target === hostTarget()) {
      const got = reportedEngine(built);
      if (got !== id) {
        throw new Error(`${built} (${origin}) reports engine ${got ?? '(none)'}, expected ${id} for ${flavor}`);
      }
      check = `engine ${got}`;
    }
    binaries.push({ built, exe, origin, check });
  }

  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
  for (const { built, exe } of binaries) {
    fs.copyFileSync(built, path.join(pkgDir, 'bin', exe));
    fs.chmodSync(path.join(pkgDir, 'bin', exe), 0o755);
  }

  const [platform, arch] = target.split('-');
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify(
      {
        name: `@ufjs/fjsc-${target}`,
        version,
        description: `Prebuilt fjsc bytecode compilers (PrimJS + QuickJS-ng) for ${target}`,
        // the binaries link PrimJS (Apache-2.0) and QuickJS-ng (MIT)
        license: 'MIT AND Apache-2.0',
        repository: {
          type: 'git',
          url: 'git+https://github.com/snice/ufjs.git',
          directory: 'packages/fjsc',
        },
        os: [platform],
        cpu: [arch],
        files: ['bin', 'README.md', 'LICENSE', 'LICENSE-primjs', 'LICENSE-quickjs-ng'],
        publishConfig: { access: 'public' },
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(pkgDir, 'README.md'),
    `# @ufjs/fjsc-${target}\n\n` +
      `Prebuilt \`fjsc\` for \`${target}\`. Installed automatically as an optional\n` +
      `dependency of [\`@ufjs/cli\`](https://www.npmjs.com/package/@ufjs/cli) on this\n` +
      `platform; there is no reason to depend on it directly.\n\n` +
      `\`fjsc\` compiles a JS bundle to engine bytecode for \`fjs build --bytecode\`\n` +
      `and \`fjs build --release\`. The engine is linked into the binary, so there is\n` +
      `one per engine flavor:\n\n` +
      `| binary | engine |\n| --- | --- |\n` +
      `| \`bin/fjsc${ext}\` | ${FLAVORS.primjs.id} (default) |\n` +
      `| \`bin/fjsc-quickjs${ext}\` | ${FLAVORS.quickjs.id} (\`--js-engine quickjs\`) |\n\n` +
      `Both are built from the same sources the \`flutter_fjs\` runtime embeds.\n\n` +
      `MIT — bundles PrimJS (Apache-2.0, see LICENSE-primjs) and QuickJS-ng\n` +
      `(MIT, see LICENSE-quickjs-ng).\n`,
  );
  fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(pkgDir, 'LICENSE'));
  for (const license of ['LICENSE-primjs', 'LICENSE-quickjs-ng']) {
    fs.copyFileSync(path.join(repo, 'packages', 'flutter_fjs', license), path.join(pkgDir, license));
  }

  console.log(`    ${path.relative(repo, pkgDir)}`);
  for (const { exe, origin, check } of binaries) {
    const size = (fs.statSync(path.join(pkgDir, 'bin', exe)).size / 1024).toFixed(0);
    console.log(`      bin/${exe}  (${size} KB, ${origin}, ${check})`);
  }
}

const args = process.argv.slice(2);
const targets = args.includes('--all')
  ? Object.keys(TARGETS)
  : args.includes('--all-darwin')
    ? ['darwin-arm64', 'darwin-x64']
    : args.length > 0
      ? args
      : [hostTarget()];
try {
  for (const t of targets) build(t);
} catch (err) {
  console.error(`fjsc build: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
