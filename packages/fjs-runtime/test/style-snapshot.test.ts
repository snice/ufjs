// specs/119 — build-time style snapshot. A snapshot is only a warm cache:
// what matters is that an engine fed one styles every element exactly as a
// cold engine would, and that it refuses a snapshot taken against different
// inputs instead of applying stale answers. Every test builds the same tree
// the renderer would (parents first, then children, recomputeSubtree on
// insert) in two engines — A exports, B imports — and compares B's output
// against a cold run, element by element.
import { afterEach, describe, expect, it } from 'vitest';
import { StyleEngine, type StyleSnapshot } from '../src/css/style';

async function styleTick(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

const SHEETS: Array<[string | null, string, string]> = [
  [null, ':root { --brand: #1989fa; --gap: 12px } @keyframes spin { from { opacity: 0 } to { opacity: 1 } }', 'root0000000a'],
  [
    null,
    '.card { padding: var(--gap); background-color: #fff; border-radius: 8px }' +
      '.card .title { color: var(--brand); font-size: 16px; font-weight: 600 }' +
      '.row:first-child { margin-top: 0 } .row + .row { margin-top: 4px }' +
      '.icon { font: normal normal normal 14px/1 var(--icon-font, "vant-icon") }' +
      '.icon::before { content: "x" } .deco { text-decoration: line-through }' +
      '.btn:active { opacity: 0.5 } @media (max-width: 320px) { .card { padding: 4px } }',
    'global00000b',
  ],
  ['data-v-page', '.page { flex-grow: 1 } .title { letter-spacing: 1px }', 'scoped00000c'],
];

type Built = { applied: Map<number, Record<string, unknown>>; engine: StyleEngine };

/** The same tree every time: a page with a card, rows, an icon, text nodes
 * (one synthesized, one explicit — rawText), an inline-styled box and a
 * tag with HTML defaults. */
async function buildTree(
  engine: StyleEngine,
  parentOf: Map<number, number | null>,
  childrenOf: Map<number, number[]>,
): Promise<void> {
  const make = (id: number, tag: string, opts: { defaults?: Record<string, unknown>; rawText?: boolean } = {}) => {
    parentOf.set(id, null);
    childrenOf.set(id, []);
    engine.ensure(id, tag, opts.defaults, opts.rawText);
    return id;
  };
  const insert = (child: number, parent: number) => {
    parentOf.set(child, parent);
    childrenOf.get(parent)!.push(child);
    engine.recomputeSubtree(child);
    engine.noteStructureChange(parent);
  };
  const DIV = { flexShrink: 1 }; // what resolveHtmlTag hands a <div>
  const page = make(1, 'view');
  engine.setClasses(page, 'page');
  engine.addScope(page, 'data-v-page');
  const card = make(2, 'div', { defaults: { ...DIV } });
  engine.setClasses(card, 'card');
  const title = make(3, 'text');
  engine.setClasses(title, 'title');
  engine.addScope(title, 'data-v-page');
  insert(title, card);
  for (let i = 0; i < 3; i++) {
    const row = make(10 + i, 'view');
    engine.setClasses(row, 'row');
    const label = make(20 + i, 'text', { rawText: true });
    insert(label, row);
    insert(row, card);
  }
  const deco = make(30, 'view');
  engine.setClasses(deco, 'deco');
  insert(make(31, 'text', { rawText: true }), deco); // takes the line-through
  insert(make(32, 'text'), deco); // explicit <text>: same chain, not rawText
  insert(deco, card);
  const icon = make(40, 'text');
  engine.setClasses(icon, 'icon');
  insert(icon, card);
  const inline = make(41, 'view');
  engine.patchInlineStyle(inline, undefined, { marginLeft: '3px' });
  insert(make(42, 'text', { rawText: true }), inline);
  insert(inline, card);
  const btn = make(43, 'button');
  engine.setClasses(btn, 'btn');
  insert(btn, card);
  insert(card, page);
  await styleTick();
  engine.flushPending();
}

function newEngine(capture: boolean, sheets = SHEETS, viewport?: [number, number]): Built & {
  parentOf: Map<number, number | null>;
  childrenOf: Map<number, number[]>;
} {
  const g = globalThis as { __fjsCaptureStyles?: unknown };
  if (capture) g.__fjsCaptureStyles = () => {};
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, Record<string, unknown>>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style) => {
    applied.set(id, style);
  });
  delete g.__fjsCaptureStyles;
  if (viewport) engine.setViewport(viewport[0], viewport[1]);
  for (const [scope, css, hash] of sheets) engine.register(scope, css, hash);
  return { engine, applied, parentOf, childrenOf };
}

async function capture(): Promise<{ snap: StyleSnapshot; cold: Map<number, Record<string, unknown>> }> {
  const a = newEngine(true);
  await buildTree(a.engine, a.parentOf, a.childrenOf);
  return { snap: a.engine.exportSnapshot(), cold: a.applied };
}

