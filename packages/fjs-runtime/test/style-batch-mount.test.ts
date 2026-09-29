// specs/149 — batch mount: the fast paths a freshly mounted subtree takes
// through the style engine (registration without redundant marking, the
// per-parent sibling cursor for position / `+` neighbour, and whole-result
// reuse from a same-shape exemplar).
//
// Each one skips work on the premise that its answer is already known; a
// wrong premise styles an element with someone else's result and throws
// nothing (constitution V). So every scenario runs twice — batch paths on,
// and the reference with them AND 147's sharing off (every element computes
// its own) — and both the final styles and the ORDER of the style pushes
// (which is what the op frame is made of) must be identical.
import { beforeEach, describe, expect, it } from 'vitest';
import { StyleEngine } from '../src/css/style';

const SHEET = `
:root { --c: #123456; }
.row { flex-direction: row; font-size: 9px; --c: #654321; color: #222222; }
.cell { background-color: #85d8b4; margin: 1px; }
.cell:first-child { border-color: #ff0000; }
.cell:last-child { border-color: #0000ff; }
.cell:not(:first-child) { padding-left: 1px; }
.cell + .cell { margin-left: 2px; }
.cell + .odd { margin-left: 7px; }
.cell:first-child + .cell { padding-top: 6px; }
.odd + .cell { border-width: 3px; }
.cell:active { opacity: 0.5; }
.cell:hover { opacity: 0.8; }
.cell::before { content: 'x'; color: #333333; }
.cell[data-k="hot"] { color: #ff00ff; }
.tiny { color: var(--c); line-height: 5px; }
.tiny:first-child { font-weight: 700; }
.odd { background-color: #000000; }
.fixed { position: fixed; top: 0; }
text.cell { min-height: 4px; }
`;
const SCOPED = `.cell { padding: 3px; } .tiny { font-style: italic; }`;
/** Without `+` rules the neighbour is not part of a key, so a wrong
 * position bit has no signature to hide behind. */
const NO_SIBLING_RULES = SHEET.split('\n').filter((line) => !line.includes('+')).join('\n');
let sheet = SHEET;

type Op =
  | ['make', number, string?, boolean?] // id, tag, rawText
  | ['anchor', number] // an untracked node (v-if comment anchor)
  | ['insert', number, number, number?]
  | ['remove', number]
  | ['classes', number, string]
  | ['scope', number, string]
  | ['attr', number, string, string | null]
  | ['inline', number, Record<string, unknown> | undefined]
  | ['tick'];

function harness(batch: boolean) {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, string>();
  const order: number[] = [];
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, active, hover, pseudo) => {
    order.push(id);
    // what the renderer does to a fixed element in the middle of the flush:
    // hoist it out of its parent's list into the host (id 0), shifting
    // every later sibling down one slot while the pass is walking them
    if (style.position === 'fixed' && parentOf.get(id) !== 0) {
      const from = parentOf.get(id)!;
      const list = childrenOf.get(from)!;
      list.splice(list.indexOf(id), 1);
      childrenOf.get(0)!.push(id);
      parentOf.set(id, 0);
      engine.noteStructureChange(from);
    }
    const prev = applied.get(id);
    const [, , ph, pp] = prev ? JSON.parse(prev) : [];
    applied.set(id, JSON.stringify([style, active, hover === undefined ? ph : hover, pseudo === undefined ? pp : pseudo]));
  });
  if (!batch) {
    const e = engine as unknown as { batch: boolean; sameShape: () => undefined };
    e.batch = false;
    e.sameShape = () => undefined;
  }
  engine.register(null, sheet);
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
        engine.ensure(op[1], op[2] ?? 'view', undefined, op[3]);
        break;
      case 'anchor':
        parentOf.set(op[1], null);
        break;
      case 'insert': {
        const [, child, parent, at] = op;
        const old = parentOf.get(child);
        detach(child);
        let list = childrenOf.get(parent);
        if (list === undefined) childrenOf.set(parent, (list = []));
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
  return { engine, applied, order, apply, childrenOf };
}

const tick = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

async function both(ops: Op[]) {
  const run = async (batch: boolean) => {
    const h = harness(batch);
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
    // The keys each element was matched under, too: a wrong position or
    // neighbour only shows in the pushed style when it collides with another
    // element's key (rule matching itself reads the live tree), so the
    // inputs are compared directly
    const states = (h.engine as unknown as { states: Map<number, { structBits?: number; prevSig?: string; chainKey?: string }> }).states;
    const keys = new Map([...live].filter((id) => states.has(id)).map((id) => {
      const st = states.get(id)!;
      return [id, [st.structBits, st.prevSig, st.chainKey]] as const;
    }));
    // and the same amount of work: a wrong neighbour re-keys the element,
    // which re-queues it, and the next pass (with a fresh walk) repairs it —
    // right answer, extra pass
    const recomputes = h.engine.stats.recompute;
    return { styles: new Map([...h.applied].filter(([id]) => live.has(id))), order: h.order, keys, recomputes };
  };
  const batch = await run(true);
  const reference = await run(false);
  expect(batch.styles.size).toBe(reference.styles.size);
  expect(batch.styles).toEqual(reference.styles);
  expect(batch.order).toEqual(reference.order);
  expect(batch.keys).toEqual(reference.keys);
  expect(batch.recomputes).toBe(reference.recomputes);
}

