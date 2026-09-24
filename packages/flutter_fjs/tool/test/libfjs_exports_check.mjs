#!/usr/bin/env node
// spec 116: what the shipped ELF libfjs.so files export. The version script
// is generated at build time (native/cmake/libfjs-exports.cmake); this reads
// the artifacts under abi/ and checks the result, so a toolchain that quietly
// ignores the script (or a debugger that outgrew it) is caught before publish.
//
//   node tool/test/libfjs_exports_check.mjs [--only android|ohos]   (NM=<nm> picks the tool)
//
// tool/build-android.sh and tool/build-ohos.sh run it for their platform.
//
// For every libfjs.so:
//   - quickjs exports fjs_* only (it has no debugger module);
//   - primjs exports fjs_* plus only symbols its debugger module imports;
//   - every fjs_* Dart looks up (lib/src/*.dart) is exported — by libfjs, or
//     by the debugger module for fjs_vm_debugger_*.
// Android additionally: every unversioned symbol the debugger imports, bar
// liblog's, is exported by libfjs. ohos links against musl, whose libc
// symbols carry no version either, so there the same guarantee comes from
// linking the module with --no-undefined (native/CMakeLists.txt).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NM = process.env.NM || 'nm';
const ANDROID_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : null;
if (only && only !== 'android' && only !== 'ohos') {
  console.error('usage: libfjs_exports_check.mjs [--only android|ohos]');
  process.exit(2);
}

function symbols(file, which) {
  const r = spawnSync(NM, ['-D', which === 'defined' ? '--defined-only' : '--undefined-only', file], {
    encoding: 'utf8',
  });
  if (r.error || r.status !== 0) {
    throw new Error(`${NM} failed on ${file}: ${r.error?.message ?? r.stderr}`);
  }
  // "addr T name" or "U name"
  return new Set(
    r.stdout
      .split('\n')
      .map((l) => l.trim().split(/\s+/).pop())
      .filter(Boolean),
  );
}

const dartLookups = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'lib', 'src'))) {
  if (!f.endsWith('.dart')) continue;
  const text = fs.readFileSync(path.join(ROOT, 'lib', 'src', f), 'utf8');
  for (const m of text.matchAll(/'(fjs_[a-z0-9_]+)'/g)) dartLookups.add(m[1]);
}

const cases = [];
for (const flavor of ['primjs', 'quickjs']) {
  for (const abi of ANDROID_ABIS) {
    cases.push({
      label: `${flavor}/android/${abi}`,
      engine: `abi/${flavor}/android/${abi}/libfjs.so`,
      debugger: flavor === 'primjs' ? `abi/${flavor}/android-debugger/${abi}/libfjs_debugger.so` : null,
      android: true,
    });
  }
  cases.push({
    label: `${flavor}/ohos/arm64-v8a`,
    engine: `abi/${flavor}/ohos/arm64-v8a/libfjs.so`,
    debugger: flavor === 'primjs' ? `abi/${flavor}/ohos/arm64-v8a/libfjs_debugger.so` : null,
    android: false,
  });
}

const problems = [];
for (const c of cases.filter((c) => !only || (only === 'android') === c.android)) {
  const engineFile = path.join(ROOT, c.engine);
  if (!fs.existsSync(engineFile)) {
    problems.push(`${c.label}: ${c.engine} missing`);
    continue;
  }
  const exports = symbols(engineFile, 'defined');
  const extra = [...exports].filter((s) => !s.startsWith('fjs_'));
  let debuggerExports = new Set();
  if (c.debugger) {
    const debuggerFile = path.join(ROOT, c.debugger);
    if (!fs.existsSync(debuggerFile)) {
      problems.push(`${c.label}: ${c.debugger} missing`);
      continue;
    }
    const imports = symbols(debuggerFile, 'undefined');
    debuggerExports = symbols(debuggerFile, 'defined');
    const unexplained = extra.filter((s) => !imports.has(s));
    if (unexplained.length) {
      problems.push(`${c.label}: exports ${unexplained.length} symbol(s) the debugger never imports, e.g. ${unexplained.slice(0, 3).join(', ')}`);
    }
    if (c.android) {
      const missing = [...imports].filter((s) => !s.includes('@') && !s.startsWith('__android_log') && !exports.has(s));
      if (missing.length) {
        problems.push(`${c.label}: debugger imports ${missing.length} symbol(s) libfjs does not export, e.g. ${missing.slice(0, 3).join(', ')}`);
      }
    }
  } else if (extra.length) {
    problems.push(`${c.label}: exports ${extra.length} non-fjs_* symbol(s) without a debugger module, e.g. ${extra.slice(0, 3).join(', ')}`);
  }
  for (const name of dartLookups) {
    const inDebugger = name.startsWith('fjs_vm_debugger_');
    if (inDebugger ? c.debugger && !debuggerExports.has(name) : !exports.has(name)) {
      problems.push(`${c.label}: Dart looks up ${name}, which ${inDebugger ? 'the debugger module' : 'libfjs'} does not export`);
    }
  }
  const size = (fs.statSync(engineFile).size / 1024).toFixed(0);
  console.log(`${c.label.padEnd(24)} libfjs.so ${size.padStart(5)} KB, exports ${exports.size} (${extra.length} for the debugger)`);
}

if (problems.length) {
  console.error(`libfjs exports check FAILED:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('libfjs exports check ok');
