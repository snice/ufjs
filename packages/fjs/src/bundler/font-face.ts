// Build-time font conversion for `@font-face` (specs/071).
//
// Flutter registers fonts from raw bytes (`dart:ui loadFontFromList`) and
// only promises TrueType/OpenType there; icon libraries ship WOFF2 (vant
// inlines `data:font/woff2;base64,…`) or WOFF files next to the CSS. So on
// the App path every usable `src` entry is rewritten here, once, into
// `url(data:font/ttf;base64,…) format("truetype")`:
//
//   data: woff2 / woff        -> decoded (wawoff2 / the WOFF1 reader below)
//   data: ttf / otf           -> kept
//   relative file             -> read next to the CSS, decoded, inlined
//   http(s):// and //host/…   -> kept verbatim; the runtime skips them and
//                                warns when nothing else is loadable
//
// Why decode at build time rather than on the device: the runtime then only
// ever sees TrueType, costs nothing per launch, and needs no Brotli / glyf
// reconstruction in Dart. Why inline rather than copy files into the host's
// assets: the bundler has no CSS `url()` asset pipeline at all, and an icon
// font is tens of KB — a data URL behaves the same under `fjs dev` and in a
// release build. Big fonts (CJK text faces) would bloat the bundle, hence
// the size warning; an asset path for those is future work (css-compat.md).
//
// The web build never comes here: browsers read WOFF2 natively.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Inlined fonts past this size print a warning (the JS bundle carries them). */
const LARGE_FONT_BYTES = 1024 * 1024;

const converted = new Map<string, Promise<Uint8Array | null>>();

/** Rewrites every `@font-face` `src` in [css] to TrueType data URLs where it
 * can. [fromDir] resolves relative `url()`s (the CSS file's directory). */
export async function inlineFontFaces(css: string, fromDir: string): Promise<string> {
  if (!css.includes('@font-face')) return css;
  const re = /@font-face\s*\{/g;
  let out = '';
  let last = 0;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const bodyStart = m.index + m[0].length;
    const bodyEnd = css.indexOf('}', bodyStart);
    if (bodyEnd < 0) break;
    const body = css.slice(bodyStart, bodyEnd);
    out += css.slice(last, bodyStart) + (await rewriteFontFaceBody(body, fromDir));
    last = bodyEnd;
    re.lastIndex = bodyEnd;
  }
  return out + css.slice(last);
}

async function rewriteFontFaceBody(body: string, fromDir: string): Promise<string> {
  const src = findDeclaration(body, 'src');
  if (!src) return body;
  const family = unquote(findDeclaration(body, 'font-family')?.value ?? '?');
  const items = splitTopLevel(src.value, ',');
  const rewritten: string[] = [];
  for (const item of items) {
    rewritten.push(await rewriteSrcItem(item.trim(), family, fromDir));
  }
  return body.slice(0, src.start) + rewritten.join(',') + body.slice(src.end);
}

