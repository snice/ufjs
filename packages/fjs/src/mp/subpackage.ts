// Subpackage assignment and product URL rewriting (specs/063).
//
// Why string literals are rewritten at build time instead of handing the
// runtime a remap table: a static `<image src="/fb/background.png">` in wxml
// never passes through JS, so no runtime hook can see it. Once the emitted
// literals carry the file's real in-package path (`/game/wm/f1.png`), all
// three consumers — canvas loaders, fetch, <image> — just work and nothing
// downstream needs to know subpackages exist.
//
// Rewriting is confined to string literals / template heads with the same
// lexing rules as rewriteImports (comments never match). A URL glued into the
// middle of a longer string (`'go /wm/x'`) is neither rewritten nor guarded —
// the documented limitation; every fjs-known shape (whole-literal URLs,
// template-literal heads, wxml attribute values) is covered.
import type { MpPreloadRule, MpSubpackageConfig } from '../project/config.js';
import type { MpPage } from './project.js';

export type { MpPreloadRule, MpSubpackageConfig };

export interface AssignedSubpackage {
  root: string;
  pages: MpPage[];
  publicDirs: string[];
}

/** Top-level names the emitter itself owns — a subpackage root taking one
 * would interleave with generated dirs. */
const RESERVED_ROOTS = new Set(['pages', 'components', 'images', 'assets', 'workers', 'fjs', 'html']);

/** The mp.exclude matching rule, shared with subpackage `pages` fragments. */
export function matchesFragment(page: { path: string; name: string }, fragment: string): boolean {
  return page.path === fragment || page.path.includes(fragment) || page.name === fragment;
}

export function assignSubpackages(
  pages: MpPage[],
  configs: MpSubpackageConfig[],
): { ownerOf: Map<string, string>; subpackages: AssignedSubpackage[] } {
  const roots = configs.map((c) => c.root);
  for (const root of roots) {
    if (!root || root !== root.replace(/^\/+|\/+$/g, '')) {
      throw new Error(`[fjs/mp] subpackage root "${root}" must be a relative directory without leading/trailing slashes`);
    }
    if (!/^[A-Za-z0-9_][A-Za-z0-9_/-]*$/.test(root)) {
      throw new Error(`[fjs/mp] subpackage root "${root}" has characters outside [A-Za-z0-9_-/]`);
    }
    const first = root.split('/')[0];
    if (RESERVED_ROOTS.has(first)) {
      throw new Error(`[fjs/mp] subpackage root "${root}" collides with the reserved directory "${first}"`);
    }
  }
  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      if (roots[i] === roots[j] || roots[i].startsWith(roots[j] + '/') || roots[j].startsWith(roots[i] + '/')) {
        throw new Error(`[fjs/mp] subpackage roots "${roots[i]}" and "${roots[j]}" overlap`);
      }
    }
  }
  const claimedPublic = new Map<string, string>();
  for (const c of configs) {
    for (const dir of c.public ?? []) {
      if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(dir)) {
        throw new Error(`[fjs/mp] subpackage "${c.root}" public dir "${dir}" must be a single directory name`);
      }
      const owner = claimedPublic.get(dir);
      if (owner) throw new Error(`[fjs/mp] public dir "${dir}" is claimed by both "${owner}" and "${c.root}"`);
      claimedPublic.set(dir, c.root);
    }
  }

  const ownerOf = new Map<string, string>();
  const subpackages: AssignedSubpackage[] = configs.map((c) => ({
    root: c.root,
    pages: [],
    publicDirs: [...(c.public ?? [])],
  }));
  for (const page of pages) {
    const hits = configs.filter((c) => c.pages.some((frag) => matchesFragment(page, frag)));
    if (hits.length > 1) {
      throw new Error(
        `[fjs/mp] page ${page.path} matches several subpackages (${hits.map((h) => h.root).join(', ')}) — tighten the fragments`,
      );
    }
    if (!hits.length) continue;
    if (typeof page.meta.tab === 'number') {
      throw new Error(
        `[fjs/mp] tab page ${page.path} cannot go into subpackage "${hits[0].root}" — tabBar pages must stay in the main package`,
      );
    }
    ownerOf.set(page.name, hits[0].root);
    subpackages.find((s) => s.root === hits[0].root)!.pages.push(page);
  }
  return { ownerOf, subpackages };
}

/** Mini-program page path of a page, relative to the miniprogram root —
 * subpackaged pages carry their root (the shape routes.ts' `mpPage` and the
 * app.json preloadRule keys both need). */
export function mpPageOf(name: string, ownerOf: Map<string, string>): string {
  const root = ownerOf.get(name);
  return root ? `${root}/pages/${name}/${name}` : `pages/${name}/${name}`;
}

/** Translates `mp.preloadRule` (keyed by fjs route path) into WeChat's
 * app.json shape (keyed by real page path). Unknown routes, unknown package
 * roots and bad network values are build errors — a silent miss here shows
 * up on the phone as "this page never preloaded", which is exactly the kind
 * of quiet failure the build exists to prevent. */
