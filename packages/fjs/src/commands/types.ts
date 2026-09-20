// fjs types — (re)generate the project's declaration files on demand.
//
// Four generated .d.ts files make the editor and vue-tsc see what fjs
// derives by convention: routes (src/pages), local assets (public/, html/),
// local modules and their components (src/modules). Every build, dev
// server and the Vite plugin already write them (the writers live in
// project/pages.ts, assets.ts, modules.ts); this command exposes the same
// generation directly, so a fresh checkout gets completions before the
// first `fjs dev`, and CI can pin staleness with --check.
//
// The writers' semantics are mirrored EXACTLY — including `null` meaning
// "this project doesn't grow this file (anymore)": writeIfChanged deletes
// a stale file when the generating condition stops holding, and --check
// has to flag the same cases or `fjs types && fjs types --check` could
// disagree.
import fs from 'node:fs';
import path from 'node:path';
import { colorByLevel } from '../terminal/colors.js';
import { routeTypesSource, scanPages, ROUTE_TYPES_FILE } from '../project/pages.js';
import { assetTypesSource, scanLocalAssets, ASSET_TYPES_FILE } from '../project/assets.js';
import {
  moduleComponentTypesSource,
  moduleDataDir,
  moduleTypesSource,
  MODULE_COMPONENT_TYPES_FILE,
  MODULE_TYPES_FILE,
  scanModules,
} from '../project/modules.js';

interface Generated {
  /** Path relative to the project root. */
  file: string;
  /** What the file should contain, or null when this project grows no
   * such file (and a stale one should be gone). */
  compute(): string | null;
}

function generators(root: string): Generated[] {
  const pages = scanPages(root);
  const assets = scanLocalAssets(root);
  const modules = scanModules(root);
  const routeFile = path.join(root, ROUTE_TYPES_FILE);
  const assetFile = path.join(root, ASSET_TYPES_FILE);
  const locals = modules.filter((mod) => mod.local);
  const dataTypes = modules.some((mod) =>
    fs.existsSync(path.join(moduleDataDir(root, mod.name), 'types.d.ts')),
  );
  const hasComponents = modules.some((mod) => mod.components.length + mod.widgets.length > 0);
  return [
    {
      file: ROUTE_TYPES_FILE,
      compute: () => (pages.length > 0 || fs.existsSync(routeFile) ? routeTypesSource(pages) : null),
    },
    {
      file: ASSET_TYPES_FILE,
      compute: () => (assets.images.length + assets.html.length > 0 || fs.existsSync(assetFile) ? assetTypesSource(assets) : null),
    },
    {
      file: MODULE_TYPES_FILE,
      compute: () => (locals.length > 0 || dataTypes ? moduleTypesSource(root, modules) : null),
    },
    {
      file: MODULE_COMPONENT_TYPES_FILE,
      compute: () => (hasComponents ? moduleComponentTypesSource(root, modules) : null),
    },
  ];
}

/** Outcome per file: what `fjs types` would do about it right now. */
export type TypesStatus = 'written' | 'unchanged' | 'skipped' | 'stale';

export interface TypesEntry {
  file: string;
  status: TypesStatus;
}

/** Computes what would change, optionally applying it. `write=false` is
 * the --check mode: identical judgment, zero writes. */
function run(root: string, write: boolean): TypesEntry[] {
  const entries: TypesEntry[] = [];
  for (const gen of generators(root)) {
    const abs = path.join(root, gen.file);
    const source = gen.compute();
    const exists = fs.existsSync(abs);
    if (source === null) {
      if (exists) {
        if (write) fs.rmSync(abs);
        entries.push({ file: gen.file, status: write ? 'written' : 'stale' });
      } else {
        entries.push({ file: gen.file, status: 'skipped' });
      }
      continue;
    }
    if (exists && fs.readFileSync(abs, 'utf8') === source) {
      entries.push({ file: gen.file, status: 'unchanged' });
      continue;
    }
    if (write) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, source);
    }
    entries.push({ file: gen.file, status: write ? 'written' : 'stale' });
  }
  return entries;
}

export function typesCommand(argv: string[], root = process.cwd()): void {
  let check = false;
  for (const arg of argv) {
    if (arg === '--check') check = true;
    else throw new Error(`fjs types: unknown option ${arg}`);
  }
  const entries = run(root, !check);

  for (const entry of entries) {
    if (entry.status === 'skipped') {
      console.log(`skipped   ${entry.file}  (nothing to declare)`);
    } else if (entry.status === 'unchanged') {
      console.log(`unchanged ${entry.file}`);
    } else if (entry.status === 'stale') {
      console.log(colorByLevel('warn', `stale     ${entry.file}  — run \`fjs types\``));
    } else {
      console.log(`wrote     ${entry.file}`);
    }
  }
  if (check && entries.some((e) => e.status === 'stale')) {
    process.exitCode = 1;
  }
}
