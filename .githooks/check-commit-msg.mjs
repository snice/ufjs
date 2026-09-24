// Commit-message check for this repo (spec 110). AGENTS.md §7 asks for
// conventional commits; nothing enforced it, and titles such as
// "feat(pref): update" (16222fd: 25 files, none of it about performance)
// made the history unreadable. Opt-in: `git config core.hooksPath .githooks`.
//
// Deliberately narrow — it rejects a malformed title and a title that says
// nothing, and does no semantic guessing beyond that:
//   type(scope)!: summary    scope and `!` optional; types below
// Titles git writes itself (merges, reverts, fixup!/squash! for autosquash)
// pass untouched: rejecting them would only break git's own workflows.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TYPES = [
  'feat', 'fix', 'docs', 'chore', 'build', 'refactor',
  'test', 'perf', 'style', 'ci', 'revert',
];

// A summary that is ONLY one of these tells a reader nothing.
const VAGUE = new Set([
  'update', 'updates', 'fix', 'fixes', 'wip', 'tmp', 'temp', 'misc',
  'change', 'changes', 'stuff', 'minor',
  '修改', '更新', '调整', '优化', '修复', '改动',
]);

const TITLE = new RegExp(`^(${TYPES.join('|')})(\\([^()]+\\))?!?: (.+)$`);
const GIT_GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;

/** The first meaningful line of a commit message file: `#` comment lines
 * (git's template) and leading blank lines do not count. */
export function subjectOf(text) {
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('#') || line.trim() === '') continue;
    return line;
  }
  return '';
}

/** null when the message is fine, otherwise why it is not. */
export function checkCommitMessage(text) {
  const subject = subjectOf(text);
  if (!subject) return 'empty commit message';
  if (GIT_GENERATED.test(subject)) return null;
  const m = TITLE.exec(subject);
  if (!m) {
    return (
      `"${subject}" is not "type(scope): summary" — ` +
      `type is one of ${TYPES.join(', ')}`
    );
  }
  const summary = m[3].trim().replace(/[。.!！]+$/, '');
  if (VAGUE.has(summary.toLowerCase())) {
    return `the summary "${m[3].trim()}" does not say what changed`;
  }
  return null;
}

// CLI: node check-commit-msg.mjs <message file>  (what the hook runs)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const problem = checkCommitMessage(fs.readFileSync(file, 'utf8'));
  if (problem) {
    console.error(`commit-msg: ${problem}`);
    console.error('  e.g. fix(runtime): PrimJS 的 queueMicrotask 兜底不再吞异常');
    console.error('  (conventional commits, AGENTS.md §7; bypass once with --no-verify)');
    process.exit(1);
  }
}
