// specs/120 — registering a scoped sheet whose scope no element (and no
// cached chain) has carried keeps every cache. The point of the test is the
// "cannot change any answer" argument: an engine that took the fast path
// must style everything exactly like one that cleared everything, including
// the elements that arrive later carrying the new scope (and :deep below
// them); and every case the argument does not cover must still clear.
import { describe, expect, it } from 'vitest';
import { StyleEngine } from '../src/css/style';

async function styleTick(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

const BASE = '.card { padding: 8px } .card .t { color: #111 } .t { font-size: 14px }';

function harness() {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, Record<string, unknown>>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style) => {
    applied.set(id, style);
  });
  const make = (id: number, tag: string, cls = '', scope?: string) => {
    parentOf.set(id, null);
    childrenOf.set(id, []);
    engine.ensure(id, tag);
    if (cls) engine.setClasses(id, cls);
    if (scope) engine.addScope(id, scope);
    return id;
  };
  const insert = (child: number, parent: number) => {
    parentOf.set(child, parent);
    childrenOf.get(parent)!.push(child);
    engine.recomputeSubtree(child);
    engine.noteStructureChange(parent);
  };
  /** A page: root > card > title, the page's own scope on every element
   * that would carry it in a Vue SFC. */
  const page = (base: number, scope?: string) => {
    const root = make(base, 'view', 'page', scope);
    const card = make(base + 1, 'view', 'card', scope);
    const t = make(base + 2, 'text', 't', scope);
    const deep = make(base + 3, 'text', 'inner'); // a child component's node: no page scope
    insert(t, card);
    insert(deep, card);
    insert(card, root);
    return root;
  };
  return { engine, applied, page };
}

const PAGE_SHEET = '.card { border-radius: 4px } .t { color: #f00 } :deep(.inner) { font-weight: 700 }';

/** Home page mounted, then a new page's scoped sheet registers, then that
 * page mounts: once on an engine that may take the fast path, once on one
 * forced to clear (a throwaway seen scope makes the same sheet take the
 * slow path is not possible, so the reference registers everything up
 * front — the order a single bundle uses). */
async function run(fast: boolean) {
  const h = harness();
  h.engine.register(null, BASE);
  if (!fast) h.engine.register('data-v-new', PAGE_SHEET);
  h.page(1);
  await styleTick();
  const matchCache = h.engine.cacheStatsForTest().matchCache;
  h.engine.resetStats();
  if (fast) h.engine.register('data-v-new', PAGE_SHEET);
  const kept = matchCache > 0 && h.engine.cacheStatsForTest().matchCache === matchCache;
  await styleTick();
  const recomputedHome = h.engine.stats.recompute;
  h.page(10, 'data-v-new');
  await styleTick();
  return { ...h, kept, recomputedHome };
}

describe('register of a scoped sheet for an unseen scope (specs/120)', () => {
  it('keeps the caches, restyles nothing, and styles the new page like a full invalidation', async () => {
    const fast = await run(true);
    const ref = await run(false);
    expect(fast.kept).toBe(true);
    expect(fast.recomputedHome).toBe(0);
    expect([...fast.applied.keys()].sort()).toEqual([...ref.applied.keys()].sort());
    for (const [id, style] of ref.applied) expect(fast.applied.get(id), `element ${id}`).toEqual(style);
    // the scoped rules did land, :deep included
    expect(fast.applied.get(12)?.color).toBe('#f00');
    expect(fast.applied.get(13)?.fontWeight).toBe(700);
    expect(fast.applied.get(3)?.color).toBe('#111'); // home page untouched
  });

  const mustClear: Array<[string, (h: ReturnType<typeof harness>) => void, string, string | null]> = [
    ['the scope is already on an element', (h) => h.page(50, 'data-v-used'), '.t { color: red }', 'data-v-used'],
    ['the sheet has :root tokens', () => {}, ':root { --x: 1px } .t { color: red }', 'data-v-a'],
    ['the sheet has @keyframes', () => {}, '@keyframes k { from { opacity: 0 } to { opacity: 1 } } .t { color: red }', 'data-v-b'],
    ['the sheet brings the first structural rule', () => {}, '.t:first-child { color: red }', 'data-v-c'],
    ['the sheet brings the first @media rule', () => {}, '@media (max-width: 9999px) { .t { color: red } }', 'data-v-d'],
    ['the sheet is global', () => {}, '.t { color: red }', null],
  ];
  for (const [why, setup, css, scope] of mustClear) {
    it(`still clears everything when ${why}`, async () => {
      const h = harness();
      h.engine.register(null, BASE);
      h.page(1);
      setup(h);
      await styleTick();
      expect(h.engine.cacheStatsForTest().matchCache).toBeGreaterThan(0);
      h.engine.register(scope, css);
      expect(h.engine.cacheStatsForTest().matchCache).toBe(0);
    });
  }
});
