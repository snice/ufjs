// compiler-vapor can inline a v-for binding that is *only* the :key and
// skip its renderEffect (keyOnlyBindingPatterns). A bare identifier
// (`{{ i }}`, `{{ item }}`) never gets an AST, so the pattern does not
// match and every cell still pays an effect. On an ONCE list (numeric
// `v-for="i in 40"`, v-once, a literal const) that value is written once
// and never again — the effect tracks nothing that changes.
//
// This walks the generated setup and, for those lists only:
// - a body that is one template + one text write becomes repeatTemplate
//   (one batch of clones, no per-cell callback machinery);
// - any other effect whose reads are only the loop variables runs once,
//   in place, instead of inside renderEffect.
// An effect that reads a prop or a ref is left alone, so `{{ count }}`
// inside `v-for="i in 40"` still updates.

const FOR_ONCE = 4;

function isIdentChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}

/** `_setText` / `setText` — the prefix is the underscores compiler-sfc
 * puts on a renamed helper, nothing else. */
function helperIs(ident: string, name: string): boolean {
  if (ident === name) return true;
  if (!ident.endsWith(name)) return false;
  return /^_+$/.test(ident.slice(0, -name.length));
}

function repeatName(forLocal: string): string {
  if (forLocal === 'createFor') return 'repeatTemplate';
  return forLocal.slice(0, -'createFor'.length) + 'repeatTemplate';
}

interface Hit {
  identStart: number;
  identEnd: number;
  paren: number;
}

function nextHelper(code: string, from: number, end: number, name: string): Hit | null {
  let i = from;
  let quote: string | null = null;
  while (i < end) {
    const c = code[i];
    if (quote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      const n = code.indexOf('\n', i);
      i = n < 0 || n >= end ? end : n + 1;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const n = code.indexOf('*/', i + 2);
      i = n < 0 || n >= end ? end : n + 2;
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      i++;
      while (i < end && isIdentChar(code[i])) i++;
      const ident = code.slice(start, i);
      if (helperIs(ident, name)) {
        let j = i;
        while (j < end && (code[j] === ' ' || code[j] === '\n' || code[j] === '\t' || code[j] === '\r')) j++;
        if (code[j] === '(') return { identStart: start, identEnd: i, paren: j };
      }
      continue;
    }
    i++;
  }
  return null;
}

interface Arg {
  start: number;
  end: number;
}

function parseArgs(code: string, paren: number): { args: Arg[]; end: number } | null {
  let i = paren + 1;
  const args: Arg[] = [];
  let argStart = i;
  let depth = 1;
  let quote: string | null = null;
  while (i < code.length) {
    const c = code[i];
    if (quote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      const n = code.indexOf('\n', i);
      i = n < 0 ? code.length : n + 1;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const n = code.indexOf('*/', i + 2);
      i = n < 0 ? code.length : n + 2;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        if (c !== ')') return null;
        const slice = code.slice(argStart, i);
        if (slice.trim() || args.length > 0) args.push({ start: argStart, end: i });
        return { args, end: i + 1 };
      }
    } else if (c === ',' && depth === 1) {
      args.push({ start: argStart, end: i });
      i++;
      argStart = i;
      continue;
    }
    i++;
  }
  return null;
}

function flagValue(raw: string | undefined): number {
  if (raw == null) return 0;
  let i = 0;
  while (i < raw.length && (raw[i] === ' ' || raw[i] === '\n' || raw[i] === '\t' || raw[i] === '\r')) i++;
  if (raw[i] < '0' || raw[i] > '9') return 0;
  let n = 0;
  while (i < raw.length && raw[i] >= '0' && raw[i] <= '9') {
    n = n * 10 + (raw.charCodeAt(i) - 48);
    i++;
  }
  return n;
}

function splitArrow(fn: string): { params: string; body: string } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < fn.length; i++) {
    const c = fn[i];
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '=' && fn[i + 1] === '>' && depth === 0) {
      const params = fn.slice(0, i).trim();
      let body = fn.slice(i + 2).trim();
      if (!body.startsWith('{') || !body.endsWith('}')) return null;
      body = body.slice(1, -1);
      return { params, body };
    }
  }
  return null;
}

