// specs/076 — compute-pass allocation diet (custom-map sharing, resolveVars
// fast path) and retired-chain retention. Everything here pins a way the
// sharing/retention could silently corrupt styles: a shared custom map
// written through, a stale cache surviving a stylesheet change, an alive
// chain evicted by the trim.
import { describe, expect, it } from 'vitest';
import { StyleEngine } from '../src/css/style';

async function styleTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeEngine() {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, Record<string, unknown>>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style) => {
    applied.set(id, style);
  });
  const add = (id: number, tag: string, parent: number | null) => {
    parentOf.set(id, parent);
    childrenOf.set(id, []);
    if (parent != null) childrenOf.get(parent)!.push(id);
    engine.ensure(id, tag);
    return id;
  };
  return { engine, applied, add };
}

describe('custom map sharing', () => {
  it('resolves inherited tokens and per-element overrides without cross-talk', async () => {
    const { engine, applied, add } = makeEngine();
    const root = add(1, 'view', null);
    const brand1 = add(2, 'view', root);
    const brand2 = add(3, 'view', root);
    engine.register(
      null,
      ':root { --brand: #f00 }' +
        '.uses-brand { color: var(--brand) }' +
        '.overrides { --brand: #0f0; color: var(--brand) }',
    );
    engine.setClasses(2, 'uses-brand');
    engine.setClasses(3, 'uses-brand');
    await styleTick();
    expect(applied.get(2)?.color).toBe('#f00');
    expect(applied.get(3)?.color).toBe('#f00');

    // an element with its own token gets a merged table; the siblings that
    // share the parent's table must not see the override
    const over = add(4, 'view', root);
    engine.setClasses(4, 'overrides');
    await styleTick();
    expect(applied.get(4)?.color).toBe('#0f0');
    expect(applied.get(2)?.color).toBe('#f00');
    expect(applied.get(3)?.color).toBe('#f00');
    expect(applied.get(root)?.color).toBeUndefined();
  });

  it('inherits an inline --custom to descendants only, not sideways', async () => {
    const { engine, applied, add } = makeEngine();
    // custom properties are inherited properties: the inline --mine must
    // reach root's descendants but never the unrelated uncle
    const uncle = add(1, 'view', null);
    const root = add(2, 'view', null);
    const child = add(3, 'view', root);
    engine.register(null, '.x { background: var(--mine, #eee) } .y { background: var(--mine, #ddd) }');
    engine.setClasses(uncle, 'y');
    engine.setClasses(root, 'x');
    engine.setClasses(child, 'y');
    engine.setInlineCustomProps(2, { '--mine': '#123456' });
    await styleTick();
    expect(applied.get(root)?.background).toBe('#123456');
    expect(applied.get(child)?.background).toBe('#123456');
    expect(applied.get(uncle)?.background).toBe('#ddd');
  });
});

describe('resolveVars fast path', () => {
  it('applies styles without var() exactly as before the fast path', async () => {
    const { engine, applied, add } = makeEngine();
    add(1, 'view', null);
    engine.register(null, '.a { color: #123456; font-size: 14px; background: rgb(250, 250, 250) }');
    engine.setClasses(1, 'a');
    await styleTick();
    expect(applied.get(1)).toMatchObject({ color: '#123456', fontSize: 14, background: 'rgb(250, 250, 250)' });
  });

  it('still resolves var() chains through the shared token table', async () => {
    const { engine, applied, add } = makeEngine();
    add(1, 'view', null);
    engine.register(
      null,
      ':root { --a: 2px; --b: var(--a) }' +
        '.pad { padding: var(--b); margin: calc(var(--a) + 3px) }',
    );
    engine.setClasses(1, 'pad');
    await styleTick();
    // the substituted values go through the usual normalization; the mixed
    // calc stays for the peer's length parser to fold
    expect(applied.get(1)?.padding).toBe(2);
    expect(applied.get(1)?.margin).toBe('calc(2px + 3px)');
  });
});

