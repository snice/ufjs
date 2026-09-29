// specs/155: with `textRefs` on, a SetText becomes a TEXT op (0x4c: u32 id,
// u32 index) and the string rides the frame as `fjsText`; the host expands it
// (libfjs-style, native/style/test covers that half). Off, the bytes are the
// ones Dart has always decoded.
import { describe, expect, it } from 'vitest';
import { OpWriter, UiOp } from '../src/ui/ops';

const u32 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);

describe('OpWriter text refs', () => {
  it('writes a TEXT op per text and hands the strings over as they are', () => {
    const w = new OpWriter();
    w.textRefs = true;
    w.setText(7, 'a\u0001b').setText(9, '中文').setText(7, '');
    const frame = w.toUint8Array() as Uint8Array & { fjsText?: string[] };
    expect(frame.length).toBe(27);
    for (const [k, id] of [[0, 7], [1, 9], [2, 7]]) {
      expect(frame[k * 9]).toBe(UiOp.StyleText);
      expect(u32(frame, k * 9 + 1)).toBe(id);
      expect(u32(frame, k * 9 + 5)).toBe(k);
    }
    // not filtered here: the host drops what Flutter cannot draw
    expect(frame.fjsText).toEqual(['a\u0001b', '中文', '']);
    // the next frame starts its own list
    w.reset();
    w.setText(1, 'x');
    expect((w.toUint8Array() as Uint8Array & { fjsText?: string[] }).fjsText).toEqual(['x']);
  });

  it('a dropped frame drops its texts', () => {
    const w = new OpWriter();
    w.textRefs = true;
    w.setText(1, 'gone');
    w.reset();
    w.setText(2, 'kept');
    const frame = w.toUint8Array() as Uint8Array & { fjsText?: string[] };
    expect(u32(frame, 5)).toBe(0);
    expect(frame.fjsText).toEqual(['kept']);
  });

  it('off: the SetText bytes, control characters stripped', () => {
    const w = new OpWriter();
    w.setText(3, 'a\u0001b');
    const frame = w.toUint8Array() as Uint8Array & { fjsText?: string[] };
    expect(frame[0]).toBe(UiOp.SetText);
    expect(u32(frame, 5)).toBe(2);
    expect(String.fromCharCode(frame[9], frame[10])).toBe('ab');
    expect(frame.fjsText).toBeUndefined();
  });
});
