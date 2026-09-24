// specs/118: OpWriter writes ASCII strings straight into its buffer and
// caches encoded tag names. Both are pure speedups — the frame must be the
// exact bytes the old encode-then-copy path produced, for every kind of
// string the peer can be sent. The old path is rebuilt here from utf8Encode
// so the comparison does not depend on the code under test.
import { describe, expect, it } from 'vitest';
import { OpWriter, UiOp } from '../src/ui/ops';
import { utf8Encode } from '../src/ui/utf8';
import { drawableText } from '../src/ui/drawable-text';

function frame(write: (w: OpWriter) => void): number[] {
  const w = new OpWriter();
  write(w);
  return [...w.toUint8Array()];
}

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];

/** What SetText / SetProps looked like before specs/118. */
function legacyString(op: number, id: number, s: string): number[] {
  const bytes = [...utf8Encode(s)];
  return [op, ...u32(id), ...u32(bytes.length), ...bytes];
}

const SAMPLES: [string, string][] = [
  ['empty', ''],
  ['ascii', 'hello, world {"a":1}'],
  ['2-byte', 'café ñ'],
  ['3-byte (CJK)', '表单输入 · 选项一'],
  ['surrogate pair (emoji)', 'ok 👍 done'],
  ['lone high surrogate', 'a\ud800b'],
  ['lone low surrogate', 'a\udc00b'],
  ['non-ascii only at the end', 'abcé'],
];

describe('OpWriter string encoding (specs/118)', () => {
  for (const [label, text] of SAMPLES) {
    it(`SetText bytes match utf8Encode: ${label}`, () => {
      expect(frame((w) => w.setText(7, text))).toEqual(
        legacyString(UiOp.SetText, 7, drawableText(text)),
      );
    });

    it(`SetProps bytes match utf8Encode(JSON): ${label}`, () => {
      const props = { value: text, n: 1 };
      expect(frame((w) => w.setProps(9, props))).toEqual(
        legacyString(UiOp.SetProps, 9, JSON.stringify(props)),
      );
    });
  }

  it('setPropsJson writes the same frame as setProps', () => {
    const props = { style: { display: 'none' }, htmlBlock: true };
    expect(frame((w) => w.setPropsJson(3, JSON.stringify(props)))).toEqual(
      frame((w) => w.setProps(3, props)),
    );
  });

  it('create writes the same bytes on a cached tag as on the first use', () => {
    const w = new OpWriter();
    w.create(1, 'view');
    w.create(2, 'view');
    w.create(3, '标签');
    w.create(4, '标签');
    const tag = (s: string) => {
      const b = [...utf8Encode(s)];
      return [...u16(b.length), ...b];
    };
    expect([...w.toUint8Array()]).toEqual([
      UiOp.Create, ...u32(1), ...tag('view'),
      UiOp.Create, ...u32(2), ...tag('view'),
      UiOp.Create, ...u32(3), ...tag('标签'),
      UiOp.Create, ...u32(4), ...tag('标签'),
    ]);
  });

  it('a long ASCII string grows the buffer correctly', () => {
    const text = 'x'.repeat(20000);
    expect(frame((w) => w.setText(1, text))).toEqual(legacyString(UiOp.SetText, 1, text));
  });
});
