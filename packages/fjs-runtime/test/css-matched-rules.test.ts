// spec 092 — matchedRulesOf: the Styles panel's matched-rules feed. The
// cascade order, selector source texts and matched indices must line up
// with what the engine actually applies; state selectors never count as
// matched while their state is off.
import { describe, expect, it } from 'vitest';
import { StyleEngine } from '../src/css/style';

async function styleTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Same harness shape as css.test.ts: a fake tree + captured apply calls. */
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
  return { engine, applied, parentOf, childrenOf, add };
}

describe('matchedRulesOf (spec 092 DevTools matched rules)', () => {
  it('reports matching rules in cascade order with selector text and decls', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'text', null);
    // two rules hit the element; the later/more specific one wins the
    // cascade and must come LAST in the report
    engine.register(null, 'text { font-size: 13px } .title { color: red; font-weight: bold }');
    engine.setClasses(1, 'title');
    await styleTick();
    expect(applied.get(1)?.color).toBe('red');

    const rules = engine.matchedRulesOf(el);
    expect(rules.map((r) => r.selectors.join(','))).toEqual(['text', '.title']);
    expect(rules[0].matched).toEqual([0]);
    // decls are the ENGINE's normalized view (camelCase, px as numbers) —
    // display spelling is the relay's job
    expect(rules[0].decls).toEqual({ fontSize: 13 });
    expect(rules[1].decls).toEqual({ color: 'red', fontWeight: 'bold' });
  });

  it('leaves :active-only rules out while the state is off', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, '.btn { color: red } .btn:active { color: blue }');
    engine.setClasses(1, 'btn');
    await styleTick();
    const rules = engine.matchedRulesOf(el);
    expect(rules.map((r) => r.selectors.join(','))).toEqual(['.btn']);
    expect(applied.get(1)?.color).toBe('red');
  });

  it('reports multi-selector rules with the matched indices only', async () => {
    const { engine, add } = makeEngine();
    const el = add(1, 'text', null);
    engine.register(null, '.other, .title { color: red }');
    engine.setClasses(1, 'title');
    await styleTick();
    const rules = engine.matchedRulesOf(el);
    expect(rules).toHaveLength(1);
    expect(rules[0].selectors).toEqual(['.other', '.title']);
    expect(rules[0].matched).toEqual([1]);
  });

  it('returns an empty list for ids outside the tree', () => {
    const { engine } = makeEngine();
    expect(engine.matchedRulesOf(987654)).toEqual([]);
  });
});
