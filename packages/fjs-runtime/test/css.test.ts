// Unit tests for the CSS subset engine: selector/rule parsing and the
// style engine's cascade + inheritance.
import { describe, expect, it, vi } from 'vitest';
import { parseInlineCss, parseSelector, parseStylesheet, mediaMatches } from '../src/css/parser';
import { StyleEngine } from '../src/css/style';


/** StyleEngine coalesces updates into a microtask flush; tests await this
 * after mutating calls before asserting on applied styles. */
async function styleTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('parseStylesheet', () => {
  it('parses class rules with camelized keys and normalized values', () => {
    const rules = parseStylesheet(
      `.card { font-size: 16px; background: #fff; opacity: 0.5 }`,
      'data-v-1',
      0,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].scope).toBe('data-v-1');
    expect(rules[0].decls).toEqual({ fontSize: 16, background: '#fff', opacity: 0.5 });
    expect(rules[0].selectors[0]?.compounds).toEqual([{ tag: null, classes: ['card'] }]);
  });

  it('strips comments and skips unsupported at-rules', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rules = parseStylesheet(
      `/* header */ .a { color: red } @supports (display: grid) { .b { color: blue } }`,
      null,
      0,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].decls).toEqual({ color: 'red' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('parses combinators and :deep()/:global()', () => {
    const sel = parseSelector('.toolbar :deep(.child > .item)')!;
    expect(sel.deep).toBe(true);
    expect(sel.compounds).toEqual([
      { tag: null, classes: ['toolbar'] },
      { tag: null, classes: ['child'] },
      { tag: null, classes: ['item'] },
    ]);
    expect(sel.combinators).toEqual(['descendant', 'child']);

    const g = parseSelector(':global(.x)')!;
    expect(g.deep).toBe(false);
    // global flag lives on the rule level via scope=null, selectors only
    // carry deep
    expect(g.compounds).toEqual([{ tag: null, classes: ['x'] }]);

    const tag = parseSelector('div.content')!;
    expect(tag.specificity).toBe(11);
  });

  it('rejects unsupported selectors instead of mis-matching them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSelector('.a:focus')).toBeNull();
    expect(parseSelector('input[type=text]')).toBeNull();
    expect(parseSelector('#main')).toBeNull();
    warn.mockRestore();
  });
});

describe('parseInlineCss', () => {
  it('parses style attribute strings', () => {
    expect(parseInlineCss('color: red; font-size: 14px;')).toEqual({
      color: 'red',
      fontSize: 14,
    });
  });
  it('keeps custom property keys verbatim with raw values', () => {
    const rules = parseStylesheet(`.a { --brand-color: #f00; --gap-x: 8px; color: var(--brand-color) }`, null, 0);
    expect(rules[0].decls['--brand-color']).toBe('#f00');
    expect(rules[0].decls['--gap-x']).toBe('8px');
    expect(rules[0].decls.color).toBe('var(--brand-color)');
    expect(parseInlineCss('--pad: 4; color: red')).toEqual({ '--pad': '4', color: 'red' });
  });
});

/** Builds an engine over a small fake element tree and returns helpers. */
function makeEngine() {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, Record<string, unknown>>();
  const appliedActive = new Map<number, Record<string, unknown> | null>();
  const appliedHover = new Map<number, Record<string, unknown> | null>();
  const appliedPseudo = new Map<number, import('../src/css/style').PseudoStyles | null>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, activeStyle, hoverStyle, pseudo) => {
    applied.set(id, style);
    if (activeStyle !== undefined) appliedActive.set(id, activeStyle);
    if (hoverStyle !== undefined) appliedHover.set(id, hoverStyle);
    if (pseudo !== undefined) appliedPseudo.set(id, pseudo);
  });
  const add = (id: number, tag: string, parent: number | null) => {
    parentOf.set(id, parent);
    childrenOf.set(id, []);
    if (parent != null) childrenOf.get(parent)!.push(id);
    engine.ensure(id, tag);
    return id;
  };
  return { engine, applied, appliedActive, appliedHover, appliedPseudo, parentOf, childrenOf, add };
}

