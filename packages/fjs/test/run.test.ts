import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  devicesFor,
  patchAndroidAbiFilters,
  patchAndroidToolchain,
  patchHostMain,
  selectDevServerPort,
  syncHostMain,
  syncNativeHostConfig,
  writeHostMain,
  writeHostPubspec,
  type DevPortProbe,
} from '../src/commands/run.js';
import { autolinkDartModule } from '../src/project/modules.js';
import { repointRelativePaths } from '../src/commands/host.js';

function probe(options: {
  fjs?: Record<number, string | null>;
  occupied?: number[];
}): DevPortProbe {
  return {
    async fjsDevServerRoot(port) {
      return options.fjs?.[port] ?? null;
    },
    async canConnect(_host, port) {
      return options.occupied?.includes(port) ?? false;
    },
  };
}

describe('selectDevServerPort', () => {
  const root = path.resolve('/tmp/fjs-app');
  const other = path.resolve('/tmp/other-fjs-app');

  it('reuses an existing fjs dev server for the same project', async () => {
    await expect(
      selectDevServerPort(38900, root, probe({ fjs: { 38900: root } })),
    ).resolves.toEqual({ port: 38900, reuseExisting: true, skipped: [] });
  });

  it('skips a port used by another fjs dev project', async () => {
    await expect(
      selectDevServerPort(38900, root, probe({ fjs: { 38900: other } })),
    ).resolves.toEqual({
      port: 38901,
      reuseExisting: false,
      skipped: [{ port: 38900, reason: `already used by another fjs dev project: ${other}` }],
    });
  });

  it('skips a port used by a non-fjs process', async () => {
    await expect(
      selectDevServerPort(38900, root, probe({ occupied: [38900] })),
    ).resolves.toEqual({
      port: 38901,
      reuseExisting: false,
      skipped: [{ port: 38900, reason: 'already in use by another process' }],
    });
  });

  it('can reuse the same project after skipping lower occupied ports', async () => {
    await expect(
      selectDevServerPort(
        38900,
        root,
        probe({ fjs: { 38900: other, 38901: root } }),
      ),
    ).resolves.toEqual({
      port: 38901,
      reuseExisting: true,
      skipped: [{ port: 38900, reason: `already used by another fjs dev project: ${other}` }],
    });
  });

  it('stops after the bounded probe range', async () => {
    await expect(
      selectDevServerPort(38900, root, probe({ occupied: [38900, 38901] }), 2),
    ).rejects.toThrow(/no free fjs dev port found from 38900 to 38901/);
  });
});

