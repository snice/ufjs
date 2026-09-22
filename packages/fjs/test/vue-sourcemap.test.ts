// spec 094: the SFC plugin's map has to survive esbuild's TS transpile and
// still point at the .vue file, not at the compiled render function.
import { describe, expect, it } from 'vitest';
import esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebaseVueSources, vueSfcPlugin } from '../src/bundler/vue-plugin';

const VLQ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const SFC = `<template>
  <view>{{ n }}</view>
</template>
<script setup lang="ts">
const n = 1;
function hit() {
  return n + 1;
}
</script>
`;

function vlqDecode(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (let i = 0; i < segment.length; i++) {
    const integer = VLQ.indexOf(segment[i]);
    if (integer < 0) continue;
    const cont = integer & 32;
    value += (integer & 31) * 2 ** shift;
    if (cont) {
      shift += 5;
      continue;
    }
    const neg = value & 1;
    value = Math.floor(value / 2);
    out.push(neg ? -value : value);
    value = 0;
    shift = 0;
  }
  return out;
}

/** 1-based original lines recorded against a 1-based generated line. */
function originalLines(mappings: string, genLine: number): number[] {
  const lines = mappings.split(';');
  let origLine = 0;
  const hits: number[] = [];
  // Walk every preceding line so the relative original-line state is current.
  for (let i = 0; i < genLine && i < lines.length; i++) {
    if (!lines[i]) continue;
    for (const part of lines[i].split(',')) {
      if (!part) continue;
      const v = vlqDecode(part);
      if (v.length >= 4) {
        origLine += v[2];
        if (i === genLine - 1) hits.push(origLine + 1);
      }
    }
  }
  return hits;
}

describe('vue sfc source map (spec 094)', () => {
  it('maps a script line and a template line back to the .vue file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-sfc-map-'));
    const file = path.join(dir, 'index.vue');
    fs.writeFileSync(file, SFC);
    const result = await esbuild.build({
      entryPoints: [file],
      bundle: false,
      write: false,
      outfile: path.join(dir, 'out.js'),
      format: 'esm',
      sourcemap: 'external',
      plugins: [vueSfcPlugin({ sourceMap: true })],
      logLevel: 'silent',
    });
    const jsFile = result.outputFiles!.find((f) => f.path.endsWith('.js'))!;
    const js = jsFile.text;
    const map = JSON.parse(result.outputFiles!.find((f) => f.path.endsWith('.map'))!.text) as {
      mappings: string;
      sources?: string[];
      sourcesContent?: Array<string | null>;
    };
    // build.ts does this after every dev emit; the plugin test has no bundle
    // step of its own, so apply the same rebase the stamp does.
    rebaseVueSources(map, path.dirname(jsFile.path));
    const content = (map.sourcesContent ?? []).join('\n');
    expect(content).toContain('return n + 1');
    expect(content).toContain('<view>{{ n }}</view>');

    const jsLines = js.split('\n');
    const scriptGen = jsLines.findIndex((l) => l.includes('return n + 1')) + 1;
    expect(scriptGen).toBeGreaterThan(0);
    // SFC line 7 is `return n + 1` — not line 1 of the compiled module.
    expect(originalLines(map.mappings, scriptGen)).toContain(7);

    const tplGen = jsLines.findIndex((l) => l.includes('"view"')) + 1;
    expect(tplGen).toBeGreaterThan(0);
    const tplOrig = originalLines(map.mappings, tplGen);
    expect(tplOrig).toContain(2);
    expect(tplOrig).not.toEqual([1]);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