afterEach(() => {
  delete (globalThis as { __fjsCaptureStyles?: unknown }).__fjsCaptureStyles;
});

describe('style snapshot (specs/119)', () => {
  it('an engine fed the snapshot styles every element exactly as a cold one, without matching', async () => {
    const { snap, cold } = await capture();
    // travels as JSON, as it does in a chunk
    const json = JSON.stringify(snap);
    const b = newEngine(false);
    expect(b.engine.importSnapshot(json)).toBe(true);
    b.engine.resetStats();
    await buildTree(b.engine, b.parentOf, b.childrenOf);
    expect(b.engine.stats.matchMiss).toBe(0);
    // only the inline-styled box (not memoizable) and what hangs below it
    expect(b.engine.stats.computeMiss).toBeLessThanOrEqual(2);
    expect([...b.applied.keys()].sort()).toEqual([...cold.keys()].sort());
    for (const [id, style] of cold) expect(b.applied.get(id), `element ${id}`).toEqual(style);
  });

  it('keeps the rawText distinction (a synthesized text run takes the line-through)', async () => {
    const { snap, cold } = await capture();
    expect(cold.get(31)?.textDecoration).toBe('line-through');
    expect(cold.get(32)?.textDecoration).toBeUndefined();
    const b = newEngine(false);
    b.engine.importSnapshot(snap);
    await buildTree(b.engine, b.parentOf, b.childrenOf);
    expect(b.applied.get(31)?.textDecoration).toBe('line-through');
    expect(b.applied.get(32)?.textDecoration).toBeUndefined();
  });

  it('carries no NUL characters (PrimJS JSON.parse reads them as an empty string)', async () => {
    const { snap } = await capture();
    expect(JSON.stringify(snap)).not.toContain('\\u0000');
  });

  const refused: Array<[string, () => ReturnType<typeof newEngine>]> = [
    ['an extra global sheet is registered', () =>
      newEngine(false, [...SHEETS, [null, '.card { color: red }', 'extra000000d']])],
    ['a sheet the answers depend on is missing', () => newEngine(false, SHEETS.slice(0, 2))],
    ['the sheets were registered in another order', () => newEngine(false, [SHEETS[1], SHEETS[0], SHEETS[2]])],
    ['a global sheet has no build hash', () =>
      newEngine(false, [...SHEETS, [null, '.x { color: red }', '']])],
    ['an @media outcome differs', () => newEngine(false, SHEETS, [300, 600])],
  ];
  for (const [why, make] of refused) {
    it(`is refused when ${why}, and styles still come out right`, async () => {
      const { snap } = await capture();
      const b = make();
      expect(b.engine.snapshotMismatch(snap)).not.toBeNull();
      expect(b.engine.importSnapshot(snap)).toBe(false);
      // the reference: a cold engine with exactly b's inputs
      const ref = make();
      await buildTree(b.engine, b.parentOf, b.childrenOf);
      await buildTree(ref.engine, ref.parentOf, ref.childrenOf);
      expect(b.engine.stats.matchMiss).toBeGreaterThan(0);
      for (const [id, style] of ref.applied) expect(b.applied.get(id), `element ${id}`).toEqual(style);
    });
  }

  it('an extra SCOPED sheet (another page) does not invalidate it', async () => {
    const { snap } = await capture();
    const b = newEngine(false, [...SHEETS, ['data-v-other', '.row { color: red }', 'other000000e']]);
    expect(b.engine.snapshotMismatch(snap)).toBeNull();
  });

  it('refuses another snapshot version', async () => {
    const { snap } = await capture();
    const b = newEngine(false);
    expect(b.engine.importSnapshot({ ...snap, v: snap.v + 1 })).toBe(false);
  });

  it('a sheet registered after the import clears the imported answers like any cache', async () => {
    const { snap } = await capture();
    const b = newEngine(false);
    b.engine.importSnapshot(snap);
    b.engine.register(null, '.late { color: red }', 'late0000000f');
    b.engine.resetStats();
    await buildTree(b.engine, b.parentOf, b.childrenOf);
    expect(b.engine.stats.matchMiss).toBeGreaterThan(0);
    expect(b.engine.cacheStatsForTest().matchCache).toBeGreaterThan(0);
  });

  it('importing twice is harmless', async () => {
    const { snap, cold } = await capture();
    const b = newEngine(false);
    expect(b.engine.importSnapshot(snap)).toBe(true);
    expect(b.engine.importSnapshot(snap)).toBe(true);
    await buildTree(b.engine, b.parentOf, b.childrenOf);
    for (const [id, style] of cold) expect(b.applied.get(id), `element ${id}`).toEqual(style);
  });
});
