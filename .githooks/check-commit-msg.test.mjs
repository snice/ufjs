// spec 110: the commit-msg rules, plus a replay of this repo's own history
// so the rules stay calibrated against how people actually write here.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkCommitMessage, subjectOf } from './check-commit-msg.mjs';

const ok = (msg) => assert.equal(checkCommitMessage(msg), null, msg);
const bad = (msg, re) => assert.match(checkCommitMessage(msg) ?? '', re, msg);

test('accepts conventional titles, with and without scope / breaking mark', () => {
  ok('fix(runtime): PrimJS 的 queueMicrotask 兜底不再吞异常（spec 108）');
  ok('feat(debug,cli,runtime): fjs debug——Chrome DevTools 断点');
  ok('docs: 同步 specs 087–097 的用户可见变化');
  ok('refactor(dev)!: 去掉 units');
  ok('chore: 清理入库的构建产物与死代码（spec 109）\n\nbody\n\nCo-Authored-By: x');
});

test('passes titles git writes itself', () => {
  ok("Merge branch '102-image-mode-wechat-parity'");
  ok('Revert "feat(pref): update"');
  ok('fixup! fix(runtime): something');
  ok('squash! docs: something');
});

test('rejects malformed titles', () => {
  bad('update doc', /not "type\(scope\): summary"/);
  bad('fjs go test', /not "type\(scope\): summary"/);
  bad('feature(x): something real', /not "type\(scope\): summary"/);
  bad('fix(runtime):missing space', /not "type\(scope\): summary"/);
  bad('Fix(runtime): capitalised type', /not "type\(scope\): summary"/);
});

test('rejects a summary that says nothing', () => {
  bad('feat(pref): update', /does not say what changed/);
  bad('fix: fix', /does not say what changed/);
  bad('chore: WIP', /does not say what changed/);
  bad('fix(ui): 修复。', /does not say what changed/);
  // a vague word inside a real sentence is fine
  ok('fix(ui): update the tab underline position on first render');
});

test('ignores git template comments and leading blank lines', () => {
  assert.equal(subjectOf('\n# Please enter the commit message\n\nfeat: x y\n'), 'feat: x y');
  bad('# only comments\n\n', /empty commit message/);
});

test("replays this repository's history: only the known offenders fail", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let subjects;
  try {
    subjects = execFileSync('git', ['log', '--format=%s'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return; // not a git checkout (a tarball): nothing to replay
  }
  const known = new Set([
    "0.1.3",
    "0.1.3+",
    "2048",
    ":active",
    "add example tab",
    "app host config",
    "checkbox",
    "delay loadModel",
    "feat(mp):兼容anime",
    "feat(pref): update",
    "feat(webgl)",
    "fix module sync",
    "fix toast",
    "fix(canvas)",
    "fjs build auto check first frame",
    "fjs dev port autoincrement",
    "fjs go test",
    "fjs-go android",
    "fjsc",
    "fjs扩展",
    "heap",
    "hello-fjs item active",
    "init",
    "minify+gz",
    "open fetch api and devUri on the engine",
    "prepublish",
    "remove stack",
    "render node",
    "route",
    "scroll-view / swiper 属性补全",
    "touchevent",
    "transition",
    "update",
    "update doc",
    "update flutter_jsc  doc",
    "web router问题",
    "wip(diagnostics): 首帧文本行高静态诊断",
    "升级flutter",
    "统一组件一致性",
    "补充webview",
  ]);
  // ↑ pre-spec-110 history titles, grandfathered by the replay above
  const failing = subjects.filter((s) => checkCommitMessage(s) !== null);
  for (const s of failing) assert.ok(known.has(s), `unexpected rejection of an existing title: ${s}`);
});
