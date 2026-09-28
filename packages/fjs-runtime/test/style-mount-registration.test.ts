// specs/146 — the mount-time registration fast paths: markDirty(subtree)
// returning early for a root already walked in the pending set,
// noteStructureChange marking a parent's children once per pending set, and
// interned scope sets.
//
// All three skip work on the claim that it was already done. If a claim is
// wrong an element keeps a stale style and nothing throws (constitution V),
// so each scenario runs twice: once batched the way Vue mounts (everything
// in one pending set, where the fast paths fire) and once with a flush after
// every single operation (a fresh pending set each time, where none of them
// can). The final styles must match element for element.
import { describe, expect, it } from 'vitest';
import { StyleEngine } from '../src/css/style';

const SHEET = `
.row { flex-direction: row; font-size: 9px; --c: #123456; }
.cell { background-color: #85d8b4; margin: 1px; }
.cell:first-child { border-color: #ff0000; }
.cell:last-child { border-color: #0000ff; }
.cell + .cell { margin-left: 2px; }
.cell:active { opacity: 0.5; }
.tiny { color: var(--c); line-height: 5px; }
.fade-enter-from { opacity: 0; }
`;
const SCOPED = `.cell { padding: 3px; } .tiny { font-weight: 600; }`;

type Op =
  | ['make', number, string?]
  | ['insert', number, number, number?]
  | ['remove', number]
  | ['classes', number, string]
  | ['scope', number, string]
  | ['tick'];

function harness() {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, string>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, active) => {
    applied.set(id, JSON.stringify([style, active]));
  });
  engine.register(null, SHEET);
  engine.register('data-v-a', SCOPED);
  parentOf.set(0, null);
  childrenOf.set(0, []);
  engine.ensure(0, 'view');

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
        // the renderer's nodeOps.insert: detach, link, recomputeSubtree,
        // then noteStructureChange on the new parent
        const [, child, parent, at] = op;
        detach(child);
        const list = childrenOf.get(parent)!;
        list.splice(at ?? list.length, 0, child);
        parentOf.set(child, parent);
        engine.recomputeSubtree(child);
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
    }
  };
  return { engine, applied, apply, childrenOf };
}

const tick = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** Runs `ops` batched (flushing only at explicit ticks) and one flush per
 * op, and returns both final style maps restricted to live elements. */
async function both(ops: Op[]) {
  const run = async (eachOp: boolean) => {
    const h = harness();
    if (eachOp) {
      // the reference must not share the code under test: a wrong skip in
      // noteStructureChange would otherwise go wrong on both sides and
      // compare equal. This is the pre-146 body — mark every child, always.
      const eng = h.engine as unknown as {
        mark: (id: number) => void;
        scheduleFlush: () => void;
        noteStructureChange: (parentId: number) => void;
      };
      eng.noteStructureChange = (parentId) => {
        for (const kid of h.childrenOf.get(parentId) ?? []) eng.mark(kid);
        eng.scheduleFlush();
      };
    }
    for (const op of ops) {
      if (op[0] === 'tick') await tick();
      else {
        h.apply(op);
        if (eachOp) await tick();
      }
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
  return { batched: await run(false), reference: await run(true) };
}

/** A row of `n` cells with a text each, built the way Vue mounts: create,
 * children first, then scope and class, then insert into the parent. */
function vueRow(row: number, n: number, into: number): Op[] {
  const ops: Op[] = [['make', row]];
  for (let i = 0; i < n; i++) {
    const cell = row * 100 + i * 2 + 1;
    const text = cell + 1;
    ops.push(
      ['make', cell], ['make', text, 'text'],
      ['scope', text, 'data-v-a'], ['classes', text, 'tiny'], ['insert', text, cell],
      ['scope', cell, 'data-v-a'], ['classes', cell, 'cell'], ['insert', cell, row],
    );
  }
  ops.push(['scope', row, 'data-v-a'], ['classes', row, 'row'], ['insert', row, into]);
  return ops;
}

describe('mount registration fast paths (specs/146)', () => {
  it('a Vue-order mount styles every element as a flush-per-op mount does', async () => {
    const { batched, reference } = await both([...vueRow(1, 6, 0), ...vueRow(2, 6, 0)]);
    expect(batched.size).toBe(reference.size);
    expect(batched).toEqual(reference);
  });

  it('classes and scopes set after insert, in the same pending set', async () => {
    const ops: Op[] = [['make', 1], ['insert', 1, 0]];
    for (let i = 0; i < 5; i++) {
      const cell = 10 + i;
      ops.push(['make', cell], ['insert', cell, 1], ['scope', cell, 'data-v-a'], ['classes', cell, 'cell']);
    }
    ops.push(['classes', 1, 'row']);
    const { batched, reference } = await both(ops);
    expect(batched).toEqual(reference);
  });

  it('a keyed move and a mid-list insert re-resolve first/last and + siblings', async () => {
    const { batched, reference } = await both([
      ...vueRow(1, 5, 0),
      ['tick'],
      // move the last cell to the front, then add one in the middle, then
      // drop the (new) second one — all in one pending set
      ['insert', 109, 1, 0],
      ['make', 150], ['scope', 150, 'data-v-a'], ['classes', 150, 'cell'], ['insert', 150, 1, 3],
      ['remove', 101],
    ]);
    expect(batched).toEqual(reference);
  });

  it('a Transition class added before insert and dropped after', async () => {
    const { batched, reference } = await both([
      ...vueRow(1, 3, 0),
      ['tick'],
      ['make', 60], ['scope', 60, 'data-v-a'], ['classes', 60, 'cell fade-enter-from'],
      ['insert', 60, 1],
      ['classes', 60, 'cell'],
    ]);
    expect(batched).toEqual(reference);
  });

  it('interned scope sets are shared but never written through', async () => {
    const h = harness();
    for (const op of [['make', 1], ['make', 2], ['insert', 1, 0], ['insert', 2, 0],
      ['scope', 1, 'data-v-a'], ['scope', 2, 'data-v-a'], ['classes', 1, 'cell'], ['classes', 2, 'cell'],
    ] as Op[]) h.apply(op);
    await tick();
    const before = h.applied.get(2);
    h.apply(['scope', 1, 'data-v-b']);
    await tick();
    // element 2 still carries only data-v-a: the padding from the scoped
    // sheet, and no restyle at all
    expect(h.applied.get(2)).toBe(before);
    expect(JSON.parse(before!)[0].padding).toBeDefined();
  });

  it('noteStructureChange marks a row of N once, not 1 + 2 + … + N times', () => {
    const h = harness();
    const eng = h.engine as unknown as { mark: (id: number) => void };
    const mark = eng.mark.bind(h.engine);
    let marks = 0;
    eng.mark = (id) => {
      marks++;
      mark(id);
    };
    for (const op of vueRow(1, 40, 0)) h.apply(op);
    // 81 elements: ensure marks each once, plus one full pass per parent.
    // Re-marking every sibling on every insert would be 1 + 2 + … + 40.
    expect(marks).toBeLessThan(81 * 3);
  });
});