export function translatePreloadRule(
  pages: MpPage[],
  ownerOf: Map<string, string>,
  roots: string[],
  config: Record<string, MpPreloadRule> = {},
): Record<string, MpPreloadRule> {
  const byRoute = new Map(pages.map((p) => [p.path, p]));
  const out: Record<string, MpPreloadRule> = {};
  for (const [route, rule] of Object.entries(config)) {
    const key = route.startsWith('/') ? route : `/${route}`;
    const page = byRoute.get(key);
    if (!page) throw new Error(`[fjs/mp] preloadRule key "${route}" does not match any route`);
    if (!rule?.packages?.length) {
      throw new Error(`[fjs/mp] preloadRule for "${route}" needs a non-empty packages array`);
    }
    if (rule.network && rule.network !== 'all' && rule.network !== 'wifi') {
      throw new Error(`[fjs/mp] preloadRule network for "${route}" must be "all" or "wifi"`);
    }
    for (const pkg of rule.packages) {
      if (pkg !== '__APP__' && !roots.includes(pkg)) {
        throw new Error(
          `[fjs/mp] preloadRule for "${route}" references package "${pkg}" — not a subpackages root (declared: ${roots.join(', ') || 'none'})`,
        );
      }
    }
    const mpPage = mpPageOf(page.name, ownerOf);
    out[mpPage] = rule.network ? { network: rule.network, packages: rule.packages } : { packages: rule.packages };
  }
  return out;
}

/** `from`/`to` path prefixes, e.g. `/wm/` -> `/game/wm/`. */
export interface PrefixPair {
  from: string;
  to: string;
}

function subPrefix(content: string, pairs: PrefixPair[]): string {
  for (const p of pairs) {
    if (content.startsWith(p.from)) return p.to + content.slice(p.from.length);
  }
  return content;
}

/** Visits every string literal and template text chunk with the same lexing
 * rules as rewriteImports — comments never produce chunks — and replaces
 * each chunk by the visitor's return value. Template `${ … }` expressions
 * are scanned as code, so string literals INSIDE them (`` `${ok ? '/wm/x' : ''}` ``)
 * are visited too; the brace-depth stack is what keeps template text and
 * expression code apart. */
function transformLiterals(
  code: string,
  visit: (content: string, kind: 'string' | 'template') => string,
): string {
  let out = '';
  let pos = 0; // emitted up to here
  let i = 0;
  // one entry per open template literal: the brace depth of the `${ … }`
  // expression it is currently in (0 = plain text chunk)
  const templates: number[] = [];
  const skipString = (start: number, quote: string): number => {
    let j = start + 1;
    while (j < code.length && code[j] !== quote) {
      if (code[j] === '\\') j++;
      j++;
    }
    return j + 1;
  };
  while (i < code.length) {
    if (templates.length === 0 || templates[templates.length - 1] > 0) {
      // code context (top level or a template expression)
      const ch = code[i];
      if (ch === '/' && code[i + 1] === '/') {
        const nl = code.indexOf('\n', i);
        i = nl < 0 ? code.length : nl;
        continue;
      }
      if (ch === '/' && code[i + 1] === '*') {
        const close = code.indexOf('*/', i);
        i = close < 0 ? code.length : close + 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const end = skipString(i, ch);
        out += code.slice(pos, i) + ch + visit(code.slice(i + 1, end - 1), 'string') + ch;
        pos = end;
        i = end;
        continue;
      }
      if (ch === '`') {
        templates.push(0);
        out += code.slice(pos, i) + '`';
        pos = i + 1;
        i++;
        continue;
      }
      if (templates.length) {
        if (ch === '{') templates[templates.length - 1]++;
        else if (ch === '}') {
          const top = templates.length - 1;
          templates[top]--;
          // expression closed: emit it verbatim, the next text chunk starts
          if (templates[top] === 0) {
            out += code.slice(pos, i + 1);
            pos = i + 1;
          }
        }
      }
      i++;
      continue;
    }
    // template text chunk
    const ch = code[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      out += visit(code.slice(pos, i), 'template') + '`';
      pos = i + 1;
      templates.pop();
      i++;
      continue;
    }
    if (ch === '$' && code[i + 1] === '{') {
      out += visit(code.slice(pos, i), 'template') + '${';
      pos = i + 2;
      templates[templates.length - 1] = 1;
      i += 2;
      continue;
    }
    i++;
  }
  return out + code.slice(pos);
}

/** Rewrites the leading path prefixes inside string literals and template
 * literal text chunks. A literal qualifies only when its content STARTS
 * with the prefix; a URL glued into the middle of a longer string is the
 * documented limitation. */
export function rewritePathPrefixes(code: string, pairs: PrefixPair[]): string {
  if (!pairs.length) return code;
  return transformLiterals(code, (content) => subPrefix(content, pairs));
}

/** Which of the prefixes appear at the start of some string literal or
 * template chunk — the guard for "a file outside the owning package still
 * references a moved public dir". Rewritten subpackage paths
 * (`"/game/spine/x"`) do not start with `/spine/` and never match. */
export function findPathPrefixes(code: string, prefixes: string[]): string[] {
  if (!prefixes.length) return [];
  const found = new Set<string>();
  transformLiterals(code, (content) => {
    for (const p of prefixes) {
      if (content.startsWith(p)) found.add(p);
    }
    return content;
  });
  return [...found];
}