function paramNames(params: string): string[] {
  const inner = params.startsWith('(') && params.endsWith(')') ? params.slice(1, -1) : params;
  const names: string[] = [];
  for (const part of inner.split(',')) {
    const name = part.trim();
    if (name && isIdentStart(name[0])) names.push(name);
  }
  return names;
}

function topStatements(body: string): string[] {
  const stmts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '/' && body[i + 1] === '/') {
      const n = body.indexOf('\n', i);
      i = n < 0 ? body.length - 1 : n;
      continue;
    }
    if (c === '/' && body[i + 1] === '*') {
      const n = body.indexOf('*/', i + 2);
      i = n < 0 ? body.length - 1 : n + 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if ((c === '\n' || c === ';') && depth === 0) {
      const s = body.slice(start, i).trim();
      if (s) stmts.push(s);
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) stmts.push(tail);
  return stmts;
}

function unwrapEffect(stmt: string): { effect: boolean; inner: string } | null {
  const open = stmt.indexOf('(');
  if (open < 0) return { effect: false, inner: stmt };
  const callee = stmt.slice(0, open).trim();
  if (!helperIs(callee, 'renderEffect')) return { effect: false, inner: stmt };
  // renderEffect(() => EXPR) — EXPR may itself contain parens
  const rest = stmt.slice(open);
  if (!rest.startsWith('(() => ') && !rest.startsWith('(()=>')) return null;
  const arrow = rest.indexOf('=>');
  if (arrow < 0 || !rest.endsWith(')')) return null;
  const inner = rest.slice(arrow + 2, -1).trim();
  if (inner.startsWith('{')) return null;
  return { effect: true, inner };
}

const KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'void', 'typeof', 'in', 'of']);

function exprSafe(expr: string, allowed: Set<string>): boolean {
  if (expr.includes('=>') || expr.includes('${')) return false;
  const re = /[A-Za-z_$][\w$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    const id = m[0];
    if (expr[m.index - 1] === '.') continue;
    if (KEYWORDS.has(id)) continue;
    if (allowed.has(id)) continue;
    if (helperIs(id, 'toDisplayString') || helperIs(id, 'setText') || helperIs(id, 'setHtml')) continue;
    return false;
  }
  return true;
}

interface Cell {
  tpl: string;
  expr: string;
  locals: Set<string>;
}

/** `const root = t0(); const mid = child(root); const text = txt(mid);
 * setText(text, EXPR); return root` — child() is optional (the text element
 * is the template root). Nothing else. */
function matchCell(body: string): Cell | null {
  const stmts = topStatements(body);
  let root = '';
  let tpl = '';
  let cursor = '';
  let text = '';
  let expr = '';
  let returned = false;
  const locals = new Set<string>();
  for (const stmt of stmts) {
    if (returned) return null;
    const unwrapped = unwrapEffect(stmt);
    if (unwrapped == null) return null;
    const line = unwrapped.inner;
    if (!root) {
      const m = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\(\)$/.exec(line);
      if (!m) return null;
      root = m[1];
      tpl = m[2];
      cursor = root;
      locals.add(root);
      continue;
    }
    const decl = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)$/.exec(line);
    if (decl && helperIs(decl[2], 'child') && decl[3] === cursor && !text) {
      cursor = decl[1];
      locals.add(decl[1]);
      continue;
    }
    if (decl && helperIs(decl[2], 'txt') && decl[3] === cursor && !expr) {
      text = decl[1];
      locals.add(text);
      continue;
    }
    if (!expr && text) {
      const call = /^([A-Za-z_$][\w$]*)\(/.exec(line);
      if (call && helperIs(call[1], 'setText')) {
        const parsed = parseArgs(line, call[0].length - 1);
        if (parsed && parsed.args.length === 2 && line.slice(parsed.args[0].start, parsed.args[0].end).trim() === text) {
          expr = line.slice(parsed.args[1].start, parsed.args[1].end).trim();
          continue;
        }
      }
    }
    if (line === `return ${root}` && expr) {
      returned = true;
      continue;
    }
    return null;
  }
  if (!returned || !expr) return null;
  return { tpl, expr, locals };
}

