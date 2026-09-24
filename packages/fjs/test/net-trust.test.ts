// spec 107: what counts as "this machine" for the dev channels.
import { describe, expect, it } from 'vitest';
import { DEBUG_TOKEN_RE, isLoopbackAddress } from '../src/dev/net-trust.js';

describe('isLoopbackAddress', () => {
  it('accepts IPv4 / IPv6 loopback, IPv4-mapped too', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) {
      expect(isLoopbackAddress(a), a).toBe(true);
    }
  });
  it('rejects LAN, public, lookalike and missing addresses', () => {
    for (const a of ['192.168.1.20', '10.0.0.2', '::ffff:192.168.1.20', 'fe80::1', '1127.0.0.1', '127.0.0.1.evil', '', undefined, null]) {
      expect(isLoopbackAddress(a as string | undefined), String(a)).toBe(false);
    }
  });
});

describe('DEBUG_TOKEN_RE', () => {
  it('takes 32 lower-case hex digits only', () => {
    expect(DEBUG_TOKEN_RE.test('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(DEBUG_TOKEN_RE.test('0123456789ABCDEF0123456789abcdef')).toBe(false);
    expect(DEBUG_TOKEN_RE.test("0123456789abcdef0123456789abcde'")).toBe(false);
    expect(DEBUG_TOKEN_RE.test('0123456789abcdef')).toBe(false);
  });
});
