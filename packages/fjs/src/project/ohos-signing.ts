// HarmonyOS debug signing reuse (spec 113).
//
// DevEco's "Automatically generate signature" does two things: it asks AGC
// (behind a Huawei account login, no public CLI) for a debug certificate and
// profile, stored under ~/.ohos/config/, and it writes a `signingConfigs`
// entry — those file paths plus passwords encrypted with this machine's
// ~/.ohos/config/material — into the host's ohos/build-profile.json5. The
// host under .fjs is disposable, so the second half is lost on every
// rebuild while the certificate itself stays valid for a year. The first
// half cannot be scripted; the second can: whenever a host carries a
// signing config we keep a copy outside it, and when a host comes up empty
// we put the copy back before hvigor gets to fail 20s into the build.
//
// Why a copy of the build-profile text instead of assembling one from the
// files in ~/.ohos/config: the p12 password is random and only ever exists
// as ciphertext inside build-profile.json5, so the files alone are useless.
//
// Why a text scanner instead of a JSON5 parser: the file carries comments
// (fjs-go's does) and trailing commas (flutter create's does), which
// JSON.parse rejects, and re-serializing through a parser would rewrite a
// file that, on an ejected host, belongs to the user. Only the bytes of the
// `signingConfigs` array are ever read or replaced; the stored copy is that
// array verbatim, so DevEco's format and ciphertext round-trip untouched.
//
// Why the host wins over the store: a differing host config means the
// developer re-signed (new device, renewed profile); the store follows.
// Why per machine and per bundleName: the ciphertext only decrypts here,
// and the AGC profile is bound to one bundle-name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { opener } from '../commands/host.js';

export interface Span {
  start: number;
  end: number;
}

/** Location of the `"signingConfigs": [...]` array, `end` exclusive, or null
 * when the key is absent. Strings and comments are skipped, so a `]` inside
 * a password or the key name inside a comment cannot mislead it. */
export function findSigningConfigs(text: string): Span | null {
  let i = 0;
  // skips whitespace and comments from i, returns the next significant index
  const skip = (from: number): number => {
    let j = from;
    while (j < text.length) {
      const c = text[j];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') j++;
      else if (c === '/' && text[j + 1] === '/') {
        const nl = text.indexOf('\n', j);
        j = nl < 0 ? text.length : nl + 1;
      } else if (c === '/' && text[j + 1] === '*') {
        const close = text.indexOf('*/', j + 2);
        j = close < 0 ? text.length : close + 2;
      } else break;
    }
    return j;
  };
  // index just past the string starting at `from` (a quote)
  const stringEnd = (from: number): number => {
    const quote = text[from];
    let j = from + 1;
    while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  while (i < text.length) {
    const next = skip(i);
    if (next !== i) {
      i = next;
      continue;
    }
    const c = text[i];
    if (c !== '"' && c !== "'") {
      i++;
      continue;
    }
    const end = stringEnd(i);
    const key = text.slice(i + 1, end - 1);
    i = end;
    if (key !== 'signingConfigs') continue;
    let j = skip(i);
    if (text[j] !== ':') continue;
    j = skip(j + 1);
    if (text[j] !== '[') continue;
    const start = j;
    let depth = 0;
    while (j < text.length) {
      const k = skip(j);
      if (k !== j) {
        j = k;
        continue;
      }
      const ch = text[j];
      if (ch === '"' || ch === "'") {
        j = stringEnd(j);
        continue;
      }
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) return { start, end: j + 1 };
      }
      j++;
    }
    return null;
  }
  return null;
}

/** True for `[]` with only whitespace or comments between the brackets. */
export function isEmptyArray(array: string): boolean {
  return array.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/\s/g, '') === '[]';
}

export function replaceSpan(text: string, span: Span, replacement: string): string {
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

/** The certificate files a DevEco signing config points at. */
export function materialPaths(array: string): { storeFile?: string; profile?: string; certpath?: string } {
  const out: Record<string, string> = {};
  for (const m of array.matchAll(/"(storeFile|profile|certpath)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try {
      out[m[1]] ??= JSON.parse(`"${m[2]}"`);
    } catch {
      out[m[1]] ??= m[2];
    }
  }
  return out;
}

export function readBundleName(ohosDir: string): string | null {
  const file = path.join(ohosDir, 'AppScope', 'app.json5');
  if (!fs.existsSync(file)) return null;
  return /"bundleName"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? null;
}

export type Validity = { ok: true; expires: Date } | { ok: false; reason: string };

/** Checks what hvigor would otherwise reject 20s later: the files exist, and
 * the profile (a PKCS#7 wrapping plain JSON) names this bundle and has not
 * expired. Device UDIDs are not checked (spec 113 non-goal). */
export function checkSigning(array: string, bundleName: string, now = new Date()): Validity {
  const paths = materialPaths(array);
  for (const key of ['storeFile', 'profile', 'certpath'] as const) {
    const p = paths[key];
    if (!p) return { ok: false, reason: `saved config has no ${key}` };
    if (!fs.existsSync(p)) return { ok: false, reason: `${key} ${p} no longer exists` };
  }
  const profile = fs.readFileSync(paths.profile!).toString('latin1');
  const bundle = /"bundle-name"\s*:\s*"([^"]+)"/.exec(profile)?.[1];
  const notAfter = /"not-after"\s*:\s*(\d+)/.exec(profile)?.[1];
  if (!bundle || !notAfter) return { ok: false, reason: `cannot read ${paths.profile}` };
  if (bundle !== bundleName) {
    return { ok: false, reason: `saved profile is for ${bundle}, this host is ${bundleName}` };
  }
  const expires = new Date(Number(notAfter) * 1000);
  if (expires <= now) return { ok: false, reason: `saved profile expired ${day(expires)}` };
  return { ok: true, expires };
}