describe(':active', () => {
  it('parses on the subject compound and weighs as a class', () => {
    const sel = parseSelector('.list .row:active')!;
    expect(sel.active).toBe(true);
    expect(sel.compounds).toEqual([
      { tag: null, classes: ['list'] },
      { tag: null, classes: ['row'] },
    ]);
    expect(sel.specificity).toBe(30); // two classes + the pseudo-class
    expect(parseSelector('.row')!.active).toBe(false);
  });

  it('skips :active on anything but the last compound', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSelector('.row:active .title')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sends the pressed cascade beside the plain one', async () => {
    const { engine, applied, appliedActive, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(
      null,
      '.row { background-color: #fff; color: #333 } .row:active { background-color: #eee }',
    );
    engine.setClasses(1, 'row');
    await styleTick();
    expect(applied.get(row)).toMatchObject({
      backgroundColor: '#fff',
      color: '#333',
    });
    // the pressed variant is a whole style, not a diff: everything the plain
    // one has, with the :active declarations laid over it
    expect(appliedActive.get(row)).toMatchObject({
      backgroundColor: '#eee',
      color: '#333',
    });
  });

  it('keeps a more specific plain rule over a weaker :active one', async () => {
    const { engine, appliedActive, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(null, 'view:active { color: red } .row.big { color: green }');
    engine.setClasses(1, 'row big');
    await styleTick();
    expect(appliedActive.get(row)).toMatchObject({ color: 'green' });
  });

  it('sends nothing extra for elements with no :active rule', async () => {
    const { engine, appliedActive, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(null, '.row { color: red }');
    engine.setClasses(1, 'row');
    await styleTick();
    expect(appliedActive.get(row) ?? null).toBeNull();
  });

  it('clears the pressed style when the element stops matching', async () => {
    const { engine, appliedActive, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(null, '.row:active { color: red }');
    engine.setClasses(1, 'row');
    await styleTick();
    expect(appliedActive.get(row)).toMatchObject({ color: 'red' });
    engine.setClasses(1, 'other');
    await styleTick();
    expect(appliedActive.get(row)).toBeNull();
  });
});

describe('StyleEngine', () => {
  it('applies scoped rules only to elements carrying the scope', async () => {
    const { engine, applied, add } = makeEngine();
    const root = add(1, 'view', null);
    engine.addScope(1, 'data-v-aa');
    engine.register('data-v-aa', '.card { color: red; font-size: 20px }');
    engine.setClasses(1, 'card');
    await styleTick();
    expect(applied.get(root)).toMatchObject({ color: 'red', fontSize: 20 });

    engine.register('data-v-bb', '.card { color: blue }');
    await styleTick();
    expect(applied.get(root)?.color).toBe('red');
  });

  it('cascades by specificity then source order', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.setClasses(1, 'a b');
    engine.register(null, `.a { color: red; padding: 1 } .b { color: green }`);
    // .a and .b have equal specificity; .b comes later in source order
    await styleTick();
    expect(applied.get(el)?.color).toBe('green');
    await styleTick();
    expect(applied.get(el)?.padding).toBe(1);

    engine.register(null, `.b { color: blue }`);
    await styleTick();
    expect(applied.get(el)?.color).toBe('blue');
  });

  it('lets inline style and tag defaults participate in the right order', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    engine.ensure(1, 'div', { fontSize: 28, fontWeight: 'bold' });
    engine.register(null, `div { fontSize: 14 }`);
    await styleTick();
    expect(applied.get(el)?.fontSize).toBe(14); // rules beat tag defaults
    engine.setInlineStyle(1, 'fontSize: 18');
    await styleTick();
    expect(applied.get(el)?.fontSize).toBe(18); // inline beats rules
  });

  it('falls back to class transition after inline transition is removed', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, '.cell { transition: transform 180ms ease }');
    engine.setClasses(1, 'cell');
    await styleTick();
    expect(applied.get(el)?.transition).toBe('transform 180ms ease');

    engine.setInlineStyle(1, { transition: 'none', transform: 'translate(8px, 0)' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({
      transition: 'none',
      transform: 'translate(8px, 0)',
    });

    engine.setInlineStyle(1, { transform: 'translate(8px, 0)' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({
      transition: 'transform 180ms ease',
      transform: 'translate(8px, 0)',
    });
  });

  it('inherits text properties down the tree', async () => {
    const { engine, applied, add } = makeEngine();
    const parent = add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.setInlineStyle(1, 'color: red; fontSize: 15');
    await styleTick();
    expect(applied.get(child)).toMatchObject({ color: 'red', fontSize: 15 });
    // child's own declaration wins over inheritance
    engine.setInlineStyle(2, { color: 'blue' });
    await styleTick();
    expect(applied.get(child)?.color).toBe('blue');
    await styleTick();
    expect(applied.get(parent)?.color).toBe('red');
  });

  it('matches descendant and child combinators through the tree', async () => {
    const { engine, applied, add } = makeEngine();
    add(1, 'view', null);
    add(2, 'view', 1);
    const deep = add(3, 'text', 2);
    engine.setClasses(1, 'root');
    engine.setClasses(2, 'mid');
    engine.setClasses(3, 'leaf');
    engine.register(null, `.root .leaf { color: red } .mid > .leaf { fontSize: 99 }`);
    await styleTick();
    expect(applied.get(deep)).toMatchObject({ color: 'red', fontSize: 99 });

    engine.register(null, `.leaf > .mid { color: green }`);
    await styleTick();
    expect(applied.get(deep)?.color).toBe('red'); // reversed child: no match
  });

  it('handles :deep() rules hitting child-component elements', async () => {
    const { engine, applied, add } = makeEngine();
    // scoped parent element, plain child element (no scope of its own)
    const parent = add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.addScope(1, 'data-v-aa');
    engine.setClasses(1, 'wrapper');
    engine.setClasses(2, 'inner');
    engine.register('data-v-aa', `.wrapper :deep(.inner) { color: teal }`);
    await styleTick();
    expect(applied.get(child)?.color).toBe('teal');
    await styleTick();
    expect(applied.get(parent)?.color).toBeUndefined();
  });

  it('recomputes descendants when an ancestor class changes', async () => {
    const { engine, applied, add } = makeEngine();
    const parent = add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.register(null, `.on .leaf, .leaf { fontWeight: normal } .on .leaf { color: red }`);
    engine.setClasses(2, 'leaf');
    await styleTick();
    expect(applied.get(child)).toMatchObject({ fontWeight: 'normal' });
    engine.setClasses(1, 'on');
    await styleTick();
    expect(applied.get(child)).toMatchObject({ color: 'red' });
    engine.setClasses(1, '');
    await styleTick();
    expect(applied.get(child)?.color).toBeUndefined();
  });

  it('matches against the original HTML tag name', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    engine.register(null, `div { lineHeight: 1.5 } p { color: red }`);
    // lineHeight stays a string so Dart can tell multipliers ("1.5") from
    // absolute heights ("24px")
    await styleTick();
    expect(applied.get(el)).toMatchObject({ lineHeight: '1.5' });
    await styleTick();
    expect(applied.get(el)?.color).toBeUndefined();
  });

  it('resolves var() against cascaded custom properties', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.setClasses(1, 'card');
    engine.register(null, `.card { --brand: #ff0000; --pad: 8px; color: var(--brand); padding: var(--pad) }`);
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#ff0000', padding: 8 });
    // custom props themselves are not sent across the bridge
    await styleTick();
    expect(Object.keys(applied.get(el) ?? {})).toEqual(['color', 'padding']);
  });

  it('supports var() fallbacks and drops unresolved declarations', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.register(null, `.a { color: var(--missing, #00ff00); fontSize: var(--nothing) }`);
    engine.setClasses(1, 'a');
    await styleTick();
    expect(applied.get(el)).toEqual({ color: '#00ff00' });
  });

  it('inherits custom properties down the tree', async () => {
    const { engine, applied, add } = makeEngine();
    add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.setClasses(1, 'card');
    engine.setClasses(2, 'title');
    engine.register(
      null,
      `.card { --brand: #0000ff } .title { color: var(--brand) }`,
    );
    await styleTick();
    expect(applied.get(child)).toMatchObject({ color: '#0000ff' });
  });

  it(':root / :host custom properties seed every tree', async () => {
    const { engine, applied, add } = makeEngine();
    const top = add(1, 'view', null);
    const child = add(2, 'text', 1);
    engine.setClasses(1, 'btn');
    engine.setClasses(2, 'label');
    // vant's shape: tokens on `:root,:host`, chained, overridden lower down
    engine.register(
      null,
      `:root,:host { --blue: #1989fa; --primary: var(--blue); --size: 14px; color: red }
       .btn { background-color: var(--primary) }
       .label { --size: 16px; font-size: var(--size) }`,
    );
    await styleTick();
    expect(applied.get(top)).toMatchObject({ backgroundColor: '#1989fa' });
    // a non-custom :root declaration is not applied to the tree
    expect(applied.get(top)?.color).toBeUndefined();
    expect(applied.get(child)).toMatchObject({ fontSize: 16 });
  });

  it('a later :root block re-resolves styles already on screen', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.setClasses(1, 'a');
    engine.register(null, `.a { color: var(--c, #000000) }`);
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#000000' });
    engine.register(null, `:root { --c: #00ff00 }`);
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#00ff00' });
  });

  it('an undefined / null / empty :style entry leaves the CSS value alone', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'input', null);
    engine.setClasses(1, 'box');
    engine.register(null, `.box { width: 32px; height: 28px; color: red }`);
    // vant's stepper: `:style="{ width: addUnit(undefined), height: ... }"`
    engine.patchInlineStyle(1, undefined, { width: undefined, height: null, color: '' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ width: 32, height: 28, color: 'red' });
  });

  it('display:flex without an explicit direction pins the CSS initial (row)', async () => {
    const { engine, applied, add } = makeEngine();
    const cell = add(1, 'view', null);
    const mine = add(2, 'view', null);
    engine.setClasses(1, 'cell');
    engine.setClasses(2, 'mine');
    engine.register(
      null,
      // van-cell relies on the flex-direction initial value; the peer's
      // unstyled default is column, which is why the engine must pin it
      `.cell { display: flex }
       .mine { display: flex; flex-direction: column }`,
    );
    await styleTick();
    expect(applied.get(cell)).toMatchObject({ display: 'flex', flexDirection: 'row' });
    // an explicit direction is never overridden — inline display:flex alone
    // does not erase the matched flex-direction: column
    expect(applied.get(mine)).toMatchObject({ flexDirection: 'column' });
    // a container that only sets display inline gets the initial too
    engine.patchInlineStyle(cell, undefined, { display: 'inline-flex' });
    await styleTick();
    expect(applied.get(cell)).toMatchObject({ display: 'inline-flex', flexDirection: 'row' });
  });

  it('em lengths resolve against the element font-size', async () => {
    const { engine, applied, add } = makeEngine();
    const sw = add(1, 'view', null); // van-switch: em everywhere, font from --van-*
    const label = add(2, 'text', sw);
    engine.setClasses(1, 'switch');
    engine.setClasses(2, 'icon');
    engine.register(
      null,
      `:root { --size: 15px }
       .switch { width: 2em; height: 1em; font-size: var(--size);
                 border-radius: 1em; transform: translateX(1em) }
       .icon { font-size: 20px; width: 1em; height: 1em }`,
    );
    await styleTick();
    expect(applied.get(sw)).toMatchObject({
      width: 30,
      height: 15,
      fontSize: 15,
      borderRadius: 15,
      // a compound keeps its shape, the em token becomes px
      transform: 'translateX(15px)',
    });
    // the child resolves its own em against its own font-size, not the parent's
    expect(applied.get(label)).toMatchObject({ width: 20, height: 20, fontSize: 20 });
  });

  it('em font-size chains through inheritance like in a browser', async () => {
    const { engine, applied, add } = makeEngine();
    const parent = add(1, 'view', null);
    const child = add(2, 'view', 1);
    const grand = add(3, 'view', 2);
    engine.setClasses(1, 'a');
    engine.setClasses(2, 'b');
    engine.setClasses(3, 'c');
    engine.register(
      null,
      `.a { font-size: 20px }
       .b { font-size: 1.5em; width: 3em }
       .c { width: 1em }`,
    );
    await styleTick();
    expect(applied.get(child)).toMatchObject({ fontSize: 30, width: 90 });
    // the grandchild inherits the already-resolved 30px, not the raw em
    expect(applied.get(grand)).toMatchObject({ fontSize: 30, width: 30 });
  });

  it('a leading-dot decimal em (`.8em`) folds like 0.8em', async () => {
    const { engine, applied, add } = makeEngine();
    add(1, 'view', null);
    const icon = add(2, 'view', 1);
    engine.setClasses(1, 'icon');
    engine.setClasses(2, 'van-icon');
    engine.register(
      null,
      `.icon { font-size: 20px; height: 1em }
       .van-icon { width: 1.25em; height: 1.25em; font-size: .8em }`,
    );
    await styleTick();
    // vant writes icon glyph sizes as `.8em`; a missed fold left the raw
    // string on the element and sized the box off the parent font (25px in a
    // 20px row — the checkbox overflow stripes)
    expect(applied.get(icon)).toMatchObject({ fontSize: 16, width: 20, height: 20 });
  });

  it('synthesizes ::before / ::after styles with the element as inheritance base', async () => {
    const { engine, applied, appliedPseudo, add } = makeEngine();
    const cell = add(1, 'view', null);
    engine.setClasses(1, 'cell');
    engine.register(
      null,
      `:root { --line: #ebedf0 }
       .cell { position: relative; color: #323233; font-size: 14px }
       .cell::after { content: ''; position: absolute; left: 0; right: 0;
                      bottom: 0; height: 1px; background: var(--line) }`,
    );
    await styleTick();
    // the element itself is untouched by the pseudo rule
    expect(applied.get(cell)).toMatchObject({ position: 'relative' });
    expect(applied.get(cell)?.background).toBeUndefined();
    const note = appliedPseudo.get(cell);
    expect(note).toBeDefined();
    const after = note?.after;
    expect(after).toBeDefined();
    // var() resolved, inheritable properties carried in from the element,
    // non-inheritable ones (position/width) not invented
    expect(after).toMatchObject({ background: '#ebedf0', color: '#323233', fontSize: 14 });
    expect(after?.height).toBe(1);
    expect(after?.position).toBe('absolute');
  });

  it('notifies pseudo removal when a class stops matching', async () => {
    const { engine, appliedPseudo, add } = makeEngine();
    const el = add(1, 'view', null);
    engine.setClasses(1, 'checked');
    engine.register(null, `.checked::after { content: ''; width: 10px }`);
    await styleTick();
    expect(appliedPseudo.get(el)?.after).toMatchObject({ width: 10 });
    engine.setClasses(1, '');
    await styleTick();
    expect(appliedPseudo.get(el)).toBeNull();
  });

  it('maps inline-level displays to a wrapping row, keeping the value', async () => {
    const { engine, applied, add } = makeEngine();
    const stepper = add(1, 'view', null);
    engine.setClasses(1, 'stepper');
    engine.register(null, `.stepper { display: inline-block }`);
    await styleTick();
    // the value survives so the peer can apply the shrink-to-fit half
    expect(applied.get(stepper)).toMatchObject({
      display: 'inline-block',
      flexDirection: 'row',
      flexWrap: 'wrap',
    });
    // an explicit direction/wrap is never overridden
    const mine = add(2, 'view', null);
    engine.setClasses(2, 'mine');
    engine.register(null, `.mine { display: inline; flex-direction: column }`);
    await styleTick();
    expect(applied.get(mine)).toMatchObject({ flexDirection: 'column' });

    // inline-flex also wraps (rows of van-tags), on top of its flex-row default
    const tag = add(3, 'text', null);
    engine.setClasses(3, 'tag');
    engine.register(null, `.tag { display: inline-flex; align-items: center }`);
    await styleTick();
    expect(applied.get(tag)).toMatchObject({
      display: 'inline-flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
    });
  });

  it('propagates text-decoration to text runs, not to boxes', async () => {
    const { engine, applied, add, parentOf, childrenOf } = makeEngine();
    const box = add(1, 'div', null);
    engine.setClasses(1, 'origin');
    // the raw text node under the div (van-card's origin price)
    parentOf.set(2, 1);
    childrenOf.set(2, []);
    childrenOf.get(1)!.push(2);
    engine.ensure(2, 'text', undefined, true);
    const inner = add(3, 'div', 1);
    engine.register(null, `.origin { text-decoration: line-through }`);
    await styleTick();
    expect(applied.get(box)).toMatchObject({ textDecoration: 'line-through' });
    expect(applied.get(2)).toMatchObject({ textDecoration: 'line-through' });
    expect(applied.get(inner)?.textDecoration).toBeUndefined();
  });

  it('hands text-overflow to the text run it clips (van-ellipsis)', async () => {
    const { engine, applied, add, parentOf, childrenOf } = makeEngine();
    add(1, 'div', null);
    engine.setClasses(1, 'van-ellipsis');
    parentOf.set(2, 1);
    childrenOf.set(2, []);
    childrenOf.get(1)!.push(2);
    engine.ensure(2, 'text', undefined, true);
    const inner = add(3, 'span', 1);
    engine.register(
      null,
      `.van-ellipsis { overflow: hidden; white-space: nowrap; text-overflow: ellipsis }`,
    );
    await styleTick();
    expect(applied.get(2)).toMatchObject({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
    expect(applied.get(inner)?.textOverflow).toBeUndefined();
  });

  it('camelizes kebab keys of an object inline style (static template style)', async () => {
    const { engine, applied, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.patchInlineStyle(1, null, { 'align-items': 'stretch', 'margin-top': '4px' });
    await styleTick();
    expect(applied.get(row)).toMatchObject({ alignItems: 'stretch', marginTop: '4px' });
    expect(applied.get(row)?.['align-items']).toBeUndefined();
  });

  it('merges useCssVars batches without clobbering earlier props', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    engine.register(null, `div { color: var(--data-v-x-brand) }`);
    // compileScript's injected getter keys are full var names (without --)
    engine.setInlineCustomProps(1, { 'data-v-x-brand': '#ff0000' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#ff0000' });
    // second batch keeps the first variable (unlike :style replacement)
    engine.setInlineCustomProps(1, { 'data-v-x-pad': '4' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#ff0000' });
    await styleTick();
    expect(applied.get(el)?.['--brand']).toBeUndefined(); // never crosses bridge
    // removing: null value deletes the var, declaration becomes invalid
    engine.setInlineCustomProps(1, { 'data-v-x-brand': null });
    await styleTick();
    expect(applied.get(el)?.color).toBeUndefined();
  });

  it('lets inline custom props and chained vars resolve', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    engine.register(null, `div { gap: var(--g); color: var(--brand, #123456) }`);
    engine.setInlineStyle(1, { '--g': '10px' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ gap: 10, color: '#123456' });
    // chained: --brand2 references --brand defined inline; inline style is a
    // whole-block replacement (like the :style prop), so keep --g
    engine.setInlineStyle(1, { '--g': '10px', '--brand': '#abcdef', '--brand2': 'var(--brand)' });
    engine.register(null, `div { gap: var(--g); borderColor: var(--brand2) }`);
    await styleTick();
    expect(applied.get(el)).toMatchObject({ gap: 10, borderColor: '#abcdef' });
    // cycle: safe no-crash, declarations dropped
    engine.setInlineStyle(1, { '--a': 'var(--b)', '--b': 'var(--a)' });
    await styleTick();
    expect(applied.get(el)?.borderColor).toBeUndefined();
  });

  it('normalizes CSS escapes in var names (v-bind quoted member paths)', async () => {
    const { engine, applied, add } = makeEngine();
    const el = add(1, 'div', null);
    // the plugin rewrites v-bind('theme.color') keeping the CSS escape
    // (theme\.color), while compileScript's getter keys are raw — the
    // engine must land both on the same entry
    engine.register(null, `div { color: var(--data-v-x-theme\\.color) }`);
    engine.setInlineCustomProps(1, { 'data-v-x-theme.color': '#ff0000' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#ff0000' });
    // unescaped reference matches an escaped stored key too (same entry —
    // the second batch replaces the value)
    engine.register(null, `div { borderColor: var(--data-v-x-theme.color) }`);
    engine.setInlineCustomProps(1, { 'data-v-x-theme\\.color': '#00ff00' });
    await styleTick();
    expect(applied.get(el)).toMatchObject({ color: '#00ff00', borderColor: '#00ff00' });
  });
});

// BASE_CSS is one template literal, so a stray backtick inside a CSS comment
// silently ends the string and the whole web build stops resolving. It has
// happened three times; this is cheaper than a fourth.
describe('BASE_CSS is a well-formed template literal', () => {
  it('contains no backticks', async () => {
    const { BASE_CSS } = await import('../src/web/base-css');
    expect(BASE_CSS.includes('`')).toBe(false);
  });
});

// ---- :first-child / :last-child / :hover (spec 040) ----

describe('structural pseudos: parsing', () => {
  it('parses :first-child/:last-child on any compound and weighs as a class', () => {
    const sel = parseSelector('.item:last-child')!;
    expect(sel.compounds[0]?.last).toBe(true);
    expect(sel.specificity).toBe(20); // one class + one pseudo-class
    // structural on a NON-subject compound is fine (unlike :active/:hover)
    const chain = parseSelector('.item:first-child .txt')!;
    expect(chain.compounds[0]?.first).toBe(true);
    expect(chain.compounds[1]?.first).toBeUndefined();
    // pseudo before another class (CSS allows it anywhere in the compound)
    const mid = parseSelector('.a:first-child.b')!;
    expect(mid.compounds[0]?.classes).toEqual(['a', 'b']);
    expect(mid.compounds[0]?.first).toBe(true);
  });

  it('parses :hover on the subject and stacks with :active', () => {
    const sel = parseSelector('.btn:hover')!;
    expect(sel.hover).toBe(true);
    expect(sel.active).toBe(false);
    expect(sel.specificity).toBe(20);
    const both = parseSelector('.btn:active:hover')!;
    expect(both.active).toBe(true);
    expect(both.hover).toBe(true);
  });

  it('skips :hover on anything but the last compound', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSelector('.row:hover .title')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still rejects other pseudo-classes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSelector('.a:nth-child(2)')).toBeNull();
    expect(parseSelector('.a:not(.b)')).toBeNull();
    warn.mockRestore();
  });

  it('parses :not() around a structural pseudo (spec 073)', () => {
    // vant's skeleton rows: `.van-skeleton-paragraph:not(:first-child)`
    const sel = parseSelector('.van-skeleton-paragraph:not(:first-child)')!;
    expect(sel.compounds[0]?.classes).toEqual(['van-skeleton-paragraph']);
    expect(sel.compounds[0]?.notFirst).toBe(true);
    expect(sel.compounds[0]?.first).toBeUndefined();
    expect(sel.specificity).toBe(20); // class + pseudo-class
    const last = parseSelector('.item:not(:last-child)')!;
    expect(last.compounds[0]?.notLast).toBe(true);
    // negation may sit anywhere in the compound, like the positive form
    const mid = parseSelector('.a:not(:first-child).b')!;
    expect(mid.compounds[0]?.classes).toEqual(['a', 'b']);
    expect(mid.compounds[0]?.notFirst).toBe(true);
    // a structural pseudo next to its own negation is fine (and never matches)
    const both = parseSelector('.a:not(:first-child):first-child')!;
    expect(both.compounds[0]?.notFirst).toBe(true);
    expect(both.compounds[0]?.first).toBe(true);
  });
});

describe('structural pseudos: matching and invalidation', () => {
  it(':not(:first-child) styles every row but the first (spec 073)', async () => {
    const { engine, applied, add } = makeEngine();
    engine.register(null, '.row:not(:first-child) { margin-top: 12 }');
    add(1, 'view', null);
    for (const id of [2, 3, 4]) {
      add(id, 'view', 1);
      engine.setClasses(id, 'row');
    }
    await styleTick();
    expect(applied.get(2)).not.toHaveProperty('marginTop');
    expect(applied.get(3)).toMatchObject({ marginTop: 12 });
    expect(applied.get(4)).toMatchObject({ marginTop: 12 });
  });

  it(':not(:first-child) re-evaluates when the first row is removed', async () => {
    const { engine, applied, parentOf, childrenOf, add } = makeEngine();
    engine.register(null, '.row:not(:first-child) { margin-top: 12 }');
    add(1, 'view', null);
    for (const id of [2, 3, 4]) {
      add(id, 'view', 1);
      engine.setClasses(id, 'row');
    }
    await styleTick();
    expect(applied.get(2)).not.toHaveProperty('marginTop');

    // remove row 2: row 3 IS the first child now — it must lose the style
    // (the structural-change re-match), row 4 keeps it
    const kids = childrenOf.get(1)!;
    kids.splice(kids.indexOf(2), 1);
    engine.forget(2);
    engine.noteStructureChange(1);
    await styleTick();
    expect(applied.get(3)).not.toHaveProperty('marginTop');
    expect(applied.get(4)).toMatchObject({ marginTop: 12 });
  });

  it('styles only the first and last rows (cache correctness across positions)', async () => {
    const { engine, applied, add } = makeEngine();
    engine.register(
      null,
      '.item { border-bottom-width: 1 } .item:first-child { margin-top: 0 } .item:last-child { border-bottom-width: 0 }',
    );
    add(1, 'view', null);
    for (const id of [2, 3, 4]) {
      add(id, 'view', 1);
      engine.setClasses(id, 'item');
    }
    await styleTick();
    expect(applied.get(2)).toMatchObject({ marginTop: 0, borderBottomWidth: 1 });
    expect(applied.get(3)).toMatchObject({ borderBottomWidth: 1 });
    expect(applied.get(3)).not.toHaveProperty('marginTop');
    expect(applied.get(4)).toMatchObject({ borderBottomWidth: 0 });
  });

  it('re-styles siblings when the last row is removed or appended', async () => {
    const { engine, applied, parentOf, childrenOf, add } = makeEngine();
    engine.register(null, '.item { border-bottom-width: 1 } .item:last-child { border-bottom-width: 0 }');
    add(1, 'view', null);
    for (const id of [2, 3, 4]) {
      add(id, 'view', 1);
      engine.setClasses(id, 'item');
    }
    await styleTick();
    expect(applied.get(4)).toMatchObject({ borderBottomWidth: 0 });

    // remove 4: 3 becomes the last row
    const kids = childrenOf.get(1)!;
    kids.splice(kids.indexOf(4), 1);
    engine.forget(4);
    engine.noteStructureChange(1);
    await styleTick();
    expect(applied.get(3)).toMatchObject({ borderBottomWidth: 0 });
    expect(applied.get(2)).toMatchObject({ borderBottomWidth: 1 });

    // append 5: 3 loses the last-row style again
    engine.ensure(5, 'view');
    engine.setClasses(5, 'item');
    kids.push(5);
    parentOf.set(5, 1);
    engine.noteStructureChange(1);
    await styleTick();
    expect(applied.get(3)).toMatchObject({ borderBottomWidth: 1 });
    expect(applied.get(5)).toMatchObject({ borderBottomWidth: 0 });
  });

  it('re-keys descendants when an ancestor flips first/last', async () => {
    const { engine, applied, parentOf, childrenOf, add } = makeEngine();
    add(1, 'view', null);
    // .title under the FIRST .item is red; removing that item promotes the
    // next one — its .title only re-styles if the ancestor flip propagates
    engine.register(null, '.item:first-child .title { color: red }');
    const rows: Array<[number, number]> = [
      [2, 3],
      [4, 5],
    ];
    for (const [row, title] of rows) {
      add(row, 'view', 1);
      engine.setClasses(row, 'item');
      add(title, 'text', row);
      engine.setClasses(title, 'title');
    }
    engine.noteStructureChange(1);
    await styleTick();
    expect(applied.get(3)).toMatchObject({ color: 'red' });
    expect(applied.get(5)).not.toHaveProperty('color');

    childrenOf.get(1)!.splice(0, 1);
    engine.forget(2);
    engine.noteStructureChange(1);
    await styleTick();
    expect(applied.get(5)).toMatchObject({ color: 'red' });
  });

  it('excludes raw-text siblings but counts explicit text elements', async () => {
    const { engine, applied, parentOf, childrenOf } = makeEngine();
    // the root itself is parentless (= first+last) and would match a bare
    // view:first-child, its color then inherits everywhere — constrain to
    // children of a wrapper
    engine.ensure(0, 'view');
    engine.ensure(1, 'view');
    engine.setClasses(1, 'wrap');
    parentOf.set(1, 0);
    childrenOf.set(0, [1]);
    engine.register(null, '.wrap > view:first-child { color: red }');
    // raw text (createText) then a view: the view IS the first element child
    engine.ensure(2, 'text', undefined, true);
    engine.ensure(3, 'view');
    childrenOf.set(1, [2, 3]);
    parentOf.set(2, 1);
    parentOf.set(3, 1);
    engine.noteStructureChange(1);
    await styleTick();
    expect(applied.get(3)).toMatchObject({ color: 'red' });

    // explicit <text> is an element on both ends: the view is no longer first
    engine.ensure(4, 'text');
    childrenOf.get(1)!.unshift(4);
    parentOf.set(4, 1);
    engine.noteStructureChange(1);
    await styleTick();
    expect(applied.get(3)).not.toHaveProperty('color');
  });
});

// ---- next-sibling (+) combinator --------------------------------------------
// vant hangs its component spacing on it (`.van-button__loading +
// .van-button__text { margin-left: 4px }`), so matching and — because the
// match now depends on a neighbor — the cache invalidation have to hold.
describe('next-sibling (+) combinator', () => {
  it('parses into its own combinator and weighs like other combinators', () => {
    const sel = parseSelector('.loading+.text')!;
    expect(sel.combinators).toEqual(['nextSibling']);
    expect(sel.compounds).toEqual([
      { tag: null, classes: ['loading'] },
      { tag: null, classes: ['text'] },
    ]);
    // two classes, no pseudo classes: combinators themselves weigh nothing
    expect(sel.specificity).toBe(20);
    // compact, spaced and mixed spellings all parse
    expect(parseSelector('a + .b')!.combinators).toEqual(['nextSibling']);
    expect(parseSelector('.a+.b>.c')!.combinators).toEqual(['nextSibling', 'child']);
  });

  it('styles the follower but not the leader', async () => {
    const { engine, applied, add } = makeEngine();
    engine.register(null, '.loading+.text { margin-left: 4px }');
    add(1, 'view', null);
    add(2, 'view', 1);
    engine.setClasses(2, 'loading');
    add(3, 'view', 1);
    engine.setClasses(3, 'text');
    add(4, 'view', 1);
    engine.setClasses(4, 'text'); // no .loading before this one
    await styleTick();
    expect(applied.get(3)).toMatchObject({ marginLeft: 4 });
    expect(applied.get(2)).not.toHaveProperty('marginLeft');
    expect(applied.get(4)).not.toHaveProperty('marginLeft');
  });

  it('re-styles the follower when the leader toggles class', async () => {
    const { engine, applied, add } = makeEngine();
    engine.register(null, '.on+.badge { color: red }');
    add(1, 'view', null);
    add(2, 'view', 1);
    add(3, 'view', 1);
    engine.setClasses(3, 'badge');
    await styleTick();
    expect(applied.get(3)).not.toHaveProperty('color');
    // the loading spinner case: the leader gains its class after mount
    engine.setClasses(2, 'on');
    await styleTick();
    expect(applied.get(3)).toMatchObject({ color: 'red' });
    engine.setClasses(2, '');
    await styleTick();
    expect(applied.get(3)).not.toHaveProperty('color');
  });

  it('re-styles the follower when a leader is inserted before it', async () => {
    const { engine, applied, parentOf, childrenOf, add } = makeEngine();
    engine.register(null, '.loading+.text { margin-left: 4px }');
    add(1, 'view', null);
    add(2, 'view', 1);
    engine.setClasses(2, 'text');
    await styleTick();
    expect(applied.get(2)).not.toHaveProperty('marginLeft');
    // a loading spinner mounts in front
    add(3, 'view', 1);
    engine.setClasses(3, 'loading');
    childrenOf.set(1, [3, 2]);
    engine.noteStructureChange(1);
    await styleTick();
    expect(applied.get(2)).toMatchObject({ marginLeft: 4 });
  });

  it('skips raw-text siblings, like structural position does', async () => {
    const { engine, applied, parentOf, childrenOf, add } = makeEngine();
    engine.register(null, '.loading+.text { color: red }');
    add(1, 'view', null);
    add(2, 'view', 1);
    engine.setClasses(2, 'loading');
    // renderer-synthesized bare text between them is no element in the DOM
    engine.ensure(3, 'text', undefined, true);
    childrenOf.get(1)!.push(3);
    parentOf.set(3, 1);
    add(4, 'view', 1);
    engine.setClasses(4, 'text');
    await styleTick();
    expect(applied.get(4)).toMatchObject({ color: 'red' });
  });
});

describe(':hover', () => {
  it('sends the hover cascade beside the plain one', async () => {
    const { engine, applied, appliedHover, add } = makeEngine();
    const row = add(1, 'view', null);
    engine.register(
      null,
      '.btn { background-color: #ffffff; color: #333 } .btn:hover { background-color: #f2f2f2 }',
    );
    engine.setClasses(1, 'btn');
    await styleTick();
    expect(applied.get(row)).toMatchObject({ backgroundColor: '#ffffff' });
    expect(appliedHover.get(row)).toMatchObject({ backgroundColor: '#f2f2f2', color: '#333' });
  });

  it('sends nothing for elements with no hover rule, and clears on unmatch', async () => {
    const { engine, appliedHover, add } = makeEngine();
    add(1, 'view', null);
    engine.register(null, '.btn { color: red } .btn:hover { color: green }');
    engine.setClasses(1, 'btn');
    await styleTick();
    expect(appliedHover.get(1)).toMatchObject({ color: 'green' });
    // class change stops the hover match: the variant must clear (null)
    engine.setClasses(1, 'other');
    await styleTick();
    expect(appliedHover.get(1) ?? null).toBeNull();
  });

  it('keeps :active declarations out of the hover variant and vice versa', async () => {
    const { engine, appliedHover, appliedActive, add } = makeEngine();
    add(1, 'view', null);
    engine.register(
      null,
      '.btn { color: #000 } .btn:hover { background-color: #f2f2f2 } .btn:active { color: #00f }',
    );
    engine.setClasses(1, 'btn');
    await styleTick();
    // hovering is not pressing: the :active rule stays out
    expect(appliedHover.get(1)).toMatchObject({ backgroundColor: '#f2f2f2', color: '#000' });
    expect(appliedHover.get(1)).not.toHaveProperty('#00f');
    // touch press never hovers on web either: the hover rule stays out
    expect(appliedActive.get(1)).toMatchObject({ color: '#00f' });
    expect(appliedActive.get(1)).not.toHaveProperty('backgroundColor');
  });

  it('cascades hover rules by specificity and source order', async () => {
    const { engine, appliedHover, add } = makeEngine();
    add(1, 'view', null);
    engine.register(null, '.a:hover { color: red } .b:hover { color: green }');
    engine.setClasses(1, 'a b');
    await styleTick();
    expect(appliedHover.get(1)).toMatchObject({ color: 'green' });
  });
});

// spec 041: single-side border keys ride through the engine untouched — the
// Dart side parses them, so any transformation here would be lossy on the
// App and a no-op on web (real CSS).
describe('single-side border keys', () => {
  it('pass through stylesheet parsing verbatim', () => {
    const rules = parseStylesheet(
      '.a { border-bottom: 1px solid #eee; border-top-width: 2px }',
      null,
      0,
    );
    expect(rules[0].decls).toEqual({
      borderBottom: '1px solid #eee',
      borderTopWidth: 2,
    });
  });

  it('pass through inline parsing verbatim', () => {
    expect(parseInlineCss('border-left: 3px dotted #123456')).toEqual({
      borderLeft: '3px dotted #123456',
    });
    expect(parseInlineCss('border-bottom: none')).toEqual({
      borderBottom: 'none',
    });
  });

  it('ride along the :hover variant like any other key', async () => {
    const { engine, appliedHover, add } = makeEngine();
    add(1, 'view', null);
    engine.register(null, '.a { color: #000 } .a:hover { border-bottom: 1px solid #eee }');
    engine.setClasses(1, 'a');
    await styleTick();
    expect(appliedHover.get(1)).toMatchObject({ borderBottom: '1px solid #eee' });
  });
});

describe('@media parsing', () => {
  it('parses rules inside a media block and leaves plain rules alone', () => {
    const rules = parseStylesheet(
      `.a { color: red }
       @media (min-width: 600px) {
         .a { color: blue }
         .b { color: green }
       }`,
      null,
      0,
    );
    expect(rules).toHaveLength(3);
    expect(rules[0].media).toBeUndefined();
    expect(rules[1].media).toBeDefined();
    expect(rules[2].media).toBeDefined();
    // media rules keep their place in the same source-order sequence
    expect(rules.map((r) => r.order)).toEqual([0, 1, 2]);
    expect(rules[1].decls).toEqual({ color: 'blue' });
  });

  it('carries the scope into media rules', () => {
    const rules = parseStylesheet('@media (min-width: 600px) { .a { color: red } }', 'data-v-7', 0);
    expect(rules[0].scope).toBe('data-v-7');
    expect(rules[0].media).toBeDefined();
  });

  it('accepts px and unitless values, and/or, and the only prefix', () => {
    const rules = parseStylesheet(
      `@media only screen and (min-width: 600px) and (max-width: 1200), (orientation: landscape) { .a { color: red } }`,
      null,
      0,
    );
    expect(rules).toHaveLength(1);
    const media = rules[0].media!;
    expect(media).toHaveLength(2);
    expect(media[0]!.type).toBe('screen');
    expect(media[0]!.features).toEqual([
      { prop: 'width', op: 'min', value: 600 },
      { prop: 'width', op: 'max', value: 1200 },
    ]);
    expect(media[1]!.features).toEqual([{ prop: 'orientation', keyword: 'landscape' }]);
  });

  it('drops the whole block and warns on an unsupported feature', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rules = parseStylesheet(
      '@media (prefers-reduced-motion: reduce) { .a { color: red } }',
      null,
      0,
    );
    expect(rules).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('prefers-reduced-motion'));
    warn.mockRestore();
  });

  it('drops blocks with not, print, or a non-length value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const css of [
      '@media not (min-width: 600px) { .a { color: red } }',
      '@media print { .a { color: red } }',
      '@media (min-width: 50em) { .a { color: red } }',
      '@media { .a { color: red } }',
    ]) {
      expect(parseStylesheet(css, null, 0)).toHaveLength(0);
    }
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('warns on nested at-rules and keeps the sibling rules', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rules = parseStylesheet(
      '@media (min-width: 600px) { .a { color: red } @supports (x: y) { .b { color: blue } } }',
      null,
      0,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].selectors[0]!.compounds).toEqual([{ tag: null, classes: ['a'] }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nested inside @media'));
    warn.mockRestore();
  });
});

