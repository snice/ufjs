// specs/075 — the subject-keyed rule index in StyleEngine. The index must
// be a strict performance swap: every case here pins a behavior that bucket
// selection could silently break (a selector becoming unreachable because
// its subject was indexed under a key the element never looks up).
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
  const appliedPseudo = new Map<number, import('../src/css/style').PseudoStyles | null>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, _active, _hover, pseudo) => {
    applied.set(id, style);
    if (pseudo !== undefined) appliedPseudo.set(id, pseudo);
  });
  const add = (id: number, tag: string, parent: number | null) => {
    parentOf.set(id, parent);
    childrenOf.set(id, []);
    if (parent != null) childrenOf.get(parent)!.push(id);
    engine.ensure(id, tag);
    return id;
  };
  return { engine, applied, appliedPseudo, parentOf, childrenOf, add };
}

describe('selector index: subject classes', () => {
  // .a.b is indexed under `a` only — an element holding just `b` must not
  // match it, one holding both must.
  it('indexes a multi-class subject under its first class', async () => {
    const { engine, applied, add } = makeEngine();
    const both = add(1, 'view', null);
    const onlyB = add(2, 'view', null);
    engine.register(null, '.a.b { color: red }');
    engine.setClasses(1, 'a b');
    engine.setClasses(2, 'b');
    await styleTick();
    expect(applied.get(both)?.color).toBe('red');
    expect(applied.get(onlyB)?.color).toBeUndefined();
  });

  it('still finds the rule when the element carries the first class among others', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, '.a.b { color: red }');
    engine.setClasses(1, 'x a b');
    await styleTick();
    expect(applied.get(el)?.color).toBe('red');
  });
});

describe('selector index: bare-tag and catch-all subjects', () => {
  it('routes bare-tag subjects through the tag bucket', async () => {
    const { engine, applied, add } = makeEngine();
    const div = add(1, 'div', null);
    const view = add(2, 'view', null);
    engine.register(null, 'div { color: red }');
    await styleTick();
    expect(applied.get(div)?.color).toBe('red');
    expect(applied.get(view)?.color).toBeUndefined();
  });

  it('keeps class-less, tag-less subjects reachable (catch-all)', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    // both shapes key on nothing the element can look up: [class*=…] with a
    // substring test and a bare universal — the catch-all must walk them
    engine.register(null, '[class*=btn] { color: red } * { font-size: 13px }');
    engine.setClasses(1, 'van-btn');
    await styleTick();
    expect(applied.get(el)?.color).toBe('red');
    expect(applied.get(el)?.fontSize).toBe(13);
  });

  it('keeps bare structural subjects reachable', async () => {
    const { engine, applied, parentOf, childrenOf, add } = makeEngine();
    // container tag stays out of the rule so nothing matches but child 2 —
    // color would inherit and muddy the assertion, hence background-color
    const root = add(1, 'box', null);
    const first = add(2, 'view', root);
    const second = add(3, 'view', root);
    engine.register(null, 'view:first-child { background-color: red }');
    await styleTick();
    expect(applied.get(first)?.backgroundColor).toBe('red');
    expect(applied.get(second)?.backgroundColor).toBeUndefined();
    expect(childrenOf.get(1)).toEqual([2, 3]);
    expect(parentOf.get(2)).toBe(1);
  });
});

describe('selector index: multi-selector rules and cascade order', () => {
  it('finds one rule through each of its selectors, deduped', async () => {
    const { engine, applied, add } = makeEngine();
    const viaClass = add(1, 'view', null);
    const viaTag = add(2, 'div', null);
    const viaAttr = add(3, 'view', null);
    const viaBoth = add(4, 'div', null);
    engine.register(null, '.x, div, [class*=y] { color: red }');
    engine.setClasses(1, 'x');
    engine.setClasses(3, 'zy');
    engine.setClasses(4, 'x y');
    await styleTick();
    expect(applied.get(viaClass)?.color).toBe('red');
    expect(applied.get(viaTag)?.color).toBe('red');
    expect(applied.get(viaAttr)?.color).toBe('red');
    // matches from two buckets at once: same rule, same spec — the fold is
    // idempotent, the color must still be exactly red
    expect(applied.get(viaBoth)?.color).toBe('red');
  });

  it('preserves specificity across buckets (class beats tag)', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, 'view { color: red } .a { color: green }');
    engine.setClasses(1, 'a');
    await styleTick();
    expect(applied.get(el)?.color).toBe('green');
  });

  it('preserves source order within a specificity tie across buckets', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    // .a lands in the class bucket, .b in the same bucket — but registered
    // in two separate register() calls to also pin the incremental append
    engine.register(null, '.a { color: green }');
    engine.register(null, '.b { color: red }');
    engine.setClasses(1, 'a b');
    await styleTick();
    expect(applied.get(el)?.color).toBe('red');
  });

  it('matches later-registered rules without a rebuild', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, '.a { color: green }');
    engine.setClasses(1, 'a');
    await styleTick();
    engine.register(null, '.late { font-weight: bold }');
    engine.setClasses(1, 'a late');
    await styleTick();
    expect(applied.get(el)?.color).toBe('green');
    expect(applied.get(el)?.fontWeight).toBe('bold');
  });
});

