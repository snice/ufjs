// fjs devices — the android/ios/ohos devices `fjs run` can see, and which one
// it would pick. `flutter devices` prints every target including desktop and
// web; this is the same list filtered to what fjs actually runs on, with
// the ids in a column you can copy into `-d`.
import { devicesFor, listDevices, type FlutterDevice } from './run.js';

type Platform = 'android' | 'ios' | 'ohos';

const PLATFORMS: Platform[] = ['android', 'ios', 'ohos'];

// per-platform hint for the empty case — starting each kind of device is a
// different dance on every platform
const NONE_HINTS: Record<Platform, string> = {
  android: '  none — start one with `flutter emulators --launch <id>`',
  ios: '  none — start one with `open -a Simulator`',
  // ohos devices only appear through the OpenHarmony flutter fork's
  // device discovery; the stock tool cannot even see them
  ohos: '  none — needs the OpenHarmony flutter fork and a running\n' +
        '         emulator/device (DevEco Device Manager, or `hdc tconn <id>`)',
};

export function devicesCommand(argv: string[]): void {
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else throw new Error(`unknown devices option: ${arg}`);
  }

  const all = listDevices();
  const byPlatform = PLATFORMS.map((platform) => ({
    platform,
    devices: devicesFor(platform, all),
  }));

  if (json) {
    console.log(
      JSON.stringify(
        byPlatform.flatMap(({ platform, devices }) =>
          devices.map((device, index) => ({
            id: device.id,
            name: device.name,
            platform,
            target: device.targetPlatform,
            emulator: device.emulator === true,
            default: index === 0,
          })),
        ),
        null,
        2,
      ),
    );
    return;
  }

  if (all.length === 0) {
    console.log('no devices — is flutter installed and on PATH?');
    console.log('  fjs doctor checks the toolchain');
    return;
  }

  for (const { platform, devices } of byPlatform) {
    console.log(platform);
    if (devices.length === 0) {
      console.log(NONE_HINTS[platform]);
      continue;
    }
    const rows = devices.map((device, index) => [
      index === 0 ? '*' : ' ',
      device.id,
      device.name,
      kind(device),
    ]);
    const widths = [1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length)));
    for (const row of rows) {
      console.log(
        `  ${row[0]} ${row[1].padEnd(widths[0])}  ${row[2].padEnd(widths[1])}  ${row[3]}`,
      );
    }
  }

  console.log(`\n* = what \`fjs run <platform>\` picks; override with -d <id>`);
}

/** Emulators are listed first and preferred because they reach the dev
 * server on a host-local address; a physical device needs the LAN. The ohos
 * fork reports emulator for every device it discovers (emulatorId = id), so
 * an ohos row saying "emulator" does not mean the host-loopback shortcut
 * exists — deviceAddress routes ohos over the LAN either way. */
function kind(device: FlutterDevice): string {
  return device.emulator === true ? 'emulator' : 'physical';
}