describe('mediaMatches', () => {
  const cond = (css: string) => parseStylesheet(`${css} { .a { color: red } }`, null, 0)[0]!.media!;

  it('judges min/max/exact widths and heights', () => {
    expect(mediaMatches(cond('@media (min-width: 600px)'), 600, 800)).toBe(true);
    expect(mediaMatches(cond('@media (min-width: 600px)'), 599.9, 800)).toBe(false);
    expect(mediaMatches(cond('@media (max-width: 600)'), 600, 800)).toBe(true);
    expect(mediaMatches(cond('@media (width: 390px)'), 390, 800)).toBe(true);
    expect(mediaMatches(cond('@media (width: 390px)'), 391, 800)).toBe(false);
    expect(mediaMatches(cond('@media (min-height: 844px)'), 390, 844)).toBe(true);
    expect(mediaMatches(cond('@media (min-height: 844px)'), 390, 800)).toBe(false);
  });

  it('judges orientation with the CSS rule (square is portrait)', () => {
    expect(mediaMatches(cond('@media (orientation: portrait)'), 390, 844)).toBe(true);
    expect(mediaMatches(cond('@media (orientation: portrait)'), 800, 600)).toBe(false);
    expect(mediaMatches(cond('@media (orientation: landscape)'), 600, 600)).toBe(false);
    expect(mediaMatches(cond('@media (orientation: landscape)'), 800, 600)).toBe(true);
  });

  it('ORs branches and ANDs features', () => {
    const both = cond('@media (min-width: 600px) and (orientation: landscape)');
    expect(mediaMatches(both, 800, 600)).toBe(true);
    expect(mediaMatches(both, 800, 900)).toBe(false);
    const either = cond('@media (min-width: 600px), (orientation: landscape)');
    expect(mediaMatches(either, 500, 400)).toBe(true);
    expect(mediaMatches(either, 500, 4000)).toBe(false);
  });

  it('matches screen/all and an omitted type alike', () => {
    expect(mediaMatches(cond('@media screen and (min-width: 100px)'), 200, 400)).toBe(true);
    expect(mediaMatches(cond('@media all and (min-width: 100px)'), 200, 400)).toBe(true);
    expect(mediaMatches(cond('@media (min-width: 100px)'), 200, 400)).toBe(true);
  });
});