describe('retired chain retention', () => {
  it('re-opens hit the retained cache instead of re-matching', async () => {
    const { engine, add } = makeEngine();
    engine.register(null, '.row { color: red } .cell { color: blue } .cell:active { color: green }');
    const a = add(1, 'view', null);
    engine.setClasses(a, 'row');
    const b = add(2, 'view', a);
    engine.setClasses(b, 'cell');
    await styleTick();
    const missAfterFirst = engine.stats.matchMiss;

    engine.forget(a);
    engine.forget(b);

    // same tags, same classes: fresh element ids, same chain signatures —
    // the retained entries must answer the match
    const a2 = add(3, 'view', null);
    engine.setClasses(a2, 'row');
    const b2 = add(4, 'view', a2);
    engine.setClasses(b2, 'cell');
    await styleTick();
    expect(engine.stats.matchMiss).toBe(missAfterFirst);
  });

  it('evicts the oldest retired chains past the cap, but skips re-referenced ones', async () => {
    const { engine, add } = makeEngine();
    // one chain kept alive across the whole churn below
    const keeper = add(1, 'view', null);
    engine.register(null, '.keep { color: red }');
    engine.setClasses(keeper, 'keep');
    await styleTick();
    const missAfterKeep = engine.stats.matchMiss;

    engine.forget(keeper); // retire the keep-chain — it sits at the queue front
    const again = add(2, 'view', null);
    engine.setClasses(again, 'keep');
    await styleTick(); // re-references the retired key — alive again, and
    // it STAYS alive through the flood below so the trim finds a live key

    // flood well past the cap with unique chains so the trim has to walk
    // past the keep-chain's queue slot
    engine.register(
      null,
      Array.from({ length: 600 }, (_, i) => `.c${i} { color: #00000${(i % 16).toString(16)} }`).join(''),
    );
    const flood = Array.from({ length: 600 }, (_, i) => add(100 + i, 'view', null));
    for (let i = 0; i < flood.length; i++) engine.setClasses(flood[i]!, `c${i}`);
    await styleTick();
    for (const id of flood) engine.forget(id);
    const missAfterFlood = engine.stats.matchMiss;

    // the trim ran past the keep-chain's slot; being re-referenced it must
    // have been skipped, so another element on that chain still cache-hits
    const third = add(700, 'view', null);
    engine.setClasses(third, 'keep');
    await styleTick();
    expect(engine.stats.matchMiss).toBe(missAfterFlood);

    // and the retained cache is bounded, not unbounded
    expect(engine.cacheStatsForTest().matchCache).toBeLessThanOrEqual(620);
  });

  it('drops retained caches when the stylesheet changes', async () => {
    const { engine, add } = makeEngine();
    engine.register(null, '.a { color: red }');
    const el = add(1, 'view', null);
    engine.setClasses(1, 'a');
    await styleTick();
    const missBefore = engine.stats.matchMiss;
    engine.forget(el); // retire with cache retained

    engine.register(null, '.a { color: blue }'); // epoch bump + full clear
    const el2 = add(2, 'view', null);
    engine.setClasses(2, 'a');
    await styleTick();
    // the retained (stale, red) cache must NOT answer: a fresh match runs
    expect(engine.stats.matchMiss).toBeGreaterThan(missBefore);
  });
});

describe('inherit merge (specs/084)', () => {
  it('a child with no declarations of its own still inherits color and fontSize', async () => {
    const { engine, applied, add } = makeEngine();
    const root = add(1, 'view', null);
    const child = add(2, 'view', root);
    const grand = add(3, 'text', child);
    engine.register(null, '.p { color: #123456; font-size: 20px }');
    engine.setClasses(root, 'p');
    await styleTick();
    expect(applied.get(root)).toMatchObject({ color: '#123456', fontSize: 20 });
    expect(applied.get(child)).toMatchObject({ color: '#123456', fontSize: 20 });
    expect(applied.get(grand)).toMatchObject({ color: '#123456', fontSize: 20 });
  });
});