async function rewriteSrcItem(item: string, family: string, fromDir: string): Promise<string> {
  const urlMatch = /^url\(\s*(['"]?)(.*?)\1\s*\)/s.exec(item);
  if (!urlMatch) return item; // local(...) and friends: the runtime warns
  const url = urlMatch[2];
  const format = /format\(\s*['"]?([^'")]+)/.exec(item)?.[1]?.toLowerCase();
  let bytes: Uint8Array | null = null;
  let label = url.length > 60 ? `${url.slice(0, 40)}…` : url;
  try {
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',');
      const meta = url.slice(5, comma).toLowerCase();
      if (!meta.includes('base64')) return item;
      bytes = Buffer.from(url.slice(comma + 1), 'base64');
      label = `data:${meta.split(';')[0]}`;
    } else if (/^(https?:)?\/\//i.test(url)) {
      return item; // remote: kept for the web, skipped by the App runtime
    } else {
      const file = path.resolve(fromDir, url.replace(/[?#].*$/, ''));
      if (!fs.existsSync(file)) {
        console.warn(`[fjs] @font-face "${family}": ${url} not found (looked at ${file})`);
        return item;
      }
      bytes = fs.readFileSync(file);
    }
  } catch (e) {
    console.warn(`[fjs] @font-face "${family}": could not read ${label}: ${String(e)}`);
    return item;
  }
  const kind = sniff(bytes, format);
  if (kind === 'unknown') {
    console.warn(`[fjs] @font-face "${family}": ${label} is not a WOFF2/WOFF/TTF/OTF font, left as is`);
    return item;
  }
  const sfnt = await toSfnt(bytes, kind);
  if (!sfnt) {
    console.warn(`[fjs] @font-face "${family}": decoding ${label} (${kind}) failed, left as is`);
    return item;
  }
  if (sfnt.length > LARGE_FONT_BYTES) {
    console.warn(
      `[fjs] @font-face "${family}": ${(sfnt.length / 1024 / 1024).toFixed(1)} MB font inlined into the App bundle`,
    );
  }
  const otf = sfnt[0] === 0x4f && sfnt[1] === 0x54 && sfnt[2] === 0x54 && sfnt[3] === 0x4f; // 'OTTO'
  const b64 = Buffer.from(sfnt).toString('base64');
  return `url(data:font/${otf ? 'otf' : 'ttf'};base64,${b64}) format("${otf ? 'opentype' : 'truetype'}")`;
}

type FontKind = 'woff2' | 'woff' | 'sfnt' | 'unknown';

function sniff(bytes: Uint8Array, format: string | undefined): FontKind {
  const tag = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === '\x00\x01\x00\x00' || tag === 'OTTO' || tag === 'true') return 'sfnt';
  // no magic: trust an explicit format hint only for the sfnt flavours
  if (format === 'truetype' || format === 'opentype') return 'sfnt';
  return 'unknown';
}

async function toSfnt(bytes: Uint8Array, kind: FontKind): Promise<Uint8Array | null> {
  if (kind === 'sfnt') return bytes;
  const key = createHash('sha1').update(bytes).digest('hex');
  let job = converted.get(key);
  if (!job) {
    job = (async () => {
      try {
        if (kind === 'woff') return decodeWoff1(bytes);
        // loaded on first use: its wasm runtime is only paid for by builds
        // that actually carry a WOFF2 font
        const { decompress } = await import('wawoff2');
        return await decompress(bytes);
      } catch {
        return null;
      }
    })();
    converted.set(key, job);
  }
  return job;
}

/** WOFF 1.0 -> sfnt: rebuild the offset table and table directory, inflate
 * each table that was stored compressed (compLength < origLength). */
export function decodeWoff1(woff: Uint8Array): Uint8Array {
  const src = Buffer.from(woff.buffer, woff.byteOffset, woff.byteLength);
  const flavor = src.readUInt32BE(4);
  const numTables = src.readUInt16BE(12);
  const tables: { tag: number; checksum: number; data: Buffer }[] = [];
  for (let i = 0; i < numTables; i++) {
    const e = 44 + i * 20;
    const tag = src.readUInt32BE(e);
    const offset = src.readUInt32BE(e + 4);
    const compLength = src.readUInt32BE(e + 8);
    const origLength = src.readUInt32BE(e + 12);
    const checksum = src.readUInt32BE(e + 16);
    const raw = src.subarray(offset, offset + compLength);
    const data = compLength < origLength ? zlib.inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error('WOFF table length mismatch');
    tables.push({ tag, checksum, data });
  }
  const pow = 2 ** Math.floor(Math.log2(numTables));
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(pow * 16, 6);
  header.writeUInt16BE(Math.log2(pow), 8);
  header.writeUInt16BE(numTables * 16 - pow * 16, 10);
  let offset = header.length;
  const chunks: Buffer[] = [header];
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    header.writeUInt32BE(t.tag, r);
    header.writeUInt32BE(t.checksum, r + 4);
    header.writeUInt32BE(offset, r + 8);
    header.writeUInt32BE(t.data.length, r + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    chunks.push(t.data, Buffer.alloc(pad));
    offset += t.data.length + pad;
  });
  return Buffer.concat(chunks);
}

// ---- tiny CSS helpers (the block has no nested braces) ----------------------

/** The value span of `name: value` inside a declaration block, honouring
 * parentheses and quotes (a data URL carries `;` inside its `url(...)`). */
function findDeclaration(
  body: string,
  name: string,
): { value: string; start: number; end: number } | null {
  const re = new RegExp(`(^|[;\\s])${name}\\s*:`, 'g');
  const m = re.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 0;
  let quote = '';
  let i = start;
  for (; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) break;
  }
  return { value: body.slice(start, i), start, end: i };
}

function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unquote(s: string): string {
  return s.trim().replace(/^(['"])(.*)\1$/, '$2');
}