describe('@media in the style engine', () => {
  it('recomputes when the viewport crosses the breakpoint', async () => {
    const { engine, applied, add } = makeEngine();
    const box = add(1, 'view', null);
    engine.register(null, '.box { color: red } @media (min-width: 600px) { .box { color: blue } }');
    engine.setClasses(1, 'box');
    await styleTick();
    expect(applied.get(box)).toMatchObject({ color: 'red' });
    engine.setViewport(700, 844);
    await styleTick();
    expect(applied.get(box)).toMatchObject({ color: 'blue' });
    engine.setViewport(300, 844);
    await styleTick();
    expect(applied.get(box)).toMatchObject({ color: 'red' });
  });

  it('covers min-height and orientation rules too', async () => {
    const { engine, applied, add } = makeEngine();
    const box = add(1, 'view', null);
    engine.register(
      null,
      '.box { color: red } @media (orientation: landscape) { .box { color: green } }',
    );
    engine.setClasses(1, 'box');
    await styleTick();
    expect(applied.get(box)).toMatchObject({ color: 'red' });
    engine.setViewport(844, 390);
    await styleTick();
    expect(applied.get(box)).toMatchObject({ color: 'green' });
  });

  it('costs nothing when no media rules exist', async () => {
    const { engine, applied, add } = makeEngine();
    const box = add(1, 'view', null);
    engine.register(null, '.box { color: red }');
    engine.setClasses(1, 'box');
    await styleTick();
    const before = applied.get(box);
    engine.setViewport(700, 900);
    await styleTick();
    // same object: no recompute pass ran, let alone a re-apply
    expect(applied.get(box)).toBe(before);
  });

  it('does not re-apply when the viewport value is unchanged', async () => {
    const { engine, applied, add } = makeEngine();
    const box = add(1, 'view', null);
    engine.register(null, '.box { color: red } @media (min-width: 600px) { .box { color: blue } }');
    engine.setClasses(1, 'box');
    engine.setViewport(700, 844);
    await styleTick();
    const afterFirst = applied.get(box);
    engine.setViewport(700, 844);
    await styleTick();
    expect(applied.get(box)).toBe(afterFirst);
  });

  it('assumes a 390x844 fallback viewport until the host reports one', async () => {
    const { engine, applied, add } = makeEngine();
    const box = add(1, 'view', null);
    engine.register(null, '.box { color: red } @media (min-width: 600px) { .box { color: blue } }');
    engine.setClasses(1, 'box');
    await styleTick();
    expect(applied.get(box)).toMatchObject({ color: 'red' });
    engine.setViewport(390, 844); // equal to the fallback: still no match
    await styleTick();
    expect(applied.get(box)).toMatchObject({ color: 'red' });
  });
});

