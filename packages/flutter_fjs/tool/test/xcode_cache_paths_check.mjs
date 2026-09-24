#!/usr/bin/env node
// spec 112: the Xcode-cache rules of bin/engine.dart's _dropXcodeCaches,
// checked against the directory layouts Flutter actually produces. There is
// no Dart SDK in every environment this repo is worked in, so the rules are
// mirrored here — keep the two in step (same names, same depth limit, same
// skipped bundles).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function dropXcodeCaches(dir, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === 'XCFrameworkIntermediates') {
      fs.rmSync(path.join(p, 'flutter_fjs'), { recursive: true, force: true });
      continue;
    }
    if (e.name === 'flutter_fjs') {
      fs.rmSync(path.join(p, 'flutter_fjs.framework'), { recursive: true, force: true });
      continue;
    }
    if (/\.(app|framework|dSYM)$/.test(e.name)) continue;
    dropXcodeCaches(p, depth + 1);
  }
}

const host = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-host-'));
const mk = (rel) => {
  fs.mkdirSync(path.join(host, rel), { recursive: true });
  fs.writeFileSync(path.join(host, rel, 'marker'), 'x');
};
const gone = [
  // flutter run ios (simulator / device)
  'build/ios/Debug-iphonesimulator/XCFrameworkIntermediates/flutter_fjs',
  'build/ios/Debug-iphoneos/XCFrameworkIntermediates/flutter_fjs',
  'build/ios/Debug-iphonesimulator/flutter_fjs/flutter_fjs.framework',
  // flutter run macos (derived data under build/macos)
  'build/macos/Build/Products/Debug/XCFrameworkIntermediates/flutter_fjs',
  'build/macos/Build/Products/Debug/flutter_fjs/flutter_fjs.framework',
];
const kept = [
  'build/ios/Debug-iphonesimulator/XCFrameworkIntermediates/other_plugin',
  'build/ios/Debug-iphonesimulator/other_plugin/other_plugin.framework',
  'build/ios/Debug-iphonesimulator/Runner.app/Frameworks/flutter_fjs.framework',
  'build/app/intermediates/merged_native_libs',
  'build/flutter_fjs/fjs-engine/jniLibs/arm64-v8a',
];
for (const rel of [...gone, ...kept]) mk(rel);
dropXcodeCaches(path.join(host, 'build'));

let fails = 0;
for (const rel of gone) {
  const ok = !fs.existsSync(path.join(host, rel));
  console.log(`${ok ? 'ok  ' : 'FAIL'} dropped ${rel}`);
  if (!ok) fails++;
}
for (const rel of kept) {
  const ok = fs.existsSync(path.join(host, rel, 'marker'));
  console.log(`${ok ? 'ok  ' : 'FAIL'} kept    ${rel}`);
  if (!ok) fails++;
}
// the spec 105 rule (build/<one level>/XCFrameworkIntermediates) on the same
// layout: prove it matched nothing, which is the bug this spec fixes
for (const rel of gone.slice(0, 1)) mk(rel);
let oldHits = 0;
for (const config of fs.readdirSync(path.join(host, 'build'))) {
  if (fs.existsSync(path.join(host, 'build', config, 'XCFrameworkIntermediates', 'flutter_fjs'))) oldHits++;
}
const oldOk = oldHits === 0;
console.log(`${oldOk ? 'ok  ' : 'FAIL'} the spec 105 one-level rule matches nothing on this layout`);
if (!oldOk) fails++;
fs.rmSync(host, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
