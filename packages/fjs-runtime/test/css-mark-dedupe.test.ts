// specs/118 — a subtree walk (markDirty(id, true)) stops at a node whose
// whole subtree was already walked in the same pending set. Vue mounts
// bottom-up and every insert of a subtree root re-walks what it carries, so
// without this a node N levels deep was visited N times per mount.
//
// What could silently go wrong is a node that never gets queued, so these
// build trees exactly the way the renderer does (link, then
// recomputeSubtree(child), innermost first) and check the styles that
// come out, not just the counters.
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
  /** createElement: registered, not attached. */
  const make = (id: number, tag = 'view') => {
    parentOf.set(id, null);
    childrenOf.set(id, []);
    engine.ensure(id, tag);
    return id;
  };
  /** nodeOps.insert: attach, then recompute the child's subtree. */
  const insert = (child: number, parent: number) => {
    const old = parentOf.get(child);
    if (old != null) {
      const list = childrenOf.get(old)!;
      list.splice(list.indexOf(child), 1);
    }
    parentOf.set(child, parent);
    childrenOf.get(parent)!.push(child);
    engine.recomputeSubtree(child);
  };
  return { engine, applied, make, insert };
}

describe('subtree mark dedupe (specs/118)', () => {
  it('a bottom-up mount visits each node about once and styles every one', async () => {
    const { engine, applied, make, insert } = makeEngine();
    engine.register(null, '.root { color: #f00 } .leaf { font-size: 20px }');
    const root = make(1);
    engine.setClasses(root, 'root');
    await styleTick();

    // a chain of 12 below a fresh top node, built innermost first
    const DEPTH = 12;
    const ids = Array.from({ length: DEPTH }, (_, i) => make(100 + i));
    engine.setClasses(ids[DEPTH - 1], 'leaf');
    engine.resetStats();
    for (let i = DEPTH - 1; i > 0; i--) insert(ids[i], ids[i - 1]);
    insert(ids[0], root);
    const visited = engine.stats.markVisited;
    await styleTick();

    // without the dedupe this walk is 1 + 2 + … + 12 = 78 visits
    expect(visited).toBeLessThanOrEqual(DEPTH * 2);
    for (const id of ids) expect(applied.get(id)?.color, `node ${id}`).toBe('#f00');
    expect(applied.get(ids[DEPTH - 1])?.fontSize).toBe(20);
  });

  it('a subtree moved within the same pending set restyles under its new parent', async () => {
    const { engine, applied, make, insert } = makeEngine();
    engine.register(null, '.red { color: #f00 } .blue { color: #00f }');
    const root = make(1);
    const red = make(2);
    const blue = make(3);
    insert(red, root);
    insert(blue, root);
    engine.setClasses(red, 'red');
    engine.setClasses(blue, 'blue');
    await styleTick();

    // mount a small subtree under red, then — before any flush — move one of
    // its already-walked nodes under blue (a keyed v-for move)
    const box = make(10);
    const kid = make(11);
    const grandkid = make(12);
    insert(grandkid, kid);
    insert(kid, box);
    insert(box, red);
    insert(kid, blue);
    await styleTick();

    expect(applied.get(box)?.color).toBe('#f00');
    expect(applied.get(kid)?.color).toBe('#00f');
    expect(applied.get(grandkid)?.color).toBe('#00f');
  });

  it('a child attached below an already-walked node in the same set is styled', async () => {
    const { engine, applied, make, insert } = makeEngine();
    engine.register(null, '.root { color: #0a0 }');
    const root = make(1);
    engine.setClasses(root, 'root');
    await styleTick();

    const box = make(10);
    insert(box, root); // walks and stamps box
    const late = make(11);
    insert(late, box); // same pending set, below a stamped node
    await styleTick();

    expect(applied.get(box)?.color).toBe('#0a0');
    expect(applied.get(late)?.color).toBe('#0a0');
  });

  it('stamps expire with the flush: a later restyle walks the subtree again', async () => {
    const { engine, applied, make, insert } = makeEngine();
    engine.register(null, '.a { color: #f00 } .b { color: #00f }');
    const root = make(1);
    const box = make(2);
    const leaf = make(3);
    insert(leaf, box);
    insert(box, root);
    engine.setClasses(root, 'a');
    await styleTick();
    expect(applied.get(leaf)?.color).toBe('#f00');

    engine.setClasses(root, 'b');
    await styleTick();
    expect(applied.get(leaf)?.color).toBe('#00f');
  });
});
