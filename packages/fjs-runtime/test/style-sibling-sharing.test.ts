// specs/147 — same-shape sharing in matchRules: an element matched earlier
// in the same flush pass, under the same parent chain and with the same
// tag / classes / scopes / position bits / `+` neighbour, lends its chain key
// and match instead of the element building its own.
//
// A wrong share hands an element someone else's style and throws nothing
// (constitution V). So every scenario runs twice — with sharing, and with
// sameShape disabled (the reference builds every key itself) — and the
// final pushed styles must match element for element.
import { describe, expect, it } from 'vitest';
import { StyleEngine } from '../src/css/style';

const SHEET = `
.row { flex-direction: row; font-size: 9px; --c: #123456; }
.cell { background-color: #85d8b4; margin: 1px; }
.cell:first-child { border-color: #ff0000; }
.cell:last-child { border-color: #0000ff; }
.cell:not(:first-child) { padding-left: 1px; }
.cell + .cell { margin-left: 2px; }
.cell + .odd { margin-left: 7px; }
.cell:active { opacity: 0.5; }
.cell:hover { opacity: 0.8; }
.cell::before { content: 'x'; color: #333333; }
.cell[data-k="hot"] { color: #ff00ff; }
.tiny { color: var(--c); line-height: 5px; }
.odd { background-color: #000000; }
.odd + .cell { border-width: 3px; }
text.cell { min-height: 4px; }
`;
const SCOPED = `.cell { padding: 3px; } .tiny { font-weight: 600; }`;

type Op =
  | ['make', number, string?]
  | ['insert', number, number, number?]
  | ['remove', number]
  | ['classes', number, string]
  | ['scope', number, string]
  | ['attr', number, string, string | null]
  | ['inline', number, Record<string, unknown> | undefined]
  | ['tick'];

function harness(share: boolean) {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, string>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, active, hover, pseudo) => {
    const prev = applied.get(id);
    const [, , ph, pp] = prev ? JSON.parse(prev) : [];
    applied.set(id, JSON.stringify([style, active, hover === undefined ? ph : hover, pseudo === undefined ? pp : pseudo]));
  });
  if (!share) {
    (engine as unknown as { sameShape: () => undefined }).sameShape = () => undefined;
  }
  engine.register(null, SHEET);
  engine.register('data-v-a', SCOPED);
  parentOf.set(0, null);
  childrenOf.set(0, []);
  engine.ensure(0, 'view');
  const inlines = new Map<number, Record<string, unknown> | undefined>();

  const detach = (id: number) => {
    const old = parentOf.get(id);
    if (old == null) return;
    const list = childrenOf.get(old)!;
    list.splice(list.indexOf(id), 1);
  };
  const apply = (op: Op) => {
    switch (op[0]) {
      case 'make':
        parentOf.set(op[1], null);
        childrenOf.set(op[1], []);
        engine.ensure(op[1], op[2] ?? 'view');
        break;
      case 'insert': {
        const [, child, parent, at] = op;
        const old = parentOf.get(child);
        detach(child);
        const list = childrenOf.get(parent)!;
        list.splice(at ?? list.length, 0, child);
        parentOf.set(child, parent);
        engine.recomputeSubtree(child);
        if (old != null && old !== parent) engine.noteStructureChange(old);
        engine.noteStructureChange(parent);
        break;
      }
      case 'remove': {
        const parent = parentOf.get(op[1]);
        detach(op[1]);
        const stack = [op[1]];
        while (stack.length) {
          const id = stack.pop()!;
          stack.push(...(childrenOf.get(id) ?? []));
          engine.forget(id);
          parentOf.delete(id);
          childrenOf.delete(id);
        }
        if (parent != null) engine.noteStructureChange(parent);
        break;
      }
      case 'classes':
        engine.setClasses(op[1], op[2]);
        break;
      case 'scope':
        engine.addScope(op[1], op[2]);
        break;
      case 'attr':
        engine.setAttribute(op[1], op[2], op[3]);
        break;
      case 'inline':
        engine.patchInlineStyle(op[1], inlines.get(op[1]), op[2]);
        inlines.set(op[1], op[2]);
        break;
    }
  };
  return { engine, applied, apply, childrenOf };
}

const tick = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

async function both(ops: Op[]) {
  const run = async (share: boolean) => {
    const h = harness(share);
    for (const op of ops) {
      if (op[0] === 'tick') await tick();
      else h.apply(op);
    }
    await tick();
    const live = new Set<number>();
    const stack = [0];
    while (stack.length) {
      const id = stack.pop()!;
      live.add(id);
      stack.push(...(h.childrenOf.get(id) ?? []));
    }
    return new Map([...h.applied].filter(([id]) => live.has(id)));
  };
  return { shared: await run(true), reference: await run(false) };
}

