// fjs autoimport — run the pub-package binding pipeline on demand
// (specs/160): pubspec + entry file, the fjs_introspect dump (cached on the
// autoimport list + pubspec.lock hash, `--force` re-dumps), then the host's
// lib/fjs_objects.dart and the project's src/fjs-objects.d.ts. `fjs run`
// does all of this in its host sync; the standalone command exists so a
// fresh clone gets the JS-side types without a device attached.
import path from 'node:path';
import { flutterDir } from '../project/config.js';
import { syncAutoimport, writeAutoimportTypes } from '../project/autoimport.js';

export function autoimportCommand(argv: string[], root = process.cwd()): void {
  let force = false;
  for (const arg of argv) {
    if (arg === '--force') force = true;
    else throw new Error(`fjs autoimport: unknown option ${arg}`);
  }
  const hostDir = path.resolve(root, flutterDir(root));
  const result = syncAutoimport({ root, hostDir, force });
  writeAutoimportTypes(root);
  if (result.packages.length === 0) {
    console.log('autoimport: nothing configured — add packages to package.json fjs.autoimport');
  } else {
    console.log(
      `autoimport: ${result.packages.map((p) => (p.version ? `${p.name}@${p.version}` : p.name)).join(', ')} — dumped ${result.dumped ? 'now' : 'from cache'}, ` +
        `${result.skippedMembers.length} member(s) skipped (listed above when any)`,
    );
  }
}