describe('syncNativeHostConfig', () => {
  it('updates marked Android and iOS native settings idempotently', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-host-config-'));
    try {
      fs.mkdirSync(path.join(dir, 'android/app/src/main'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'ios/Runner'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'ios/Runner.xcodeproj'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'android/app/build.gradle'),
        'android { defaultConfig { applicationId = "com.example.old" } }\n',
      );
      fs.writeFileSync(
        path.join(dir, 'android/app/src/main/AndroidManifest.xml'),
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n',
      );
      fs.writeFileSync(
        path.join(dir, 'ios/Runner.xcodeproj/project.pbxproj'),
        [
          'PRODUCT_BUNDLE_IDENTIFIER = com.example.old;',
          'PRODUCT_BUNDLE_IDENTIFIER = com.example.old.RunnerTests;',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(dir, 'ios/Runner/Info.plist'),
        '<?xml version="1.0"?><plist><dict></dict></plist>\n',
      );

      const config = {
        android: {
          applicationId: 'com.acme.demo',
          permissions: [
            'android.permission.INTERNET',
            'android.permission.ACCESS_NETWORK_STATE',
          ],
        },
        ios: {
          bundleIdentifier: 'com.acme.demo',
          infoPlist: {
            NSCameraUsageDescription: 'scan & "connect"',
          },
        },
      };
      syncNativeHostConfig(dir, config);
      syncNativeHostConfig(dir, config);

      const manifest = fs.readFileSync(
        path.join(dir, 'android/app/src/main/AndroidManifest.xml'),
        'utf8',
      );
      expect(manifest.match(/fjs: configured permissions/g)).toHaveLength(1);
      expect(manifest.match(/android:name=/g)).toHaveLength(2);
      expect(manifest).toContain('android.permission.ACCESS_NETWORK_STATE');

      expect(fs.readFileSync(path.join(dir, 'android/app/build.gradle'), 'utf8'))
        .toContain('applicationId = "com.acme.demo"');
      expect(fs.readFileSync(path.join(dir, 'ios/Runner.xcodeproj/project.pbxproj'), 'utf8'))
        .toContain('PRODUCT_BUNDLE_IDENTIFIER = com.acme.demo.RunnerTests;');

      const plist = fs.readFileSync(path.join(dir, 'ios/Runner/Info.plist'), 'utf8');
      expect(plist.match(/fjs: configured values/g)).toHaveLength(1);
      expect(plist).toContain('scan &amp; &quot;connect&quot;');
      // The dev server's transport, not a per-project choice: iOS 14+ denies
      // LAN connections outright — without ever prompting — when this key is
      // absent, and the failure surfaces as "No route to host" (spec 028).
      expect(plist).toContain('NSLocalNetworkUsageDescription');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('writeHostPubspec', () => {
  it('writes the configured app version, defaulting to 1.0.0+1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-host-pubspec-'));
    try {
      const pubspec = path.join(dir, 'pubspec.yaml');
      writeHostPubspec(pubspec, 'hello_fjs', [], '1.2.0+3');
      const text = fs.readFileSync(pubspec, 'utf8');
      expect(text).toContain('version: 1.2.0+3');

      // no app.config version → the historical hard-coded default
      writeHostPubspec(pubspec, 'hello_fjs');
      expect(fs.readFileSync(pubspec, 'utf8')).toContain('version: 1.0.0+1');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('syncNativeHostConfig orientation', () => {
  // shapes mirroring what `flutter create` emits: per-line activity
  // attributes, tab-indented plist entries
  const MANIFEST = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <application',
    '        android:label="demo">',
    '        <activity',
    '            android:name=".MainActivity"',
    '            android:exported="true"',
    '            android:windowSoftInputMode="adjustResize">',
    '            <intent-filter>',
    '                <action android:name="android.intent.action.MAIN"/>',
    '            </intent-filter>',
    '        </activity>',
    '    </application>',
    '</manifest>',
  ].join('\n');
  const PLIST = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>UISupportedInterfaceOrientations</key>',
    '\t<array>',
    '\t\t<string>UIInterfaceOrientationPortrait</string>',
    '\t\t<string>UIInterfaceOrientationLandscapeLeft</string>',
    '\t\t<string>UIInterfaceOrientationLandscapeRight</string>',
    '\t</array>',
    '\t<key>UISupportedInterfaceOrientations~ipad</key>',
    '\t<array>',
    '\t\t<string>UIInterfaceOrientationPortrait</string>',
    '\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>',
    '\t\t<string>UIInterfaceOrientationLandscapeLeft</string>',
    '\t\t<string>UIInterfaceOrientationLandscapeRight</string>',
    '\t</array>',
    '</dict>',
    '</plist>',
  ].join('\n');

  function hostWith(): { dir: string; manifest: () => string; plist: () => string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-host-orientation-'));
    fs.mkdirSync(path.join(dir, 'android/app/src/main'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'ios/Runner'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'android/app/src/main/AndroidManifest.xml'), MANIFEST);
    fs.writeFileSync(path.join(dir, 'ios/Runner/Info.plist'), PLIST);
    return {
      dir,
      manifest: () => fs.readFileSync(path.join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8'),
      plist: () => fs.readFileSync(path.join(dir, 'ios/Runner/Info.plist'), 'utf8'),
    };
  }

  it('locks landscape idempotently and requires fullscreen for the iPad lock', () => {
    const host = hostWith();
    try {
      syncNativeHostConfig(host.dir, { orientation: 'landscape' });
      syncNativeHostConfig(host.dir, { orientation: 'landscape' });

      const manifest = host.manifest();
      expect(manifest.match(/android:screenOrientation=/g)).toHaveLength(1);
      expect(manifest).toContain('android:screenOrientation="sensorLandscape"');

      const plist = host.plist();
      // both template arrays rewritten, no portrait entries survive
      expect(plist.match(/UIInterfaceOrientationLandscapeLeft/g)).toHaveLength(2);
      expect(plist).not.toContain('Portrait');
      // template indentation is preserved on the rewritten arrays
      expect(plist).toMatch(/\n\t<\/array>/);
      // the iPad multitasking opt-out is what makes the lock take effect
      expect(plist).toContain('<key>UIRequiresFullScreen</key>');
      expect(plist).toContain('<true/>');
    } finally {
      fs.rmSync(host.dir, { recursive: true, force: true });
    }
  });

  it('switches between portrait and landscape by rewriting the previous lock', () => {
    const host = hostWith();
    try {
      syncNativeHostConfig(host.dir, { orientation: 'landscape' });
      syncNativeHostConfig(host.dir, { orientation: 'portrait' });

      const manifest = host.manifest();
      expect(manifest.match(/android:screenOrientation=/g)).toHaveLength(1);
      expect(manifest).toContain('android:screenOrientation="portrait"');

      const plist = host.plist();
      expect(plist.match(/<string>UIInterfaceOrientationPortrait<\/string>/g)).toHaveLength(2);
      expect(plist).not.toContain('Landscape');
    } finally {
      fs.rmSync(host.dir, { recursive: true, force: true });
    }
  });

  it('leaves native files byte-identical without an orientation', () => {
    const host = hostWith();
    try {
      syncNativeHostConfig(host.dir, {});
      // only the managed NSLocalNetworkUsageDescription block is appended to
      // the plist; the template arrays and the activity tag stay untouched
      expect(host.manifest()).toBe(MANIFEST);
      expect(host.plist()).toContain('UIInterfaceOrientationPortraitUpsideDown');
      expect(host.plist()).not.toContain('UIRequiresFullScreen');
    } finally {
      fs.rmSync(host.dir, { recursive: true, force: true });
    }
  });
});

describe('syncNativeHostConfig iOS local-network default', () => {
  function plistAfterSync(config: Parameters<typeof syncNativeHostConfig>[1]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-host-plist-'));
    try {
      fs.mkdirSync(path.join(dir, 'ios/Runner'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'ios/Runner/Info.plist'),
        '<?xml version="1.0"?><plist><dict></dict></plist>\n',
      );
      syncNativeHostConfig(dir, config);
      return fs.readFileSync(path.join(dir, 'ios/Runner/Info.plist'), 'utf8');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('injects the local-network usage description with no ios config at all', () => {
    const plist = plistAfterSync({});
    expect(plist).toContain('NSLocalNetworkUsageDescription');
    expect(plist).toContain('fjs dev server');
  });

  it('lets app.config.ts override the default wording', () => {
    const plist = plistAfterSync({
      ios: { infoPlist: { NSLocalNetworkUsageDescription: '\u81ea\u5b9a\u4e49\u6587\u6848' } },
    });
    expect(plist.match(/NSLocalNetworkUsageDescription/g)).toHaveLength(1);
    expect(plist).toContain('\u81ea\u5b9a\u4e49\u6587\u6848');
    expect(plist).not.toContain('fjs dev server');
  });
});

describe('writeHostMain', () => {
  function generate(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-host-main-'));
    try {
      const file = path.join(dir, 'lib', 'main.dart');
      writeHostMain(file, 'demo');
      return fs.readFileSync(file, 'utf8');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('paints before connecting to the dev server', () => {
    // The order IS the fix (spec 030): awaiting the bootstrap first meant a
    // failed fetch threw before runApp ever ran — black screen, one uncaught
    // SocketException, nothing on the device. It also made iOS unwinnable:
    // the system permission sheet needs a foregrounded app with a UI.
    const main = generate();
    const runApp = main.indexOf('runApp(_FjsHostApp(engine: engine, dev: dev))');
    const connect = main.indexOf('connectDevString(dev)');
    expect(runApp).toBeGreaterThan(-1);
    expect(connect).toBeGreaterThan(-1);
    expect(runApp).toBeLessThan(connect);
  });

  it('keeps the release branch loading its assets before runApp', () => {
    // Release has no network and no permission sheet, so there is nothing to
    // wait out and no reason to flash a placeholder (spec 030 non-goal).
    const main = generate();
    const load = main.indexOf('await engine.loadReleaseAssets()');
    const runApp = main.indexOf("runApp(_FjsHostApp(engine: engine, dev: ''))");
    expect(load).toBeGreaterThan(-1);
    expect(runApp).toBeGreaterThan(load);
  });

  it('names the dev server in the placeholder', () => {
    // A bare spinner cannot tell "still starting" from "cannot reach the dev
    // server" — constitution V.
    expect(generate()).toContain('连接 dev server');
  });

  it('is static: the module list lives in fjs_autolink.dart, not here (spec 042)', () => {
    const main = generate();
    // no module import / register may leak into the one file a user edits
    expect(main).not.toMatch(/import 'package:(?!flutter)/);
    expect(main).not.toContain('.register(engine)');
    expect(main).toContain("import 'fjs_autolink.dart';");
    expect(main).toContain("import 'fjs_attach.dart';");
    const register = main.indexOf('fjsRegisterModules(engine);');
    const attach = main.indexOf('await fjsAttachHost(engine);');
    const dev = main.indexOf("const dev = String.fromEnvironment('FJS_DEV')");
    expect(register).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(register);
    expect(dev).toBeGreaterThan(attach);
  });
});

describe('host lib modules (spec 042)', () => {
  const QR_IMPORT = "import 'package:fjs_qrcode/fjs_qrcode.dart';\n";
  const entry = {
    module: { name: 'qrcode' },
    flutter: { package: 'fjs_qrcode' },
    dartImport: 'package:fjs_qrcode/fjs_qrcode.dart',
    register: 'FjsQrcode.register(engine)',
  } as never;

  it('autolinkDartModule puts imports and register calls in one function', () => {
    const source = autolinkDartModule([entry]);
    expect(source).toContain('// generated by fjs');
    expect(source).toContain(QR_IMPORT);
    expect(source).toContain('void fjsRegisterModules(FjsEngine engine) {');
    expect(source).toContain('  FjsQrcode.register(engine);\n');
  });

  it('autolinkDartModule still generates with no modules', () => {
    const source = autolinkDartModule([]);
    expect(source).toContain('void fjsRegisterModules(FjsEngine engine) {');
    expect(source).toContain('// no modules with a Flutter side');
    expect(source).not.toContain('.register(');
  });

  function sync(file: string, body: string | null, forceMain = false): string | null {
    if (body !== null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    syncHostMain(file, 'demo', forceMain);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  it('syncHostMain writes when missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-sync-main-'));
    try {
      const file = path.join(dir, 'lib', 'main.dart');
      expect(sync(file, null)).toContain('fjsRegisterModules(engine);');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('syncHostMain keeps a current main.dart — hand edits survive', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-sync-main-'));
    try {
      const file = path.join(dir, 'lib', 'main.dart');
      const handEdited = '// my own edits\nfjsRegisterModules(engine);\nawait fjsAttachHost(engine);\n';
      expect(sync(file, handEdited)).toBe(handEdited);
      expect(sync(file, handEdited, true)).not.toBe(handEdited);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('syncHostMain rewrites a pre-autolink main.dart once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-sync-main-'));
    try {
      const file = path.join(dir, 'lib', 'main.dart');
      // the pre-042 template registered modules inline; left alone it would
      // never call fjsRegisterModules and modules would silently stop
      const rewritten = sync(file, 'void main() {\n  FjsQrcode.register(engine);\n}\n');
      expect(rewritten).toContain('fjsRegisterModules(engine);');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function patch(file: string, body: string, autolink: unknown[]): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    patchHostMain(file, 'demo', autolink as never[]);
    return fs.readFileSync(file, 'utf8');
  }

  it('patchHostMain lifts inline registers into the generated modules, once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-patch-main-'));
    try {
      const file = path.join(dir, 'lib', 'main.dart');
      const old = [
        "import 'package:flutter/material.dart';",
        QR_IMPORT,
        'Future<void> main() async {',
        '  FjsQrcode.register(engine);',
        "  const dev = String.fromEnvironment('FJS_DEV');",
        '}',
      ].join('\n');
      const patched = patch(file, old, [entry]);
      // the inline call must GO — fjs_autolink.dart now carries it, and both
      // would register the module twice
      expect(patched).not.toContain('  FjsQrcode.register(engine);\n');
      expect(patched).toContain("import 'fjs_autolink.dart';");
      expect(patched).toContain('  fjsRegisterModules(engine);\n  await fjsAttachHost(engine);\n');
      // idempotent: a second run over an already-current main is a no-op
      expect(patch(file, patched, [entry])).toBe(patched);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('patchHostMain writes the generated main when the host has none', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-patch-main-'));
    try {
      const file = path.join(dir, 'lib', 'main.dart');
      patchHostMain(file, 'demo', []);
      expect(fs.readFileSync(file, 'utf8')).toContain('fjsRegisterModules(engine);');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('repointRelativePaths (spec 042)', () => {
  function repoint(text: string, oldDir: string, newDir: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-eject-'));
    const file = path.join(dir, 'pubspec.yaml');
    fs.writeFileSync(file, text);
    try {
      repointRelativePaths(file, oldDir, newDir);
      return fs.readFileSync(file, 'utf8');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const OLD = '/repo/app/.fjs/flutter';
  const NEW = '/repo/app/flutter';

  it('shortens relative paths when the host moves one level up', () => {
    expect(
      repoint('  flutter_fjs:\n    path: ../../../packages/flutter_fjs\n', OLD, NEW),
    ).toBe('  flutter_fjs:\n    path: ../../packages/flutter_fjs\n');
  });

  it('repoints dependency_overrides the same way, leaves bare values alone', () => {
    // a value without ./ or ../ is not a generated one — left alone
    expect(
      repoint(
        [
          'dependency_overrides:',
          '  flutter_fjs:',
          '    path: ../../../packages/flutter_fjs',
          '  host_pkg:',
          '    path: pkg',
        ].join('\n'),
        OLD,
        NEW,
      ),
    ).toBe(
      [
        'dependency_overrides:',
        '  flutter_fjs:',
        '    path: ../../packages/flutter_fjs',
        '  host_pkg:',
        '    path: pkg',
      ].join('\n'),
    );
  });

  it('keeps a path that points inside the moved directory valid', () => {
    expect(repoint('  local:\n    path: ./packages/local\n', OLD, NEW)).toBe(
      '  local:\n    path: ../.fjs/flutter/packages/local\n',
    );
  });
});

describe('patchAndroidToolchain', () => {
  function host(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-host-'));
    for (const [rel, body] of Object.entries(files)) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    return dir;
  }

  const groovySettings = [
    'plugins {',
    '    id "dev.flutter.flutter-plugin-loader" version "1.0.0"',
    '    id "com.android.application" version "8.3.0" apply false',
    '    id "org.jetbrains.kotlin.android" version "1.8.22" apply false',
    '}',
    '',
  ].join('\n');

  it('lifts a Groovy host past the versions Flutter warns about', () => {
    const dir = host({
      'android/gradle/wrapper/gradle-wrapper.properties':
        'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.4-all.zip\n',
      'android/settings.gradle': groovySettings,
      'android/app/build.gradle':
        'android {\n    compileOptions {\n        sourceCompatibility = JavaVersion.VERSION_1_8\n    }\n}\n',
    });
    try {
      patchAndroidToolchain(dir);
      expect(fs.readFileSync(path.join(dir, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8'))
        .toContain('gradle-8.14-all.zip');
      const settings = fs.readFileSync(path.join(dir, 'android/settings.gradle'), 'utf8');
      expect(settings).toContain('id "com.android.application" version "8.11.1"');
      expect(settings).toContain('id "org.jetbrains.kotlin.android" version "2.2.20"');
      // the loader is versioned independently — leave it alone
      expect(settings).toContain('flutter-plugin-loader" version "1.0.0"');
      expect(fs.readFileSync(path.join(dir, 'android/app/build.gradle'), 'utf8'))
        .toContain('JavaVersion.VERSION_17');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles the Kotlin DSL template and leaves newer versions alone', () => {
    const dir = host({
      'android/gradle/wrapper/gradle-wrapper.properties':
        'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.20-all.zip\n',
      'android/settings.gradle.kts': [
        'plugins {',
        '    id("com.android.application") version "8.11.1" apply false',
        '    id("org.jetbrains.kotlin.android") version "2.0.0" apply false',
        '}',
        '',
      ].join('\n'),
      'android/app/build.gradle.kts': 'android {\n}\n',
    });
    try {
      patchAndroidToolchain(dir);
      expect(fs.readFileSync(path.join(dir, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8'))
        .toContain('gradle-8.20-all.zip');
      const settings = fs.readFileSync(path.join(dir, 'android/settings.gradle.kts'), 'utf8');
      expect(settings).toContain('id("com.android.application") version "8.11.1"');
      expect(settings).toContain('id("org.jetbrains.kotlin.android") version "2.2.20"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent', () => {
    const dir = host({ 'android/settings.gradle': groovySettings });
    try {
      patchAndroidToolchain(dir);
      const once = fs.readFileSync(path.join(dir, 'android/settings.gradle'), 'utf8');
      patchAndroidToolchain(dir);
      expect(fs.readFileSync(path.join(dir, 'android/settings.gradle'), 'utf8')).toBe(once);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('patchAndroidAbiFilters', () => {
  function host(rel: string, body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-abi-'));
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return dir;
  }

  const app = [
    'android {',
    '    namespace = "com.example.demo"',
    '',
    '    defaultConfig {',
    '        applicationId = "com.example.demo"',
    '    }',
    '}',
    '',
  ].join('\n');

  it('injects Groovy into a Groovy host', () => {
    const dir = host('android/app/build.gradle', app);
    try {
      patchAndroidAbiFilters(dir);
      const out = fs.readFileSync(path.join(dir, 'android/app/build.gradle'), 'utf8');
      expect(out).toContain('def fjsAbis = [');
      expect(out).toContain('excludes += fjsAbis.values()');
      expect(out).not.toContain('mapOf(');
      // the pruning belongs to android {}, not defaultConfig {}
      expect(out.indexOf('fjsAbis')).toBeGreaterThan(out.indexOf('android {'));
      expect(out.indexOf('fjsAbis')).toBeLessThan(out.indexOf('defaultConfig {'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('injects Kotlin DSL into a build.gradle.kts host', () => {
    const dir = host('android/app/build.gradle.kts', app);
    try {
      patchAndroidAbiFilters(dir);
      const out = fs.readFileSync(path.join(dir, 'android/app/build.gradle.kts'), 'utf8');
      expect(out).toContain('val fjsAbis = mapOf(');
      expect(out).toContain('(project.property("target-platform") as String)');
      expect(out).not.toContain('def fjsAbis');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a host carrying the old abiFilters snippet', () => {
    const legacy = [
      'android {',
      '    defaultConfig {',
      '        // fjs: honour --target-platform for plugin jniLibs',
      '        if (project.hasProperty("target-platform")) {',
      '            def fjsSelected = ["arm64-v8a"]',
      '            if (!fjsSelected.isEmpty()) {',
      '                ndk {',
      '                    abiFilters.clear()',
      '                    abiFilters.addAll(fjsSelected)',
      '                }',
      '            }',
      '        }',
      '',
      '        applicationId = "com.example.demo"',
      '    }',
      '}',
      '',
    ].join('\n');
    const dir = host('android/app/build.gradle', legacy);
    try {
      patchAndroidAbiFilters(dir);
      const out = fs.readFileSync(path.join(dir, 'android/app/build.gradle'), 'utf8');
      expect(out).not.toContain('abiFilters');
      expect(out).toContain('excludes += fjsAbis.values()');
      expect(out.match(/fjs: honour --target-platform/g)).toHaveLength(1);
      expect(out).toContain('applicationId = "com.example.demo"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent', () => {
    const dir = host('android/app/build.gradle.kts', app);
    try {
      patchAndroidAbiFilters(dir);
      const once = fs.readFileSync(path.join(dir, 'android/app/build.gradle.kts'), 'utf8');
      patchAndroidAbiFilters(dir);
      expect(fs.readFileSync(path.join(dir, 'android/app/build.gradle.kts'), 'utf8')).toBe(once);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('devicesFor', () => {
  const devices = [
    { id: 'emulator-5554', name: 'Android Emulator', targetPlatform: 'android-x64', emulator: true },
    { id: '00008110', name: 'iPhone', targetPlatform: 'ios', emulator: false },
    // the ohos fork reports ohos-arm64 (emulator id 127.0.0.1:5555) and
    // ohos-x64 for its x86 emulator; a prefix, not an exact match
    { id: '127.0.0.1:5555', name: 'HarmonyOS Emulator', targetPlatform: 'ohos-arm64', emulator: true },
    { id: 'connx-ohos-x64', name: 'ohos x64 Emulator', targetPlatform: 'ohos-x64', emulator: true },
  ];

  it('keeps every ohos target prefix', () => {
    const ohos = devicesFor('ohos', devices);
    expect(ohos.map((d) => d.id)).toEqual(['127.0.0.1:5555', 'connx-ohos-x64']);
  });

  it('does not let ohos leak into the android/ios lists', () => {
    expect(devicesFor('android', devices).map((d) => d.id)).toEqual(['emulator-5554']);
    expect(devicesFor('ios', devices).map((d) => d.id)).toEqual(['00008110']);
  });

  it('drops unsupported devices everywhere', () => {
    const withDead = [
      ...devices,
      { id: 'dead-ohos', name: 'offline', targetPlatform: 'ohos-arm64', isSupported: false },
    ];
    expect(devicesFor('ohos', withDead).map((d) => d.id)).not.toContain('dead-ohos');
  });
});
