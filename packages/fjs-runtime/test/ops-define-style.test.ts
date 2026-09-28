// specs/144: DefineStyle writes the style JSON through OpWriter.str (ASCII
// straight into the frame) instead of utf8Encode + copy. A pure speedup: the
// frame must be the exact bytes the old path produced for every kind of
// style value, so the old path is rebuilt here from utf8Encode.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpWriter, UiOp } from '../src/ui/ops';
import { utf8Encode } from '../src/ui/utf8';

const host = globalThis as { __fjsHost?: { uiOpsVersion: number } };
let saved: typeof host.__fjsHost;
beforeAll(() => {
  saved = host.__fjsHost;
  host.__fjsHost = { uiOpsVersion: 6 }; // interned styles (ops 7-9)
});
afterAll(() => {
  host.__fjsHost = saved;
});

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/** DefineStyle + SetStyle exactly as ops.ts wrote them before specs/144. */
function legacy(elementId: number, styleId: number, style: Record<string, unknown>): number[] {
  const json = [...utf8Encode(JSON.stringify(style))];
  return [
    UiOp.DefineStyle, ...u32(styleId), ...u32(json.length), ...json,
    UiOp.SetStyle, ...u32(elementId), ...u32(styleId), ...u32(0),
  ];
}

const SAMPLES: [string, Record<string, unknown>][] = [
  ['ascii', { display: 'flex', flexDirection: 'row', fontSize: 16, lineHeight: '1.5', color: '#323233' }],
  ['2-byte', { content: '"café"' }],
  ['3-byte (CJK font name)', { fontFamily: '"PingFang SC", 微软雅黑', color: 'red' }],
  ['surrogate pair (emoji)', { content: '"👍"' }],
  ['lone surrogate', { content: 'a\ud800b' }],
  ['long (vant token table size)', Object.fromEntries(
    Array.from({ length: 400 }, (_, i) => [`k${i}`, `var(--van-token-${i}, #${(i * 7919).toString(16)})`]),
  )],
];

describe('DefineStyle encoding (specs/144)', () => {
  for (const [label, style] of SAMPLES) {
    it(`matches the utf8Encode bytes: ${label}`, () => {
      const w = new OpWriter();
      w.setStyle(7, style);
      expect([...w.toUint8Array()]).toEqual(legacy(7, 1, style));
    });
  }
});
