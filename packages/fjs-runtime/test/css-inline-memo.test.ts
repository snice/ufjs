// specs/144: elements with an inline style are memoized under the inline
// CONTENT (MatchResult.byInline).
// A memo hit must hand back exactly what a fresh compute would: every test
// compares a warm engine against a cold one, element by element.
import { describe, expect, it } from 'vitest';
import { StyleEngine } from '../src/css/style';

async function styleTick(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

const SHEETS: Array<[string | null, string]> = [
  [null, ':root { --brand: #1989fa; --gap: 12px }'],
  [
    null,
    '.slider { padding: var(--gap); font-size: 20px; color: var(--brand) }' +
      '.slider .bar { height: 2em; margin-left: calc(var(--gap) * 2) }' +
      '.slider .thumb::before { content: "o"; width: 1em }' +
      '.thumb:active { opacity: 0.5 } .thumb:hover { opacity: 0.8 }',
  ],
];

type Engine = {
  engine: StyleEngine;
  applied: Map<number, Record<string, unknown>>;
  /** :active / :hover / pseudo-element variants, as the renderer gets them. */
  variants: Map<number, unknown>;
  parentOf: Map<number, number | null>;
  childrenOf: Map<number, number[]>;
};

function newEngine(): Engine {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, Record<string, unknown>>();
  const variants = new Map<number, unknown>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, active, hover, pseudo) => {
    applied.set(id, style);
    variants.set(id, { active, hover, pseudo });
  });
  for (const [scope, css] of SHEETS) engine.register(scope, css);
  return { engine, applied, variants, parentOf, childrenOf };
}

/** Three sliders, like a vant form: the same classes, inline styles that
 * are equal (0 and 1) or differ (2), inline custom props, and children
 * whose em / calc / var resolve against the inline-styled parent. */
async function buildSliders(e: Engine, base = 100, widths = ['30%', '30%', '60%']): Promise<void> {
  const { engine, parentOf, childrenOf } = e;
  const make = (id: number, tag: string) => {
    parentOf.set(id, null);
    childrenOf.set(id, []);
    engine.ensure(id, tag);
    return id;
  };
  const insert = (child: number, parent: number) => {
    parentOf.set(child, parent);
    childrenOf.get(parent)!.push(child);
    engine.recomputeSubtree(child);
    engine.noteStructureChange(parent);
  };
  const page = make(base, 'view');
  for (let i = 0; i < widths.length; i++) {
    const slider = make(base + 10 + i * 10, 'view');
    engine.setClasses(slider, 'slider');
    // a `:style` binding: fresh object per element, equal content for 0/1
    engine.setInlineStyle(slider, { width: widths[i], '--gap': i === 2 ? '4px' : '8px', fontSize: '10px' });
    const bar = make(base + 11 + i * 10, 'view');
    engine.setClasses(bar, 'bar');
    insert(bar, slider);
    const thumb = make(base + 12 + i * 10, 'view');
    engine.setClasses(thumb, 'thumb');
    engine.setInlineStyle(thumb, { left: widths[i] });
    insert(thumb, slider);
    insert(slider, page);
  }
  await styleTick();
  engine.flushPending();
}

describe('inline style memo (specs/144)', () => {
  it('a memo hit equals a fresh compute, variables / em / calc / pseudo included', async () => {
    const warm = newEngine();
    await buildSliders(warm, 100);
    warm.engine.resetStats();
    // same content again: must be served from byInline
    await buildSliders(warm, 200);
    expect(warm.engine.stats.computeMiss).toBe(0);

    const cold = newEngine();
    await buildSliders(cold, 200);
    for (const [id, style] of cold.applied) {
      if (id < 200) continue;
      expect(warm.applied.get(id), `element ${id}`).toEqual(style);
      expect(warm.variants.get(id), `element ${id} variants`).toEqual(cold.variants.get(id));
    }
    // the thumb really has all three variants to compare
    expect(cold.variants.get(212)).toMatchObject({
      active: { opacity: 0.5 },
      hover: { opacity: 0.8 },
      pseudo: { before: { content: '"o"' } },
    });
    // the inline --gap reached the child's calc(), and em used the inline font-size
    expect(cold.applied.get(211)?.marginLeft).toBe('16px');
    expect(cold.applied.get(231)?.marginLeft).toBe('8px');
    expect(cold.applied.get(211)?.height).toBe(20); // 2em × the inline 10px
  });

  it('equal inline content across elements shares one computed style', async () => {
    const e = newEngine();
    await buildSliders(e);
    expect(e.applied.get(110)).toBe(e.applied.get(120)); // same content → same object
    expect(e.applied.get(110)).not.toBe(e.applied.get(130));
  });

  it('an inline change re-keys the element instead of hitting the old entry', async () => {
    const e = newEngine();
    await buildSliders(e);
    const before = e.applied.get(110);
    e.engine.mutateInline(110, 'width', '90%');
    await styleTick();
    e.engine.flushPending();
    expect(e.applied.get(110)?.width).toBe('90%');
    expect(e.applied.get(110)).not.toBe(before);
    e.engine.mutateInline(110, '--gap', '2px'); // inline custom joins the key too
    await styleTick();
    e.engine.flushPending();
    expect(e.applied.get(111)?.marginLeft).toBe('4px');
  });

  it('stays bounded under ever-changing inline content (animation frames)', async () => {
    const e = newEngine();
    await buildSliders(e);
    for (let f = 0; f < 400; f++) {
      e.engine.mutateInline(112, 'left', `${f}px`);
      await styleTick();
      e.engine.flushPending();
    }
    expect(e.applied.get(112)?.left).toBe('399px');
  });
});
