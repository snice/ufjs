// The version-pairing core of fjs upgrade (spec 081): pick the newest
// runtime/flutter_fjs on the SAME minor as the target @ufjs/cli. The
// network edges (npm view, pub.dev) are environment-dependent and stay
// outside these tests.
import { describe, expect, it } from 'vitest';
import { compareVersions, sameMinor } from '../src/commands/upgrade.js';

describe('sameMinor', () => {
  it('picks the newest version on the CLI minor', () => {
    expect(
      sameMinor(['0.1.0', '0.1.4', '0.1.9', '0.2.0', '1.0.0'], '0.1.7'),
    ).toBe('0.1.9');
  });

  it('returns null when the registry has no such minor yet', () => {
    expect(sameMinor(['0.1.4'], '0.2.0')).toBeNull();
  });

  it('compares numerically, not lexically', () => {
    expect(sameMinor(['0.2.9', '0.2.10', '0.2.2'], '0.2.5')).toBe('0.2.10');
  });

  it('prefers the release over a prerelease of the same core', () => {
    expect(sameMinor(['0.2.0', '0.2.0-dev.3'], '0.2.0')).toBe('0.2.0');
  });
});

describe('compareVersions', () => {
  it('orders across majors, minors and patches', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.4', '0.1.4')).toBe(0);
  });

  it('sorts a prerelease below its release', () => {
    expect(compareVersions('0.2.0-dev.1', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.2.0-dev.1')).toBeGreaterThan(0);
  });
});
