// Project configuration: build settings stay in package.json, while native
// app settings live in the root-level app.config.ts.
//
// Settings live here rather than in flags when a later command has to
// remember them: `fjs host eject` moves the host, `fjs.shared` changes how
// every split build is chunked. Flags still win over the file.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

export const DEFAULT_FLUTTER_DIR = '.fjs/flutter';

export type PlistValue = string | number | boolean | string[] | number[];

export type AppOrientation = 'portrait' | 'landscape';

export interface AndroidHostConfig {
  applicationId?: string;
  permissions?: string[];
}

export interface IosHostConfig {
  bundleIdentifier?: string;
  infoPlist?: Record<string, PlistValue>;
}

export type WxmpRenderer = 'webview' | 'skyline';

export interface WxmpHostConfig {
  /** WeChat appid (wx + 16 hex), written into project.config.json. */
  appid?: string;
  /** Mini-program renderer (app.json `renderer`). Default 'webview' —
   * skyline needs base library >= 2.29 and fjs's downcast styles are
   * tuned for the webview baseline. */
  renderer?: WxmpRenderer;
  /** project.config.json `setting` entries, merged over fjs's defaults
   * (key by key; yours win). E.g. `{ minified: true }` for release. */
  setting?: Record<string, unknown>;
}

export interface AppConfig {
  /** App version written into the generated host pubspec (e.g. '1.2.0+3').
   * flutter build derives the Android versionName/versionCode and the iOS
   * CFBundleShortVersionString from it, so pubspec is the only injection
   * point needed. Default '1.0.0+1'. */
  version?: string;
  /** Locks the native host to one orientation. `landscape` maps to Android
   * `sensorLandscape` (both landscape directions, like the iOS list) so a
   * game held the other way up still reads correctly. On iOS this also
   * writes UIRequiresFullScreen — with iPad multitasking enabled the
   * orientation restriction is silently ignored without it. Leaving this
   * unset keeps Flutter's default (all orientations); removing it again
   * does not restore the files — regenerate via `fjs clean`. */
  orientation?: AppOrientation;
  android?: AndroidHostConfig;
  ios?: IosHostConfig;
  /** Mini-program target (fjs build --mp). */
  wxmp?: WxmpHostConfig;
}

const WXMP_APPID_RE = /^wx[0-9a-f]{16}$/;
// pubspec version grammar: x.y.z plus optional semver prerelease/build
// suffixes — failing here beats a cryptic YAML error from `flutter pub get`
const PUBSPEC_VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** One WeChat subPackages entry (specs/063): route fragments assign pages to
 * a subpackage root; `public` moves public/ subdirectories with them. */
export interface MpSubpackageConfig {
  /** Directory under the miniprogram root, no leading/trailing slash. */
  root: string;
  /** Route paths / path fragments / page names, same matching as mp.exclude. */
  pages: string[];
  /** public/ subdirectories (single names, e.g. "wm") shipped inside the
   * subpackage; product URLs are rewritten to /<root>/<dir>/… */
  public?: string[];
}

/** WeChat preloadRule value (specs/063). `packages` names subpackage roots
 * declared in `mp.subpackages` (or "__APP__" for the main package); network
 * defaults to WeChat's own "wifi". */
export interface MpPreloadRule {
  network?: 'all' | 'wifi';
  packages: string[];
}

export interface FjsConfig {
  /** Flutter host project directory, relative to the project root. */
  flutterDir?: string;
  /** Build-time performance budgets. */
  performance?: {
    /** Warn when a page's statically estimated first frame renders more nodes. */
    nodeBudget?: number;
  };
  /** Extra bare specifiers to put in the shared chunk of a `--pages`
   * build, on top of the built-in vue/fjs set. See [sharedBare]. */
  shared?: string[];
  /** What `fjs add` has installed. Informational — `fjs doctor` reads it. */
  packages?: string[];
  /** Mini-program build (`fjs build --mp`). */
  mp?: {
    /** Route paths / path fragments to leave out of app.json (the pages a
     * mini program cannot run — webgl, big canvas libs, ...). */
    exclude?: string[];
    /** The app shell component (nav bar + tab bar wrapper). Default:
     * src/Shell.vue when it exists. */
    shell?: string;
    /** Local components (e.g. the app's custom TabBar) removed from the mp
     * emission when the native tabBar takes over. Flutter/Web keep them. */
    excludeComponents?: string[];
    /** WeChat appid written to project.config.json. Default: touristappid. */
    appid?: string;
    /** WeChat subPackages (specs/063): pages matching a fragment emit under
     * the entry's root so the 2MB main-package cap only carries the shell,
     * the built-in component pages and the runtime. */
    subpackages?: MpSubpackageConfig[];
    /** WeChat preloadRule (specs/063), keyed by fjs route path (leading
     * slash optional) instead of the mini-program page path — the build
     * translates both directions. Packages reference `subpackages` roots. */
    preloadRule?: Record<string, MpPreloadRule>;
  };
}

const APP_CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.config.json'];
const APP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ANDROID_PERMISSION_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function readConfig(root = process.cwd()): FjsConfig {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      fjs?: FjsConfig;
    };
    return pkg.fjs ?? {};
  } catch {
    return {};
  }
}

/** Reads the optional native app config without adding a runtime loader
 * dependency. esbuild is already part of the CLI, and compiling the small
 * config file here also lets a new project use TypeScript immediately. */
