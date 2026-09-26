// NutUI 在 App 端的两处 CSS 缺口：`:active::before` 的按压变体、
// inline-block 盒子的 text-align（映射成换行 row 之后要落到主轴对齐）。
import { describe, expect, it, vi } from 'vitest';
import { StyleEngine, type PseudoStyles } from '../src/css/style';
import { parseSelector } from '../src/css/parser';

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function setup(css: string) {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, Record<string, unknown>>();
  const pseudo = new Map<number, PseudoStyles | null>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, _active, _hover, p) => {
    applied.set(id, style);
    if (p !== undefined) pseudo.set(id, p);
  });
  const add = (id: number, parent: number | null, cls?: string) => {
    parentOf.set(id, parent);
    childrenOf.set(id, []);
    if (parent != null) childrenOf.get(parent)!.push(id);
    engine.ensure(id, 'view');
    if (cls) engine.setClasses(id, cls);
    return id;
  };
  engine.register(null, css);
  return { engine, applied, pseudo, add };
}

describe(':active::before', () => {
  it('parses as an active selector styling the pseudo-element', () => {
    const sel = parseSelector('.nut-button:active::before')!;
    expect(sel.active).toBe(true);
    expect(sel.pseudo).toBe('before');
    expect(parseSelector('.a:active:after')!.pseudo).toBe('after');
  });

  it('skips :hover on a pseudo-element', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSelector('.a:hover::before')).toBeNull();
    expect(parseSelector('.a:hover:active::before')).toBeNull();
    warn.mockRestore();
  });

  it('computes the pressed box style next to the plain one', async () => {
    const { pseudo, add } = setup(`
      .btn::before { content: " "; opacity: 0; background-color: #000; }
      .btn:active::before { opacity: .1; }
    `);
    add(1, null);
    add(2, 1, 'btn');
    await tick();
    const p = pseudo.get(2)!;
    expect(p.before?.opacity).toBe(0);
    expect(Number(p.activeBefore?.opacity)).toBe(0.1);
    expect(p.activeBefore?.backgroundColor).toBe('#000');
    expect(p.activeAfter).toBeUndefined();
  });

  it('carries no pressed variant when no :active selector matched', async () => {
    const { pseudo, add } = setup(`
      .btn::before { content: " "; opacity: 0; }
      .other:active::before { opacity: .1; }
    `);
    add(1, null);
    add(2, 1, 'btn');
    await tick();
    expect(pseudo.get(2)!.before?.opacity).toBe(0);
    expect(pseudo.get(2)!.activeBefore).toBeUndefined();
  });
});

describe('inline-block text-align', () => {
  it('places the inline runs along the mapped row', async () => {
    const { applied, add } = setup(`
      .value { display: inline-block; text-align: right; flex: 1; }
      .mid { display: inline-block; text-align: center; }
      .own { display: inline-block; text-align: right; justify-content: flex-start; }
    `);
    add(1, null);
    add(2, 1, 'value');
    add(3, 1, 'mid');
    add(4, 1, 'own');
    await tick();
    expect(applied.get(2)!.justifyContent).toBe('flex-end');
    expect(applied.get(3)!.justifyContent).toBe('center');
    expect(applied.get(4)!.justifyContent).toBe('flex-start');
  });
});
