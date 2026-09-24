// spec 113: HarmonyOS debug signing survives a disposable host. The scanner
// must only ever touch the signingConfigs array's bytes, and a restore must
// never write back a config hvigor would reject anyway.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkSigning,
  ensureOhosSigning,
  findSigningConfigs,
  isEmptyArray,
  replaceSpan,
} from '../src/project/ohos-signing';

// what `flutter create --platforms ohos` emits: trailing comma, no comments
const created = `{
  "app": {
    "signingConfigs": [],
    "products": [
      {
        "name": "default",
        "signingConfig": "default",
        "runtimeOS": "HarmonyOS",
      }
    ],
  },
  "modules": []
}`;

// fjs-go's checked-in file: a comment that names the key before the key
const commented = `{
  "app": {
    // DevEco writes "signingConfigs": [ ... ] here; kept empty in git
    /* "signingConfigs": [1] */
    "signingConfigs": [ /* none */ ],
    "products": []
  }
}`;

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-ohos-signing-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const slice = (text: string) => {
  const span = findSigningConfigs(text);
  return span && text.slice(span.start, span.end);
};

/** A fake ~/.ohos/config: p12/cer plus a p7b whose embedded JSON carries
 * the fields checkSigning reads, wrapped in binary noise like PKCS#7. */
function material(name: string, bundle: string, notAfter: number): string {
  const dir = path.join(tmp, 'ohos-config');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, name);
  fs.writeFileSync(`${base}.p12`, Buffer.from([0x30, 0x82, 0x04]));
  fs.writeFileSync(`${base}.cer`, '-----BEGIN CERTIFICATE-----');
  const json = `{"type":"debug","bundle-info":{"bundle-name":"${bundle}"},"validity":{"not-before":1700000000,"not-after":${notAfter}}}`;
  fs.writeFileSync(`${base}.p7b`, Buffer.concat([Buffer.from([0x30, 0x82, 0xff, 0x00]), Buffer.from(json, 'latin1')]));
  return `[
      {
        "name": "default",
        "type": "HarmonyOS",
        "material": {
          "certpath": ${JSON.stringify(`${base}.cer`)},
          "keyAlias": "debugKey",
          "keyPassword": "0000001B]x[{\\"}",
          "profile": ${JSON.stringify(`${base}.p7b`)},
          "signAlg": "SHA256withECDSA",
          "storeFile": ${JSON.stringify(`${base}.p12`)},
          "storePassword": "0000001A9F"
        }
      }
    ]`;
}

const future = Math.floor(Date.now() / 1000) + 3600 * 24 * 300;

/** A host tree with AppScope/app.json5 and build-profile.json5. */
function host(profile: string, bundle = 'com.example.hello_fjs'): { flutterDir: string; file: string } {
  const flutterDir = path.join(tmp, 'flutter');
  fs.mkdirSync(path.join(flutterDir, 'ohos', 'AppScope'), { recursive: true });
  fs.writeFileSync(
    path.join(flutterDir, 'ohos', 'AppScope', 'app.json5'),
    `{\n  "app": {\n    "bundleName": "${bundle}",\n    "vendor": "example",\n  }\n}\n`,
  );
  const file = path.join(flutterDir, 'ohos', 'build-profile.json5');
  fs.writeFileSync(file, profile);
  return { flutterDir, file };
}

describe('findSigningConfigs (spec 113)', () => {
  it('finds the array in a flutter-create file with trailing commas', () => {
    expect(slice(created)).toBe('[]');
  });

  it('skips the key when it only appears inside comments', () => {
    expect(slice(commented)).toBe('[ /* none */ ]');
    expect(isEmptyArray(slice(commented)!)).toBe(true);
  });

  it('is not misled by brackets inside strings', () => {
    const array = material('a', 'com.example.hello_fjs', future);
    const text = created.replace('"signingConfigs": []', `"signingConfigs": ${array}`);
    expect(slice(text)).toBe(array);
    expect(isEmptyArray(array)).toBe(false);
  });

  it('returns null without the key', () => {
    expect(findSigningConfigs('{ "app": { "products": [] } }')).toBeNull();
  });

  it('replaces only the array bytes', () => {
    const span = findSigningConfigs(commented)!;
    const out = replaceSpan(commented, span, '[1]');
    expect(out.slice(0, span.start)).toBe(commented.slice(0, span.start));
    expect(out.slice(span.start + 3)).toBe(commented.slice(span.end));
  });
});

