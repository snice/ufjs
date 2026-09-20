// The flutter-target selection of `fjs build` (spec 083): one of
// --apk/--hap/--ipa/--aab per build, each requiring --release/--profile,
// --ipa darwin-only. The checks run before any build work, so rejecting
// here is observable without touching the filesystem.
import { describe, expect, it } from 'vitest';
import { buildCommand } from '../src/bundler/build.js';

describe('build flutter targets', () => {
  it('rejects two targets at once', async () => {
    await expect(buildCommand(['--release', '--apk', '--aab'])).rejects.toThrow(
      /pick one of --apk\/--hap\/--ipa\/--aab/,
    );
    await expect(buildCommand(['--release', '--ipa', '--hap'])).rejects.toThrow(
      /pick one of --apk\/--hap\/--ipa\/--aab/,
    );
  });

  it('rejects a target without --release/--profile', async () => {
    await expect(buildCommand(['--aab'])).rejects.toThrow(/--aab requires --release/);
    await expect(buildCommand(['--ipa'])).rejects.toThrow(/--ipa requires --release/);
  });

  it('rejects --ipa off macOS', async () => {
    if (process.platform === 'darwin') return; // the guard is platform-conditional
    await expect(buildCommand(['--release', '--ipa'])).rejects.toThrow(/needs macOS/);
  });
});