export function readAppConfig(root = process.cwd()): AppConfig {
  const file = APP_CONFIG_FILES
    .map((name) => path.join(root, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!file) return {};

  let value: unknown;
  try {
    if (path.extname(file) === '.json') {
      value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      const source = fs.readFileSync(file, 'utf8');
      const transformed = esbuild.transformSync(source, {
        loader: path.extname(file) === '.ts' ? 'ts' : 'js',
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        sourcefile: file,
      }).code;
      const moduleValue: { exports: unknown } = { exports: {} };
      const evaluate = new Function(
        'module',
        'exports',
        'require',
        '__filename',
        '__dirname',
        transformed,
      ) as (
        module: { exports: unknown },
        exports: unknown,
        require: NodeRequire,
        filename: string,
        dirname: string,
      ) => void;
      evaluate(
        moduleValue,
        moduleValue.exports,
        createRequire(file),
        file,
        path.dirname(file),
      );
      const exported = moduleValue.exports as { default?: unknown };
      value = exported.default ?? moduleValue.exports;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not load ${path.basename(file)}: ${detail}`);
  }

  return validateAppConfig(value, file);
}

function validateAppConfig(value: unknown, file: string): AppConfig {
  if (!isRecord(value)) throw new Error(`${path.basename(file)} must export an object`);
  const config: AppConfig = {};
  if (value.version !== undefined) {
    if (typeof value.version !== 'string' || !PUBSPEC_VERSION_RE.test(value.version)) {
      throw new Error(
        `${path.basename(file)} version must be a pubspec version like 1.2.3 or 1.2.3+1`,
      );
    }
    config.version = value.version;
  }
  if (value.orientation !== undefined) {
    if (value.orientation !== 'portrait' && value.orientation !== 'landscape') {
      throw new Error(
        `${path.basename(file)} orientation must be 'portrait' or 'landscape'`,
      );
    }
    config.orientation = value.orientation;
  }
  if (value.android !== undefined) {
    if (!isRecord(value.android)) throw new Error(`${path.basename(file)} android must be an object`);
    const android: AndroidHostConfig = {};
    if (value.android.applicationId !== undefined) {
      android.applicationId = requirePattern(
        value.android.applicationId,
        APP_ID_RE,
        `${path.basename(file)} android.applicationId`,
      );
    }
    if (value.android.permissions !== undefined) {
      if (!Array.isArray(value.android.permissions)) {
        throw new Error(`${path.basename(file)} android.permissions must be an array`);
      }
      android.permissions = [...new Set(value.android.permissions.map((permission, index) =>
        requirePattern(
          permission,
          ANDROID_PERMISSION_RE,
          `${path.basename(file)} android.permissions[${index}]`,
        ),
      ))];
    }
    config.android = android;
  }
  if (value.ios !== undefined) {
    if (!isRecord(value.ios)) throw new Error(`${path.basename(file)} ios must be an object`);
    const ios: IosHostConfig = {};
    if (value.ios.bundleIdentifier !== undefined) {
      ios.bundleIdentifier = requirePattern(
        value.ios.bundleIdentifier,
        APP_ID_RE,
        `${path.basename(file)} ios.bundleIdentifier`,
      );
    }
    if (value.ios.infoPlist !== undefined) {
      if (!isRecord(value.ios.infoPlist)) {
        throw new Error(`${path.basename(file)} ios.infoPlist must be an object`);
      }
      ios.infoPlist = {};
      for (const [key, entry] of Object.entries(value.ios.infoPlist)) {
        if (!key || !isPlistValue(entry)) {
          throw new Error(
            `${path.basename(file)} ios.infoPlist.${key || '<empty>'} must be a plist scalar or array`,
          );
        }
        ios.infoPlist[key] = entry;
      }
    }
    config.ios = ios;
  }
  if (value.wxmp !== undefined) {
    if (!isRecord(value.wxmp)) throw new Error(`${path.basename(file)} wxmp must be an object`);
    const wxmp: WxmpHostConfig = {};
    if (value.wxmp.appid !== undefined) {
      wxmp.appid = requirePattern(
        value.wxmp.appid,
        WXMP_APPID_RE,
        `${path.basename(file)} wxmp.appid`,
      );
    }
    if (value.wxmp.renderer !== undefined) {
      const renderer = value.wxmp.renderer;
      if (renderer !== 'webview' && renderer !== 'skyline') {
        throw new Error(
          `${path.basename(file)} wxmp.renderer must be 'webview' or 'skyline'`,
        );
      }
      wxmp.renderer = renderer;
    }
    if (value.wxmp.setting !== undefined) {
      if (!isRecord(value.wxmp.setting)) {
        throw new Error(`${path.basename(file)} wxmp.setting must be an object`);
      }
      wxmp.setting = { ...value.wxmp.setting };
    }
    config.wxmp = wxmp;
  }
  return config;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePattern(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} must be a valid dot-separated identifier`);
  }
  return value;
}

function isPlistValue(value: unknown): value is PlistValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' || typeof entry === 'number');
}

/** Where the Flutter host lives: the configured directory, or the managed
 * one under `.fjs`. */
export function flutterDir(root = process.cwd()): string {
  return readConfig(root).flutterDir ?? DEFAULT_FLUTTER_DIR;
}

/** A host outside `.fjs` is the user's: `fjs` creates it and keeps its
 * assets in sync, but never rewrites its Dart or its pubspec again. */
export function isEjected(root = process.cwd()): boolean {
  return readConfig(root).flutterDir !== undefined;
}

/** Merges into the `fjs` field, preserving the rest of package.json —
 * including its indentation, because this file is in the user's repo. */
export function updateConfig(root: string, patch: FjsConfig): void {
  const file = path.join(root, 'package.json');
  const text = fs.readFileSync(file, 'utf8');
  const pkg = JSON.parse(text) as Record<string, unknown> & { fjs?: FjsConfig };
  pkg.fjs = { ...(pkg.fjs ?? {}), ...patch };
  const indent = /\n(\s+)"/.exec(text)?.[1] ?? '  ';
  fs.writeFileSync(file, JSON.stringify(pkg, null, indent) + '\n');
}
