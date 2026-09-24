#!/usr/bin/env node
// Pre-publish check for flutter_fjs (spec 105). `dart pub publish` collects
// files from disk, so what ships is whatever is on disk — this makes sure
// that is both engine flavors, complete, and nothing left over from the old
// copy-over-the-plugin materialization (spec 091).
//
//   node tool/check-publish.mjs          # report, exit 1 on any problem
//   node tool/check-publish.mjs --fix    # also restore ohos/libs from abi/
//   node tool/check-publish.mjs --root <package dir>
//
// Checks:
//  - both flavors' Android .so, iOS/macOS xcframeworks and ohos .so exist;
//    the debugger module exists for primjs and NOT for quickjs;
//  - ohos/libs (untracked, but what every ohos host packs — see
//    ohos/.pubignore) is byte-identical to abi/primjs/ohos, debugger
//    included: it must never ship a quickjs or debugger-less set;
//  - no xcframework contains a symlink (pub.dev rejects them);
//  - no required file is excluded by a .pubignore / .gitignore on its path
//    (pub reads a directory's .pubignore INSTEAD of its .gitignore);
//  - no leftovers of spec 091's materialization that would ship stale
//    copies (android/src/main/jniLibs, ios|macos/fjs*.xcframework,
//    Classes/fjs_engine_flavor.h, abi/.materialized).
//
// This is an approximation of pub's own file selection — confirm with
// `dart pub publish --dry-run` before publishing for real.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const rootArg = args.indexOf('--root');
const ROOT = path.resolve(
  rootArg >= 0 ? args[rootArg + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

const FLAVORS = ['primjs', 'quickjs'];
const ANDROID_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];
const problems = [];
const required = [];

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
function need(rel, why) {
  required.push(rel);
  if (!exists(rel)) problems.push(`missing ${rel}${why ? ` (${why})` : ''}`);
}
function forbid(rel, why) {
  if (exists(rel)) problems.push(`unexpected ${rel} — ${why}`);
}

for (const flavor of FLAVORS) {
  const debug = flavor === 'primjs';
  for (const abi of ANDROID_ABIS) {
    need(`abi/${flavor}/android/${abi}/libfjs.so`);
    const dbg = `abi/${flavor}/android/${abi}/libfjs_debugger.so`;
    debug ? need(dbg) : forbid(dbg, 'the debugger exists for primjs only');
  }
  for (const platform of ['ios', 'macos']) {
    need(`${platform}/abi/${flavor}/fjs.xcframework/Info.plist`);
    const dbg = `${platform}/abi/${flavor}/fjs_debugger.xcframework`;
    debug ? need(`${dbg}/Info.plist`) : forbid(dbg, 'the debugger exists for primjs only');
  }
  need(`abi/${flavor}/ohos/arm64-v8a/libfjs.so`);
  const dbg = `abi/${flavor}/ohos/arm64-v8a/libfjs_debugger.so`;
  debug ? need(dbg) : forbid(dbg, 'the debugger exists for primjs only');
}

// ohos/libs must be exactly the primjs set
const ohosSrc = 'abi/primjs/ohos/arm64-v8a';
const ohosLibs = 'ohos/libs/arm64-v8a';
const listFiles = (rel) =>
  exists(rel)
    ? fs.readdirSync(path.join(ROOT, rel)).filter((n) => fs.statSync(path.join(ROOT, rel, n)).isFile()).sort()
    : [];
const sameSet = () => {
  const a = listFiles(ohosSrc);
  const b = listFiles(ohosLibs);
  return (
    a.length > 0 &&
    a.join() === b.join() &&
    a.every((n) => fs.readFileSync(path.join(ROOT, ohosSrc, n)).equals(fs.readFileSync(path.join(ROOT, ohosLibs, n))))
  );
};
if (!sameSet() && fix && exists(ohosSrc)) {
  fs.rmSync(path.join(ROOT, 'ohos/libs'), { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, ohosLibs), { recursive: true });
  for (const n of listFiles(ohosSrc)) {
    fs.copyFileSync(path.join(ROOT, ohosSrc, n), path.join(ROOT, ohosLibs, n));
  }
  console.log(`fixed: ${ohosLibs} restored from ${ohosSrc}`);
}
if (!sameSet()) {
  problems.push(`${ohosLibs} is not identical to ${ohosSrc} (run with --fix to restore it)`);
} else {
  for (const n of listFiles(ohosLibs)) required.push(`${ohosLibs}/${n}`);
}

// symlinks anywhere under the xcframework trees
function findSymlinks(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isSymbolicLink()) out.push(child);
    else if (entry.isDirectory()) out.push(...findSymlinks(child));
  }
  return out;
}
for (const link of [...findSymlinks('ios/abi'), ...findSymlinks('macos/abi')]) {
  problems.push(`symlink ${link} — pub.dev rejects packages containing symlinks`);
}

// leftovers of the spec 091 copy-over materialization
for (const [rel, why] of [
  ['android/src/main/jniLibs', 'android/build.gradle reads abi/<flavor>/android now'],
  ['ios/fjs.xcframework', 'the podspec vendors ios/abi/<flavor>/ now'],
  ['ios/fjs_debugger.xcframework', 'the podspec vendors ios/abi/<flavor>/ now'],
  ['macos/fjs.xcframework', 'the podspec vendors macos/abi/<flavor>/ now'],
  ['macos/fjs_debugger.xcframework', 'the podspec vendors macos/abi/<flavor>/ now'],
  ['ios/Classes/fjs_engine_flavor.h', 'the flavor macro comes from the podspec now'],
  ['macos/Classes/fjs_engine_flavor.h', 'the flavor macro comes from the podspec now'],
  ['abi/.materialized', 'nothing materializes into the package anymore'],
]) {
  forbid(rel, `stale spec 091 materialization; delete it (${why})`);
}

// ignore rules on each required path: pub uses a directory's .pubignore
// instead of its .gitignore. Minimal gitignore semantics: `/` anchors to
// the ignore file's directory, a trailing `/` matches directories, `*` and
// `**` glob, a pattern without `/` matches any path segment.
function globRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
function ignoredBy(dirRel, rest) {
  const dir = path.join(ROOT, dirRel);
  const file = fs.existsSync(path.join(dir, '.pubignore'))
    ? '.pubignore'
    : fs.existsSync(path.join(dir, '.gitignore'))
      ? '.gitignore'
      : null;
  if (!file) return null;
  const segments = rest.split('/');
  let hit = null;
  for (const raw of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    const re = globRegex(line.replace(/^\//, ''));
    let matched = false;
    for (let i = 0; i < segments.length && !matched; i++) {
      const isDir = i < segments.length - 1;
      if (dirOnly && !isDir) continue;
      matched = anchored ? re.test(segments.slice(0, i + 1).join('/')) : re.test(segments[i]);
    }
    if (matched) hit = negate ? null : `${path.join(dirRel, file)}: ${raw.trim()}`;
  }
  return hit;
}
for (const rel of required) {
  if (!exists(rel)) continue;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    const hit = ignoredBy(parts.slice(0, i).join('/'), parts.slice(i).join('/'));
    if (hit) {
      problems.push(`${rel} would not be published — excluded by ${hit}`);
      break;
    }
  }
}

if (problems.length) {
  console.error(`flutter_fjs publish check FAILED (${ROOT}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`flutter_fjs publish check ok: ${required.length} shipped engine files in place (${ROOT})`);
console.log('next: dart pub publish --dry-run, and confirm the same files are listed');