export function defaultStore(): string {
  return path.join(os.homedir(), '.fjs', 'ohos-signing');
}

function storeFile(store: string, bundleName: string): string {
  return path.join(store, `${bundleName}.json5`);
}

/** The stored array text, or null. The store file wraps the array under the
 * same key so findSigningConfigs reads it back. */
export function readStored(store: string, bundleName: string): string | null {
  const file = storeFile(store, bundleName);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const span = findSigningConfigs(text);
  return span ? text.slice(span.start, span.end) : null;
}

export function writeStored(store: string, bundleName: string, array: string, source: string): string {
  // the file holds ciphertext and certificate paths: keep it to this user
  fs.mkdirSync(store, { recursive: true, mode: 0o700 });
  const file = storeFile(store, bundleName);
  const text =
    `// fjs: HarmonyOS debug signing for ${bundleName} (spec 113)\n` +
    `// saved from ${source} at ${new Date().toISOString()}\n` +
    `// passwords are encrypted with this machine's ~/.ohos/config/material — not portable\n` +
    `{\n  "signingConfigs": ${array}\n}\n`;
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

export interface EnsureOptions {
  /** Open DevEco on a missing signature — a terminal user, not CI. */
  interactive?: boolean;
  store?: string;
  /** Replaces opening DevEco when interactive (tests). */
  open?: (ohosDir: string) => void;
  log?: (line: string) => void;
}

/** Makes sure the host's ohos project can be signed before any flutter or
 * hvigor work starts: saves a present config, restores a missing one, and
 * throws with the one-time DevEco step when neither is possible. */
export function ensureOhosSigning(flutterDir: string, opts: EnsureOptions = {}): void {
  const ohosDir = path.join(flutterDir, 'ohos');
  const profileFile = path.join(ohosDir, 'build-profile.json5');
  // no fork-generated host: let flutter report that in its own words
  if (!fs.existsSync(profileFile)) return;
  const log = opts.log ?? ((line: string) => console.log(line));
  const store = opts.store ?? defaultStore();
  const shown = display(ohosDir);

  const text = fs.readFileSync(profileFile, 'utf8');
  const span = findSigningConfigs(text);
  const bundleName = readBundleName(ohosDir);
  if (!span || !bundleName) {
    log(`fjs: ohos signing — cannot read ${span ? 'bundleName in AppScope/app.json5' : 'signingConfigs in build-profile.json5'} under ${shown}; leaving signing to DevEco`);
    return;
  }
  const current = text.slice(span.start, span.end);

  if (!isEmptyArray(current)) {
    // a present config is never rewritten, only mirrored into the store
    if (readStored(store, bundleName) !== current) {
      const file = writeStored(store, bundleName, current, profileFile);
      log(`fjs: ohos signing saved for ${bundleName} (${display(file)})`);
    }
    const check = checkSigning(current, bundleName);
    if (!check.ok) log(`fjs: warning: ohos signing in ${shown} looks unusable — ${check.reason.replace(/^saved /, '')}`);
    return;
  }

  const stored = readStored(store, bundleName);
  let reason = 'no saved one on this machine';
  if (stored) {
    const check = checkSigning(stored, bundleName);
    if (check.ok) {
      fs.writeFileSync(profileFile, replaceSpan(text, span, stored));
      log(`fjs: ohos signing restored for ${bundleName} (expires ${day(check.expires)})`);
      return;
    }
    reason = check.reason;
  }

  const lines = [
    `ohos signing — ${shown} has no signing config for ${bundleName} (${reason}). One-time step:`,
    '       DevEco Studio → File → Project Structure → Signing Configs →',
    '       tick "Automatically generate signature" → OK',
  ];
  // CI has no one to click in DevEco, and only macOS has a known launcher
  const open = opts.interactive
    ? (opts.open ?? (process.platform === 'darwin' ? openInDevEco : undefined))
    : undefined;
  if (open) {
    lines.push(`     opened ${shown} in DevEco Studio — re-run when done; fjs keeps the signature from then on.`);
    open(ohosDir);
  } else {
    lines.push(`     open ${shown} in DevEco Studio ("fjs host open ohos"), then re-run; fjs keeps the signature from then on.`);
  }
  throw new Error(lines.join('\n'));
}

function openInDevEco(ohosDir: string): void {
  const [cmd, args] = opener(ohosDir, 'ohos');
  // a failed open still leaves the printed instructions to follow
  spawnSync(cmd, args, { stdio: 'ignore' });
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function display(p: string): string {
  const rel = path.relative(process.cwd(), p);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  const home = os.homedir();
  return p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}