function tryRepeat(rep: string, args: string[]): string | null {
  const block = args[1];
  if (block == null) return null;
  const arrow = splitArrow(block.trim());
  if (!arrow) return null;
  const cell = matchCell(arrow.body);
  if (!cell) return null;
  const allowed = new Set(paramNames(arrow.params));
  for (const name of cell.locals) allowed.add(name);
  if (!exprSafe(cell.expr, allowed)) return null;
  const key = (args[2] ?? 'undefined').trim();
  const flags = (args[3] ?? '0').trim();
  return `${rep}(${cell.tpl}, ${args[0].trim()}, ${arrow.params} => (${cell.expr}), ${key}, ${flags})`;
}

function tryInline(local: string, args: string[]): string | null {
  const block = args[1];
  if (block == null) return null;
  const arrow = splitArrow(block.trim());
  if (!arrow) return null;
  const allowed = new Set(paramNames(arrow.params));
  for (const m of arrow.body.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)/g)) allowed.add(m[1]);
  const stmts = topStatements(arrow.body);
  let changed = false;
  const next = stmts.map((stmt) => {
    const unwrapped = unwrapEffect(stmt);
    if (unwrapped == null || !unwrapped.effect) return stmt;
    if (!exprSafe(unwrapped.inner, allowed)) return stmt;
    changed = true;
    return unwrapped.inner;
  });
  if (!changed) return null;
  const key = (args[2] ?? 'undefined').trim();
  const flags = (args[3] ?? '0').trim();
  return `${local}(${args[0].trim()}, ${arrow.params} => {\n${next.join('\n')}\n}, ${key}, ${flags})`;
}

function transformRegion(code: string, start: number, end: number): { text: string; repeat: string | null } {
  let text = '';
  let repeat: string | null = null;
  let i = start;
  while (i < end) {
    const hit = nextHelper(code, i, end, 'createFor');
    if (!hit) {
      text += code.slice(i, end);
      break;
    }
    const parsed = parseArgs(code, hit.paren);
    if (!parsed) {
      text += code.slice(i, hit.identEnd);
      i = hit.identEnd;
      continue;
    }
    text += code.slice(i, hit.identStart);
    const local = code.slice(hit.identStart, hit.identEnd);
    const argTexts = parsed.args.map((a, idx) => {
      if (idx !== 1) return code.slice(a.start, a.end);
      const inner = transformRegion(code, a.start, a.end);
      if (inner.repeat) repeat = inner.repeat;
      return inner.text;
    });
    const once = (flagValue(argTexts[3]) & FOR_ONCE) !== 0;
    let emitted: string | null = null;
    if (once) {
      const rep = repeatName(local);
      emitted = tryRepeat(rep, argTexts);
      if (emitted) repeat = rep;
      else emitted = tryInline(local, argTexts);
    }
    text += emitted ?? `${local}(${argTexts.join(',')})`;
    i = parsed.end;
  }
  return { text, repeat };
}

function ensureImport(code: string, local: string): string {
  const imported = local === 'repeatTemplate' ? 'repeatTemplate' : `repeatTemplate as ${local}`;
  const re = /import\s*\{([^}]*)\}\s*from\s*(['"])(vue|fjs\/vapor)\2/g;
  let replaced = false;
  return code.replace(re, (full, spec: string) => {
    if (replaced || !spec.includes('createFor') || spec.includes('repeatTemplate')) return full;
    replaced = true;
    const body = spec.trim().replace(/,\s*$/, '');
    return full.replace(spec, `${body}, ${imported}`);
  });
}

/** Rewrites ONCE v-for cells in compiler-vapor output. No-op when the
 * source has no such list. */
export function inlineVaporOnce(code: string): string {
  const { text, repeat } = transformRegion(code, 0, code.length);
  return repeat ? ensureImport(text, repeat) : text;
}
