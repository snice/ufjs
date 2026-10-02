// specs/182: does an enableVapor app need the Vue renderer after all?
//
// A pure-vapor bundle has no Vue renderer (specs/166/169): pages, the shell
// and the project's components are vapor, fjs's own controls run on the
// render host (specs/171). A third-party VDOM component library (vant,
// nutui, …) is the case that does not fit — its components are compiled
// render functions that need runtime-dom / the fjs renderer, getCurrentInstance,
// createApp for imperative overlays. Those apps get the interop bundled
// ("按需带 interop", the user's call in specs/181): pages stay vapor, the
// library's components mount through the real renderer.
//
// The test is static, before anything is bundled: the third-party packages
// the project's sources import, and whether any of them ships VDOM-compiled
// components — the marker is what Vue's template compiler and JSX plugin
// emit (`createVNode`, `openBlock`, `createElementBlock`, `createBlock`). A
// composable-only library (pinia, @vueuse/core) has none, and a library of
// render functions written with `h()` (@vueuse/motion's components) runs on
// the render host, so neither turns the interop on.
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../project/config.js';
import { usesEnableVapor } from './vue-plugin.js';

// imported FROM 'vue': leafer has a createBlock of its own
const VDOM_MARKER = /\bimport\s*\{[^}]*\b(?:createVNode|openBlock|createElementBlock|createBlock)\b[^}]*\}\s*from\s*['"]vue['"]/;
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|vue)$/;
/** Files followed per package before giving up — a barrel that re-exports
 * components reaches one within a few hops. */
const SCAN_LIMIT = 400;

const detected = new Map<string, string[]>();
const announced = new Set<string>();

/** The bare package specifiers a project's own sources import. */
function importedPackages(root: string): Set<string> {
  const out = new Set<string>();
  const visit = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && !e.name.startsWith('.') && depth > 0) visit(full, depth - 1);
        continue;
      }
      if (!SOURCE_EXT.test(e.name) || e.name.endsWith('.d.ts')) continue;
      const code = fs.readFileSync(full, 'utf8');
      for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g)) {
        const spec = m[2];
        if (/^(?:\.|\/|@\/|node:|fjs(?:\/|$)|@ufjs\/|vue(?:\/|$)|@vue\/|virtual:)/.test(spec)) continue;
        out.add(spec);
      }
    }
  };
  visit(path.join(root, 'src'), 12);
  return out;
}

function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function packageDir(root: string, name: string): string | null {
  let dir = root;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function asFile(base: string): string | null {
  for (const f of [base, `${base}.mjs`, `${base}.js`, path.join(base, 'index.mjs'), path.join(base, 'index.js')]) {
    try {
      if (fs.statSync(f).isFile()) return f;
    } catch {
      // try the next shape
    }
  }
  return null;
}

/** The file a specifier lands on: a deep path as written, the package's
 * ESM entry otherwise (exports '.' → module → main). */
function entryFile(dir: string, spec: string): string | null {
  const name = packageName(spec);
  const sub = spec.slice(name.length).replace(/^\//, '');
  if (sub) return asFile(path.join(dir, sub));
  let pkg: { module?: string; main?: string; exports?: unknown };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const pick = (e: unknown): string | null => {
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      for (const k of ['.', 'import', 'module', 'browser', 'default']) {
        if (k in o) {
          const r = pick(o[k]);
          if (r) return r;
        }
      }
    }
    return null;
  };
  const rel = pick(pkg.exports) ?? pkg.module ?? pkg.main ?? 'index.js';
  return asFile(path.join(dir, rel));
}

/** Whether the code reachable from [file] (relative imports only, bounded)
 * carries VDOM-compiled output. */
function shipsVdom(file: string): boolean {
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length && seen.size < SCAN_LIMIT) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    let code: string;
    try {
      code = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (VDOM_MARKER.test(code)) return true;
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
      const next = asFile(path.resolve(path.dirname(f), m[2]));
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return false;
}

/** Third-party packages the project imports that ship VDOM components. */
export function vdomComponentLibs(root: string): string[] {
  const cached = detected.get(root);
  if (cached) return cached;
  const libs = new Set<string>();
  for (const spec of importedPackages(root)) {
    const name = packageName(spec);
    if (libs.has(name)) continue;
    const dir = packageDir(root, name);
    if (!dir) continue;
    const file = entryFile(dir, spec);
    if (file && shipsVdom(file)) libs.add(name);
  }
  const list = [...libs].sort();
  detected.set(root, list);
  return list;
}

/** specs/182: an enableVapor app that needs the VDOM interop — forced by
 * `fjs.vapor.interop`, detected otherwise. False for every non-enableVapor
 * app (those always carry the interop; nothing to decide). */
export function usesVaporInterop(root: string, entry?: string): boolean {
  if (!usesEnableVapor(root, entry)) return false;
  const forced = readConfig(root).vapor?.interop;
  if (typeof forced === 'boolean') return forced;
  const libs = vdomComponentLibs(root);
  if (libs.length && !announced.has(root)) {
    announced.add(root);
    console.log(
      `[fjs] enableVapor: VDOM component library detected (${libs.join(', ')}) — ` +
        'bundling the Vue renderer for interop (fjs.vapor.interop: false turns it off)',
    );
  }
  return libs.length > 0;
}