// specs/069 验证期：vant 在 iOS 上逐屏对拍时暴露的引擎缺口
describe('[class<op>value] attribute selectors', () => {
  it('parses the class attribute tests and weighs them as a class', () => {
    const sel = parseSelector('[class*=van-hairline]::after')!;
    expect(sel.pseudo).toBe('after');
    expect(sel.compounds[0].classAttr).toEqual([{ op: '*=', value: 'van-hairline' }]);
    expect(sel.specificity).toBe(11); // attribute (10) + pseudo-element (1)
    const quoted = parseSelector('.a[class^="van-"]')!;
    expect(quoted.compounds[0]).toMatchObject({ classes: ['a'], classAttr: [{ op: '^=', value: 'van-' }] });
  });

  it('still skips other attributes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSelector('input[type=search]')).toBeNull();
    warn.mockRestore();
  });

  it('matches substrings, prefixes and words of the class list', async () => {
    const { engine, appliedPseudo, applied, add } = makeEngine();
    const cell = add(1, 'view', null);
    const tag = add(2, 'view', null);
    engine.register(
      null,
      `[class*=van-hairline]::after { content: ''; border: 0 solid #ebedf0 }
       [class~=plain] { color: red }
       [class|=van] { opacity: 0.5 }`,
    );
    engine.setClasses(cell, 'van-cell van-hairline--bottom');
    engine.setClasses(tag, 'van-tag plain');
    await styleTick();
    expect(appliedPseudo.get(cell)?.after).toMatchObject({ border: '0 solid #ebedf0' });
    expect(appliedPseudo.get(tag)).toBeFalsy();
    expect(applied.get(tag)).toMatchObject({ color: 'red' });
    // |= is "exactly van, or van- then anything"
    expect(applied.get(cell)).toMatchObject({ opacity: 0.5 });
  });
});