describe('checkSigning (spec 113)', () => {
  it('accepts a matching, unexpired profile', () => {
    const check = checkSigning(material('a', 'com.example.hello_fjs', future), 'com.example.hello_fjs');
    expect(check.ok).toBe(true);
  });

  it('names the reason when a file is gone, the bundle differs or it expired', () => {
    const gone = material('b', 'com.example.hello_fjs', future);
    fs.rmSync(path.join(tmp, 'ohos-config', 'b.p12'));
    expect(checkSigning(gone, 'com.example.hello_fjs')).toMatchObject({ ok: false, reason: /storeFile .*b\.p12 no longer exists/ });
    expect(checkSigning(material('c', 'dev.flutterjs.fjsgo', future), 'com.example.hello_fjs')).toMatchObject({
      ok: false,
      reason: /is for dev\.flutterjs\.fjsgo/,
    });
    expect(checkSigning(material('d', 'com.example.hello_fjs', 1700000001), 'com.example.hello_fjs')).toMatchObject({
      ok: false,
      reason: /expired 2023-11-14/,
    });
  });
});

describe('ensureOhosSigning (spec 113)', () => {
  const store = () => path.join(tmp, 'store');
  const quiet = { log: () => {} };

  it('saves a present config, and the host wins over an older copy', () => {
    const first = material('a', 'com.example.hello_fjs', future);
    const { flutterDir, file } = host(created.replace('"signingConfigs": []', `"signingConfigs": ${first}`));
    const before = fs.readFileSync(file, 'utf8');
    const logs: string[] = [];
    ensureOhosSigning(flutterDir, { store: store(), log: (l) => logs.push(l) });
    const saved = path.join(store(), 'com.example.hello_fjs.json5');
    expect(slice(fs.readFileSync(saved, 'utf8'))).toBe(first);
    expect(fs.statSync(saved).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(logs.join('\n')).toMatch(/signing saved for com\.example\.hello_fjs/);

    const second = material('b', 'com.example.hello_fjs', future);
    fs.writeFileSync(file, created.replace('"signingConfigs": []', `"signingConfigs": ${second}`));
    ensureOhosSigning(flutterDir, { store: store(), ...quiet });
    expect(slice(fs.readFileSync(saved, 'utf8'))).toBe(second);
  });

  it('restores a saved config into an empty host, leaving the rest byte for byte', () => {
    const array = material('a', 'com.example.hello_fjs', future);
    const { flutterDir, file } = host(created.replace('"signingConfigs": []', `"signingConfigs": ${array}`));
    ensureOhosSigning(flutterDir, { store: store(), ...quiet });

    fs.writeFileSync(file, created);
    const logs: string[] = [];
    ensureOhosSigning(flutterDir, { store: store(), log: (l) => logs.push(l) });
    expect(fs.readFileSync(file, 'utf8')).toBe(created.replace('"signingConfigs": []', `"signingConfigs": ${array}`));
    expect(logs.join('\n')).toMatch(/signing restored for com\.example\.hello_fjs \(expires \d{4}-\d{2}-\d{2}\)/);
  });

  it('throws with the reason and writes nothing back when the saved config is unusable', () => {
    const cases: [string, string, number, RegExp][] = [
      ['gone', 'com.example.hello_fjs', future, /no longer exists/],
      ['other', 'dev.flutterjs.fjsgo', future, /is for dev\.flutterjs\.fjsgo/],
      ['old', 'com.example.hello_fjs', 1700000001, /expired/],
    ];
    for (const [name, bundle, notAfter, reason] of cases) {
      const array = material(name, bundle, notAfter);
      if (name === 'gone') fs.rmSync(path.join(tmp, 'ohos-config', 'gone.p7b'));
      fs.mkdirSync(store(), { recursive: true });
      fs.writeFileSync(path.join(store(), 'com.example.hello_fjs.json5'), `{ "signingConfigs": ${array} }`);
      const { flutterDir, file } = host(created);
      expect(() => ensureOhosSigning(flutterDir, { store: store(), ...quiet })).toThrow(reason);
      expect(fs.readFileSync(file, 'utf8')).toBe(created);
    }
  });

  it('asks for the one-time DevEco step when nothing is saved', () => {
    const { flutterDir } = host(created);
    expect(() => ensureOhosSigning(flutterDir, { store: store(), ...quiet })).toThrow(
      /no signing config for com\.example\.hello_fjs \(no saved one on this machine\)[\s\S]*Automatically generate signature/,
    );
  });

  it('opens DevEco only when interactive', () => {
    const { flutterDir } = host(created);
    const opened: string[] = [];
    const open = (dir: string) => opened.push(dir);
    expect(() => ensureOhosSigning(flutterDir, { store: store(), open, ...quiet })).toThrow();
    expect(opened).toEqual([]);
    expect(() => ensureOhosSigning(flutterDir, { store: store(), open, interactive: true, ...quiet })).toThrow(/opened/);
    expect(opened).toEqual([path.join(flutterDir, 'ohos')]);
  });

  it('leaves hosts without an ohos project alone', () => {
    const flutterDir = path.join(tmp, 'plain');
    fs.mkdirSync(flutterDir);
    expect(() => ensureOhosSigning(flutterDir, { store: store(), ...quiet })).not.toThrow();
    expect(fs.existsSync(store())).toBe(false);
  });
});
