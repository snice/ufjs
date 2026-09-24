#!/usr/bin/env node
// spec 115: libfjs_debugger.so must reach debug builds only. The rule lives
// in android/build.gradle (the debugger directory is a jniLibs source dir of
// the `debug` source set); its predecessor — a filter on `main` — was
// silently ignored by AGP, so this runs the real merge tasks of a real host
// and looks at what they produced instead of trusting the gradle file.
//
//   node tool/test/android_debugger_strip_check.mjs <host>/android [--keep]
//
// --keep builds with -PfjsKeepDebugger=true and expects the debugger in
// every variant.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const arg = args.find((a) => !a.startsWith('--'));
const androidDir = arg && path.resolve(arg);
if (!androidDir || !fs.existsSync(path.join(androidDir, 'settings.gradle')) && !fs.existsSync(path.join(androidDir, 'settings.gradle.kts'))) {
  console.error('usage: android_debugger_strip_check.mjs <flutter host>/android [--keep]');
  process.exit(2);
}

const VARIANTS = ['debug', 'profile', 'release'];
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];
const merged = path.resolve(androidDir, '..', 'build', 'flutter_fjs', 'intermediates', 'merged_jni_libs');

// stale outputs would pass or fail the check on their own
fs.rmSync(merged, { recursive: true, force: true });
const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const tasks = VARIANTS.map((v) => `:flutter_fjs:merge${v[0].toUpperCase()}${v.slice(1)}JniLibFolders`);
const r = spawnSync(gradlew, [...(keep ? ['-PfjsKeepDebugger=true'] : []), ...tasks, '--rerun-tasks', '-q'], {
  cwd: androidDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
});
if (r.error || r.status !== 0) {
  console.error(`gradle failed: ${r.error?.message ?? ''}\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  process.exit(1);
}

const problems = [];
for (const variant of VARIANTS) {
  const out = path.join(merged, variant);
  const files = fs.existsSync(out)
    ? fs.readdirSync(out, { recursive: true }).map((f) => f.toString().replaceAll('\\', '/'))
    : [];
  // AGP nests the ABI directories under a task-named folder; match by suffix
  const has = (abi, so) => files.some((f) => f.endsWith(`${abi}/${so}`));
  const wantDebugger = keep || variant === 'debug';
  for (const abi of ABIS) {
    if (!has(abi, 'libfjs.so')) problems.push(`${variant}: ${abi}/libfjs.so missing`);
    if (has(abi, 'libfjs_debugger.so') !== wantDebugger) {
      problems.push(`${variant}: ${abi}/libfjs_debugger.so ${wantDebugger ? 'missing' : 'present'}`);
    }
  }
  console.log(`${variant.padEnd(8)} ${files.filter((f) => f.endsWith('.so')).map((f) => f.split('/').slice(-2).join('/')).sort().join(' ')}`);
}

if (problems.length) {
  console.error(`android debugger strip check FAILED:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`android debugger strip check ok (${keep ? 'fjsKeepDebugger: every variant' : 'debugger in debug only'})`);