describe('the inherit keyword', () => {
  it('takes the parent value for any property, pseudo-elements included', async () => {
    const { engine, applied, appliedPseudo, add } = makeEngine();
    const divider = add(1, 'view', null);
    const child = add(2, 'view', divider);
    engine.register(
      null,
      `.d { border-color: #ebedf0; border-style: dashed }
       .d::before { content: ''; border-style: inherit; border-color: inherit }
       .c { border-style: inherit; width: inherit }`,
    );
    engine.setClasses(divider, 'd');
    engine.setClasses(child, 'c');
    await styleTick();
    expect(appliedPseudo.get(divider)?.before).toMatchObject({ borderStyle: 'dashed', borderColor: '#ebedf0' });
    expect(applied.get(child)).toMatchObject({ borderStyle: 'dashed' });
    // nothing to inherit: the declaration goes (initial value)
    expect(applied.get(child)).not.toHaveProperty('width');
  });
});

describe('absolute calc folding', () => {
  it('keeps the sign of a term that follows a nested calc (van-switch knob)', async () => {
    const { engine, applied, add } = makeEngine();
    const node = add(1, 'view', null);
    engine.register(
      null,
      `:root { --w: calc(1.8em + 4px); --n: 1em }
       .knob { font-size: 26px; transform: translate(calc(var(--w) - var(--n) - 4px)) }`,
    );
    engine.setClasses(node, 'knob');
    await styleTick();
    // 1.8 × 26 + 4 − 26 − 4 = 20.8
    expect(applied.get(node)).toMatchObject({ transform: 'translate(20.8px)' });
  });
});