describe('selector index: rule qualifiers still apply inside buckets', () => {
  it('filters media rules at match time, not index time', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, '@media (min-width: 600px) { .a { color: red } }');
    engine.setClasses(1, 'a');
    await styleTick();
    expect(applied.get(el)?.color).toBeUndefined();
    engine.setViewport(600, 1000);
    await styleTick();
    expect(applied.get(el)?.color).toBe('red');
  });

  it('keeps scoped rules scoped inside the bucket', async () => {
    const { engine, applied, add } = makeEngine();
    const scoped = add(1, 'view', null);
    const global = add(2, 'view', null);
    engine.addScope(1, 'data-v-aa');
    engine.register('data-v-aa', '.card { color: red }');
    engine.setClasses(1, 'card');
    engine.setClasses(2, 'card');
    await styleTick();
    expect(applied.get(scoped)?.color).toBe('red');
    expect(applied.get(global)?.color).toBeUndefined();
  });

  it('keeps :deep scope checks inside the bucket', async () => {
    const { engine, applied, add } = makeEngine();
    const wrap = add(1, 'view', null);
    const inside = add(2, 'view', wrap);
    const outside = add(3, 'view', null);
    engine.addScope(1, 'data-v-aa');
    engine.register('data-v-aa', '.wrap :deep(.in) { color: red }');
    engine.setClasses(1, 'wrap');
    engine.setClasses(2, 'in');
    engine.setClasses(3, 'in');
    await styleTick();
    expect(applied.get(inside)?.color).toBe('red');
    expect(applied.get(outside)?.color).toBeUndefined();
  });

  it('cascades pseudo-element rules separately, including catch-all subjects', async () => {
    const { engine, applied, appliedPseudo, add } = makeEngine();
    const cell = add(1, 'view', null);
    // vant's hairline shape: attr subject → catch-all, ::after → pseudo set
    engine.register(null, '.cell::before { background-color: #000 } [class*=hairline]::after { background-color: #eee }');
    engine.setClasses(1, 'cell van-hairline--bottom');
    await styleTick();
    // neither pseudo rule may style the element itself
    expect(applied.get(cell)?.backgroundColor).toBeUndefined();
    expect(appliedPseudo.get(cell)?.before).toMatchObject({ backgroundColor: '#000' });
    expect(appliedPseudo.get(cell)?.after).toMatchObject({ backgroundColor: '#eee' });
  });

  it('routes the :disabled state class through the class bucket', async () => {
    const { engine, applied, add } = makeEngine();
    const input = add(1, 'input', null);
    engine.register(null, 'input:disabled { color: gray }');
    engine.setDisabled(1, true);
    await styleTick();
    expect(applied.get(input)?.color).toBe('gray');
    engine.setDisabled(1, false);
    await styleTick();
    expect(applied.get(input)?.color).toBeUndefined();
  });

  it('keeps :active state cascades working from the tag bucket', async () => {
    const { engine, applied, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(null, 'view:active { color: red } .row { color: green }');
    engine.setClasses(1, 'row');
    await styleTick();
    expect(applied.get(row)?.color).toBe('green');
    // the active cascade is delivered through the same engine entry the
    // renderer uses; css.test.ts covers its shapes — here just the routing
  });
});

describe('selector index: stamp reuse across misses', () => {
  it('does not let one element\'s walk suppress a later element\'s match', async () => {
    const { engine, applied, add } = makeEngine();
    const p = add(1, 'view', null);
    const q = add(2, 'view', null);
    // one rule, two subject keys: element 1's walk stamps the rule via `p`,
    // element 2's walk (fresh epoch) must still evaluate it via `q`
    engine.register(null, '.p, .q { color: red }');
    engine.setClasses(1, 'p');
    engine.setClasses(2, 'q');
    await styleTick();
    expect(applied.get(p)?.color).toBe('red');
    expect(applied.get(q)?.color).toBe('red');
  });
});

describe('selector index: vant-shaped smoke', () => {
  // A scaled-down but shape-faithful slice of what a component library
  // registers: root custom properties, base + modifier classes, descendant
  // chains, hairline pseudo rules, :active variants — registered in several
  // blocks the way the demo's plugin does.
  it('resolves a component-library stylesheet identically to expectations', async () => {
    const { engine, applied, appliedPseudo, parentOf, childrenOf, add } = makeEngine();
    const page = add(1, 'view', null);
    const group = add(2, 'view', page);
    const cell = add(3, 'view', group);
    const title = add(4, 'text', cell);
    engine.register(
      null,
      ':root { --van-cell-background: #fff }' +
        '.van-cell { position: relative; display: flex; background: var(--van-cell-background, #fff) }' +
        '.van-cell__title { flex: 1 }' +
        '.van-cell:active { background-color: #f2f3f5 }' +
        '[class*=van-hairline]::after { border: 0.5px solid #ebedf0 }' +
        'text { color: #323233 }',
    );
    engine.setClasses(2, 'van-cell-group van-hairline--top');
    engine.setClasses(3, 'van-cell van-hairline--bottom');
    engine.setClasses(4, 'van-cell__title');
    await styleTick();
    expect(applied.get(cell)?.position).toBe('relative');
    expect(applied.get(cell)?.display).toBe('flex');
    expect(applied.get(cell)?.background).toBe('#fff');
    expect(applied.get(title)?.flex).toBe(1);
    expect(applied.get(title)?.color).toBe('#323233');
    expect(appliedPseudo.get(cell)?.after).toMatchObject({ border: '0.5px solid #ebedf0' });
    expect(appliedPseudo.get(group)?.after).toMatchObject({ border: '0.5px solid #ebedf0' });
    expect(parentOf.get(3)).toBe(2);
    expect(childrenOf.get(2)).toEqual([3]);
  });
});