const cellId = (row: number, i: number) => row * 100 + i * 3 + 1;

/** A row of `n` cells (each with a text) mounted in Vue's VDOM order:
 * children built and inserted before their parent lands. */
function vdomRow(row: number, n: number, into: number, tweak?: (i: number, cell: number) => Op[]): Op[] {
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

/** The same row in Vapor's order: a parent lands before its children, and
 * the class comes with the clone, before the insert. */
function vaporRow(row: number, n: number, into: number): Op[] {
  const ops: Op[] = [['make', row], ['scope', row, 'data-v-a'], ['classes', row, 'row'], ['insert', row, into]];
  for (let i = 0; i < n; i++) {
    const cell = cellId(row, i);
    const text = cell + 1;
    ops.push(
      ['make', cell], ['scope', cell, 'data-v-a'], ['classes', cell, 'cell'], ['insert', cell, row],
      ['make', text, 'text'], ['scope', text, 'data-v-a'], ['classes', text, 'tiny'], ['insert', text, cell],
    );
  }
  return ops;
}

for (const [label, rules] of [['with + rules', SHEET], ['position rules only', NO_SIBLING_RULES]] as const) describe(`batch mount (specs/149), ${label}`, () => {
  beforeEach(() => {
    sheet = rules;
  });

  it('uniform rows in VDOM and Vapor order', async () => {
    await both([...vdomRow(1, 8, 0), ...vdomRow(2, 1, 0), ...vaporRow(3, 8, 0), ...vaporRow(4, 2, 0)]);
  });

  it('odd classes, attributes, inline styles and a fixed cell mixed into a row', async () => {
    await both(vdomRow(1, 10, 0, (i, cell) => {
      if (i === 3) return [['classes', cell, 'cell odd']];
      if (i === 5) return [['attr', cell, 'data-k', 'hot']];
      if (i === 7) return [['inline', cell, { color: '#00ff00' }]];
      if (i === 8) return [['classes', cell, 'cell fixed']];
      return [];
    }));
  });

  it('raw text and untracked anchors between siblings', async () => {
    const ops: Op[] = [['make', 1]];
    for (let i = 0; i < 8; i++) {
      const id = 10 + i * 2;
      if (i % 3 === 1) {
        ops.push(['make', id, 'text', true], ['insert', id, 1]);
      } else if (i % 3 === 2) {
        ops.push(['anchor', id], ['insert', id, 1]);
      } else {
        ops.push(['make', id], ['scope', id, 'data-v-a'], ['classes', id, 'cell'], ['insert', id, 1]);
      }
    }
    ops.push(['classes', 1, 'row'], ['insert', 1, 0]);
    await both(ops);
  });

  it('same classes, different tag or no scope', async () => {
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
    await both([...row(1, 'tag'), ...row(2, 'scope')]);
  });

  it('mid insert, keyed move, class change, first and last removed, then a fresh row alongside', async () => {
    await both([
      ...vdomRow(1, 6, 0),
      ...vaporRow(2, 6, 0),
      ['tick'],
      ['insert', cellId(1, 5), 1, 0],
      ['make', 170], ['scope', 170, 'data-v-a'], ['classes', 170, 'cell'], ['insert', 170, 1, 3],
      ['classes', cellId(2, 2), 'cell odd'],
      ['remove', cellId(2, 0)],
      ['remove', cellId(2, 5)],
      ['tick'],
      ...vdomRow(3, 4, 0),
      ['insert', cellId(2, 3), 3, 1],
      ['insert', 3, 0, 0],
      ['classes', cellId(3, 1), 'cell'],
      ['inline', cellId(3, 2), { margin: '4px' }],
    ]);
  });

  it('class changes on two cells with a clean one between them', async () => {
    // only the changed cells are dirty: the walk steps over the clean one,
    // which is the second one's `+` neighbour
    await both([
      ...vdomRow(1, 6, 0),
      ['tick'],
      ['classes', cellId(1, 1), 'cell odd'],
      ['classes', cellId(1, 3), 'cell odd'],
      ['tick'],
      ['classes', cellId(1, 1), 'cell'],
      ['classes', cellId(1, 3), 'cell'],
    ]);
  });

  it('inline changes on two cells with a clean one between them', async () => {
    // an inline style does not wake the next sibling, so the middle cell
    // stays clean: the walk steps over it, and it is the third cell's `+`
    // neighbour — not the odd first one
    await both([
      ...vdomRow(1, 5, 0, (i, cell) => (i === 1 ? [['classes', cell, 'cell odd']] : [])),
      ['tick'],
      ['inline', cellId(1, 1), { color: '#010101' }],
      ['inline', cellId(1, 3), { color: '#030303' }],
    ]);
  });

  it('a cell hoisted out mid-flush while its row is being walked', async () => {
    await both(vdomRow(1, 8, 0, (i, cell) => (i === 2 || i === 5 ? [['classes', cell, 'cell fixed']] : [])));
  });

  it('a class added to a mounted element before and after its row lands', async () => {
    await both([
      ...vdomRow(1, 4, 0),
      ['tick'],
      ['make', 50], ['classes', 50, 'cell'], ['classes', 50, 'cell odd'], ['insert', 50, 1, 2],
      ['classes', 50, 'cell'],
      ['scope', 50, 'data-v-a'],
    ]);
  });
});
