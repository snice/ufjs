// Locating the adb binary without making it a requirement.
//
// `fjs debug`'s reverse tunnel and `fjs run`'s stale-app cleanup both shell
// out to adb, but neither may assume it: the tunnel is an accelerator (the
// app's direct dial is the primary path) and the cleanup is best effort.
// adb ships inside the Android SDK every emulator/USB setup already has, so
// resolving it from the well-known SDK locations covers the users who never
// put platform-tools on PATH — and returning null otherwise keeps both
// callers working through their fallbacks.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** adb from PATH, then ANDROID_HOME / ANDROID_SDK_ROOT, then the SDK
 * directories the Android tooling creates by default on each OS. Null when
 * none of them has it — callers must treat that as "skip adb features". */
export function resolveAdb(): string | null {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates: string[] = [];
  for (const env of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const sdk = process.env[env];
    if (sdk) candidates.push(path.join(sdk, 'platform-tools', exe));
  }
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', exe),
    );
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      candidates.push(path.join(local, 'Android', 'Sdk', 'platform-tools', exe));
    }
  } else {
    candidates.push(path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', exe));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // last: whatever is on PATH (also covers a symlinked sdk/platform-tools).
  // `--version` because a bare spawn of a missing binary is ENOENT, which
  // spawnSync reports as an error object, not a nonzero status.
  const probe = spawnSync(exe, ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? exe : null;
}

/** Serials of the adb devices currently online and ready ("device" state —
 * unauthorized and offline ones can't serve a tunnel). Empty when adb is
 * missing or nothing is connected. */
export function adbDevices(): string[] {
  const adb = resolveAdb();
  if (!adb) return [];
  const out = spawnSync(adb, ['devices'], { encoding: 'utf8' });
  if (out.status !== 0 || !out.stdout) return [];
  return out.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('List'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map((parts) => parts[0] ?? '')
    .filter((serial) => serial.length > 0);
}
