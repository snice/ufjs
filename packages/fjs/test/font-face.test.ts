// Build-time @font-face conversion (specs/071): the App runtime only ever
// loads TrueType/OpenType, so WOFF2 / WOFF / local font files are decoded and
// inlined as `data:font/ttf` here. The fixture is vant's own inlined icon
// font (MIT, see fixtures/README.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import * as esbuild from 'esbuild';
import { decompress } from 'wawoff2';
import { describe, expect, it, vi } from 'vitest';
import { decodeWoff1, inlineFontFaces } from '../src/bundler/font-face';
import { vueSfcPlugin } from '../src/bundler/vue-plugin';

const WOFF2 = fs.readFileSync(path.join(__dirname, 'fixtures/vant-icon.woff2'));

/** The data URLs in `css`, decoded. */
function dataUrls(css: string): { mime: string; bytes: Buffer }[] {
  return [...css.matchAll(/url\(data:([^;,]+)[^,]*,([A-Za-z0-9+/=]+)\)/g)].map((m) => ({
    mime: m[1],
    bytes: Buffer.from(m[2], 'base64'),
  }));
}

/** sfnt table tag -> table bytes. */
function tables(sfnt: Uint8Array): Map<string, Buffer> {
  const b = Buffer.from(sfnt);
  const out = new Map<string, Buffer>();
  const n = b.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const off = b.readUInt32BE(r + 8);
    out.set(b.toString('latin1', r, r + 4), b.subarray(off, off + b.readUInt32BE(r + 12)));
  }
  return out;
}

/** A WOFF 1.0 file for [sfnt] (every table zlib-compressed). */
function encodeWoff1(sfnt: Uint8Array): Buffer {
  const src = Buffer.from(sfnt);
  const n = src.readUInt16BE(4);
  const dir = Buffer.alloc(n * 20);
  const datas: Buffer[] = [];
  let offset = 44 + n * 20;
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const orig = src.subarray(src.readUInt32BE(r + 8), src.readUInt32BE(r + 8) + src.readUInt32BE(r + 12));
    const comp = zlib.deflateSync(orig);
    const stored = comp.length < orig.length ? comp : orig;
    dir.writeUInt32BE(src.readUInt32BE(r), i * 20);
    dir.writeUInt32BE(offset, i * 20 + 4);
    dir.writeUInt32BE(stored.length, i * 20 + 8);
    dir.writeUInt32BE(orig.length, i * 20 + 12);
    dir.writeUInt32BE(src.readUInt32BE(r + 4), i * 20 + 16);
    const pad = Buffer.alloc((4 - (stored.length % 4)) % 4);
    datas.push(stored, pad);
    offset += stored.length + pad.length;
  }
  const header = Buffer.alloc(44);
  header.write('wOFF', 0, 'latin1');
  header.writeUInt32BE(src.readUInt32BE(0), 4);
  header.writeUInt32BE(offset, 8);
  header.writeUInt16BE(n, 12);
  return Buffer.concat([header, dir, ...datas]);
}

const face = (src: string) =>
  `@font-face{font-family:"my-icons";src:${src}}.i:before{font-family:"my-icons";content:"\\e601"}`;

describe('inlineFontFaces', () => {
  it('turns an inlined WOFF2 into a TrueType data URL and keeps remote sources', async () => {
    const css = face(
      `url(data:font/woff2;charset=utf-8;base64,${WOFF2.toString('base64')}) format("woff2"),` +
        `url(//at.alicdn.com/x.woff?t=1) format("woff")`,
    );
    const out = await inlineFontFaces(css, os.tmpdir());
    const [ttf] = dataUrls(out);
    expect(ttf.mime).toBe('font/ttf');
    expect(ttf.bytes.subarray(0, 4).toString('hex')).toBe('00010000');
    expect(ttf.bytes).toEqual(Buffer.from(await decompress(WOFF2)));
    expect(out).toContain('format("truetype")');
    expect(out).toContain('url(//at.alicdn.com/x.woff?t=1) format("woff")');
    expect(out).toContain('.i:before{font-family:"my-icons";content:"\\e601"}');
  });

  it('decodes WOFF 1.0 table by table', async () => {
    const ttf = await decompress(WOFF2);
    const back = decodeWoff1(encodeWoff1(ttf));
    expect(tables(back)).toEqual(tables(ttf));
  });

  it('reads a relative font file next to the stylesheet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-font-'));
    fs.mkdirSync(path.join(dir, 'fonts'));
    fs.writeFileSync(path.join(dir, 'fonts/i.woff2'), WOFF2);
    const out = await inlineFontFaces(face(`url("./fonts/i.woff2?v=2") format("woff2")`), dir);
    expect(dataUrls(out)[0].mime).toBe('font/ttf');
  });

  it('warns and keeps the source when the file is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const css = face(`url(./nope.woff2) format("woff2")`);
    expect(await inlineFontFaces(css, os.tmpdir())).toBe(css);
    expect(warn.mock.calls[0][0]).toContain('"my-icons"');
    warn.mockRestore();
  });

  it('leaves stylesheets without @font-face untouched', async () => {
    const css = '.a{font:12px/1 serif}@media (min-width: 1px){.b{color:red}}';
    expect(await inlineFontFaces(css, os.tmpdir())).toBe(css);
  });
});

describe('bundler integration', () => {
  async function bundle(web: boolean) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-font-css-'));
    fs.writeFileSync(path.join(dir, 'icons.woff2'), WOFF2);
    fs.writeFileSync(path.join(dir, 'lib.css'), face('url(./icons.woff2) format("woff2")'));
    fs.writeFileSync(path.join(dir, 'entry.js'), "import './lib.css';");
    return esbuild.build({
      entryPoints: [path.join(dir, 'entry.js')],
      bundle: true,
      write: false,
      outdir: path.join(dir, 'out'),
      format: 'iife',
      external: ['fjs/vue'],
      plugins: [vueSfcPlugin({ web })],
      logLevel: 'silent',
      loader: { '.woff2': 'file' },
    });
  }

  it('flutter: an imported stylesheet carries the TrueType data URL', async () => {
    const js = (await bundle(false)).outputFiles.find((f) => f.path.endsWith('.js'))!.text;
    expect(js).toContain('data:font/ttf;base64,');
    expect(js).not.toContain('icons.woff2');
  });

  it('web: the browser gets the original WOFF2', async () => {
    const css = (await bundle(true)).outputFiles.find((f) => f.path.endsWith('.css'))!.text;
    expect(css).not.toContain('data:font/ttf');
  });
});
