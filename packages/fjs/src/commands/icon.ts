// fjs icon — regenerate the app icons from one source PNG.
//
// No image library: resizing shells out to whatever the machine already
// has (sips on macOS, ImageMagick elsewhere), the same way the rest of this
// CLI shells out to flutter, adb and fjsc. A few tens of megabytes of
// native dependency to write a dozen PNGs is not a trade worth making.
//
// Both platforms are written in place over the files `flutter create` left
// behind, so nothing has to be registered: Android's mipmaps keep their
// densities, and iOS keeps the appiconset's Contents.json — the sizes are
// read back out of the filenames it already lists.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { flutterDir as configuredFlutterDir } from '../project/config.js';

/** Android launcher icon sizes, in dp * density. */
const ANDROID: Array<[string, number]> = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

interface IconOptions {
  source?: string;
  platforms: Array<'android' | 'ios'>;
  dryRun: boolean;
}

export function iconCommand(argv: string[]): void {
  const opts = parseArgs(argv);
  if (!opts.source) throw new Error('fjs icon needs a source png: fjs icon icon.png');
  const root = process.cwd();
  const source = path.resolve(root, opts.source);
  if (!fs.existsSync(source)) throw new Error(`no such file: ${opts.source}`);

  const image = readPng(source);
  if (image.width !== image.height) {
    console.warn(
      `warning: ${opts.source} is ${image.width}x${image.height}, not square — ` +
        'it will be squashed, not cropped',
    );
  }
  if (image.width < 1024) {
    console.warn(
      `warning: ${opts.source} is ${image.width}px wide; 1024px is the largest icon iOS asks for`,
    );
  }

  const resizer = findResizer();
  const dir = path.resolve(root, configuredFlutterDir(root));
  if (!fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
    throw new Error(
      `no Flutter host at ${path.relative(root, dir) || dir} — create it with fjs host create`,
    );
  }

  let written = 0;
  if (opts.platforms.includes('android')) {
    const res = path.join(dir, 'android', 'app', 'src', 'main', 'res');
    for (const [density, size] of ANDROID) {
      const out = path.join(res, density, 'ic_launcher.png');
      // only densities this host actually has, plus any round variant
      if (!fs.existsSync(path.dirname(out))) continue;
      written += emit(resizer, source, out, size, root, opts.dryRun);
      const round = path.join(res, density, 'ic_launcher_round.png');
      if (fs.existsSync(round)) {
        written += emit(resizer, source, round, size, root, opts.dryRun);
      }
    }
  }

  if (opts.platforms.includes('ios')) {
    const set = path.join(dir, 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset');
    if (fs.existsSync(set)) {
      if (image.hasAlpha) {
        console.warn(
          'warning: the source has an alpha channel. iOS app icons must be opaque —\n' +
            '         App Store Connect rejects transparency. Flatten it first.',
        );
      }
      for (const file of fs.readdirSync(set)) {
        const size = appiconSize(file);
        if (size === null) continue;
        written += emit(resizer, source, path.join(set, file), size, root, opts.dryRun);
      }
    } else if (opts.platforms.length === 1) {
      throw new Error(`no AppIcon.appiconset in ${path.relative(root, dir)}`);
    }
  }

  if (written === 0) {
    console.log('nothing to write — is the Flutter host complete?');
    return;
  }
  console.log(`${opts.dryRun ? 'would write' : 'wrote'} ${written} icons (via ${resizer.name})`);
  if (!opts.dryRun) console.log('rebuild the app to see them');
}

/** `Icon-App-83.5x83.5@2x.png` -> 167. Anything else is not an icon. */
function appiconSize(file: string): number | null {
  const found = /^Icon-App-([\d.]+)x[\d.]+@(\d+)x\.png$/.exec(file);
  if (!found) return null;
  return Math.round(Number(found[1]) * Number(found[2]));
}

function emit(
  resizer: Resizer,
  source: string,
  out: string,
  size: number,
  root: string,
  dryRun: boolean,
): number {
  const shown = path.relative(root, out);
  if (dryRun) {
    console.log(`  ${shown}  ${size}x${size}`);
    return 1;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const [cmd, args] = resizer.command(source, out, size);
  const result = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${resizer.name} failed on ${shown}:\n${result.stderr?.toString().trim() ?? result.error}`,
    );
  }
  console.log(`  ${shown}  ${size}x${size}`);
  return 1;
}

// ------------------------------------------------------------- resizer

/** The resizing backend + PNG header reader live here because the icon
 * command owns them; fjs splash reuses both (same no-image-library trade). */

export interface Resizer {
  name: string;
  command(source: string, out: string, size: number): [string, string[]];
}

export function findResizer(): Resizer {
  // sips ships with macOS; -z forces exact height and width
  if (process.platform === 'darwin' && has('sips')) {
    return {
      name: 'sips',
      command: (source, out, size) => [
        'sips',
        ['-z', String(size), String(size), source, '--out', out],
      ],
    };
  }
  for (const name of ['magick', 'convert']) {
    if (!has(name)) continue;
    return {
      name,
      // the ! suffix means "exactly this size", not "fit inside it"
      command: (source, out, size) => [
        name,
        [source, '-resize', `${size}x${size}!`, out],
      ],
    };
  }
  throw new Error(
    'no image resizer found. fjs icon uses one of:\n' +
      '  sips     — ships with macOS\n' +
      '  magick   — brew install imagemagick / apt install imagemagick',
  );
}

function has(cmd: string): boolean {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return probe.status === 0;
}

// ----------------------------------------------------------------- png

export interface Png {
  width: number;
  height: number;
  hasAlpha: boolean;
}

/** Reads IHDR. Doubles as the "is this actually a PNG" check — the resizer
 * would say so too, but only after writing a dozen broken files. */
export function readPng(file: string): Png {
  const head = Buffer.alloc(26);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, 26, 0);
  } finally {
    fs.closeSync(fd);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!head.subarray(0, 8).equals(signature)) {
    throw new Error(`${path.basename(file)} is not a PNG`);
  }
  const colorType = head[25];
  return {
    width: head.readUInt32BE(16),
    height: head.readUInt32BE(20),
    // 4 = grey+alpha, 6 = rgb+alpha
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

function parseArgs(argv: string[]): IconOptions {
  const opts: IconOptions = { platforms: ['android', 'ios'], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--platform') {
      const value = argv[++i];
      if (value !== 'android' && value !== 'ios') {
        throw new Error('--platform takes android or ios');
      }
      opts.platforms = [value];
    } else if (!arg.startsWith('-') && !opts.source) opts.source = arg;
    else throw new Error(`unknown icon option: ${arg}`);
  }
  return opts;
}