/** Cell `i` of row `row`: its id, and its text child's. */
const cellId = (row: number, i: number) => row * 100 + i * 2 + 1;

/** A row of `n` cells (each with a text) mounted in Vue's order. `tweak`
 * adds per-cell ops before the cell's insert (odd classes, attrs, inline). */
function vueRow(row: number, n: number, into: number, tweak?: (i: number, cell: number) => Op[]): Op[] {
  const ops: Op[] = [['make', row]];
  for (let i = 0; i < n; i++) {
    const cell = cellId(row, i);
    const text = cell + 1;
    ops.push(
      ['make', cell], ['make', text, 'text'],
      ['scope', text, 'data-v-a'], ['classes', text, 'tiny'], ['insert', text, cell],
      ['scope', cell, 'data-v-a'], ['classes', cell, 'cell'],
      ...(tweak?.(i, cell) ?? []),
      ['insert', cell, row],
    );
  }
  ops.push(['scope', row, 'data-v-a'], ['classes', row, 'row'], ['insert', row, into]);
  return ops;
}

describe('same-shape sharing (specs/147)', () => {
  it('uniform rows: first / middle / last cells and their texts', async () => {
    const { shared, reference } = await both([...vueRow(1, 8, 0), ...vueRow(2, 8, 0), ...vueRow(3, 1, 0)]);
    expect(shared.size).toBe(reference.size);
    expect(shared).toEqual(reference);
  });

  it('odd cells, attributes and inline styles mixed into a row', async () => {
    const { shared, reference } = await both(vueRow(1, 9, 0, (i, cell) => {
      // each odd one out sits right after a plain middle cell, so a share
      // that ignored the difference would have a candidate to take from
      if (i === 3) return [['classes', cell, 'cell odd']];
      if (i === 5) return [['attr', cell, 'data-k', 'hot']];
      if (i === 7) return [['inline', cell, { color: '#00ff00' }]];
      return [];
    }));
    expect(shared).toEqual(reference);
  });

  it('same classes, different tag or no scope', async () => {
    // index 3 is the odd one: its previous sibling (index 2) is a plain
    // middle cell, exactly like index 2's own previous sibling — so the only
    // thing keeping index 3 from taking index 2's match is the difference
    const row = (rowId: number, odd: 'tag' | 'scope'): Op[] => {
      const ops: Op[] = [['make', rowId]];
      for (let i = 0; i < 6; i++) {
        const id = rowId * 100 + i;
        ops.push(['make', id, odd === 'tag' && i === 3 ? 'text' : 'view']);
        if (!(odd === 'scope' && i === 3)) ops.push(['scope', id, 'data-v-a']);
        ops.push(['classes', id, 'cell'], ['insert', id, rowId]);
      }
      ops.push(['insert', rowId, 0]);
      return ops;
    };
    const { shared, reference } = await both([...row(1, 'tag'), ...row(2, 'scope')]);
    expect(shared).toEqual(reference);
  });

  it('mid insert, keyed move, class change, first and last removed', async () => {
    const { shared, reference } = await both([
      ...vueRow(1, 6, 0),
      ...vueRow(2, 6, 0),
      ['tick'],
      ['insert', cellId(1, 5), 1, 0],
      ['make', 170], ['scope', 170, 'data-v-a'], ['classes', 170, 'cell'], ['insert', 170, 1, 3],
      ['classes', cellId(2, 2), 'cell odd'],
      ['remove', cellId(2, 0)],
      ['remove', cellId(2, 5)],
      ['tick'],
      // and the same kinds of change batched with a fresh row
      ...vueRow(3, 4, 0),
      ['insert', cellId(2, 3), 3, 1],
    ]);
    expect(shared).toEqual(reference);
  });

  it('sharing actually happens on a uniform row', async () => {
    const h = harness(true);
    const eng = h.engine as unknown as { buildChainKey: (...a: unknown[]) => string };
    const build = eng.buildChainKey.bind(h.engine);
    let keys = 0;
    eng.buildChainKey = (...a) => {
      keys++;
      return build(...a);
    };
    for (const op of [...vueRow(1, 20, 0), ...vueRow(2, 20, 0)]) h.apply(op);
    await tick();
    // 82 elements; distinct shapes are a handful per row position class
    // (first / second / middle / last cell, their texts, the rows)
    expect(keys).toBeLessThan(20);
  });
});
