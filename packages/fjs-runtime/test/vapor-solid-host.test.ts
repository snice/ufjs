// specs/163: the HostReactivity seam driven by SOLID SIGNALS instead of
// @vue/reactivity — proof that the host contract is not Vue-shaped. The
// test imports src/vapor/host directly (never the Vue binding) and mounts
// a static-shape v-for over a recording backend: cells mount with the
// signal's value, a signal write rewrites every cell through the contract's
// effect queue, and block teardown stops the Solid root so later writes
// land nowhere.
//
// The Solid adapter is the reference for docs/vapor-contract.md: scopes are
// createRoot owners (runWithOwner places later work under them), effects
// are createEffect (Solid batches on its own — the seam's scheduler stays
// idle), boxes are createSignal getter/setter wrappers.
import { createEffect, createRoot, createSignal, getOwner, runWithOwner, type Owner } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  blockOf,
  createFor,
  disposeBlock,
  insertBlock,
  renderEffect,
  setHostReactivity,
  setInsertionState,
  setVaporBackend,
  template,
  txt,
  child,
  type HostNode,
  type HostReactivity,
  type TemplateDef,
} from '../src/vapor/host';

// ---- Solid reactivity through the seam -------------------------------------

interface SolidScope {
  owner: Owner;
  dispose: () => void;
}

let activeOwner: Owner | null = null;

const solidReactivity: HostReactivity<SolidScope> = {
  createScope(): SolidScope {
    let owner!: Owner;
    let dispose!: () => void;
    createRoot((d) => {
      owner = getOwner() as Owner;
      dispose = d;
    });
    return { owner, dispose };
  },
  runInScope<T>(scope: SolidScope, fn: () => T): T {
    const prev = activeOwner;
    activeOwner = scope.owner;
    try {
      return runWithOwner(scope.owner, fn) as T;
    } finally {
      activeOwner = prev;
    }
  },
  stopScope(scope: SolidScope): void {
    // the scope's root owns every effect created under it via runWithOwner
    // — one dispose stops them all
    scope.dispose();
  },
  effect(fn: () => unknown): unknown {
    const owner = activeOwner;
    if (owner !== null) {
      // under a scope: the effect is owned by that scope's root and dies
      // with it (stopScope). Solid roots nested via createRoot would NOT
      // be reached by the parent dispose, so no root here.
      runWithOwner(owner, () => {
        createEffect(() => {
          fn();
        });
      });
      return null;
    }
    // ownerless (top level): own root, stopped via stopEffect
    let dispose!: () => void;
    createRoot((d) => {
      createEffect(() => {
        fn();
      });
      dispose = d;
    });
    return { dispose };
  },
  stopEffect(runner: unknown): void {
    (runner as { dispose: () => void }).dispose();
  },
  box<T>(value: T): { value: T } {
    const [get, set] = createSignal(value);
    return {
      get value() {
        return get();
      },
      set value(v: T) {
        set(v);
      },
    };
  },
};

// Solid's createEffect flushes on a microtask
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// ---- recording backend ------------------------------------------------------

interface RecNode {
  tag: string;
  text: string;
  parent: RecNode | null;
  kids: RecNode[];
}

const rec = (): RecNode => ({ tag: 'view', text: '', parent: null, kids: [] });

function recordingBackend() {
  const anchors: RecNode[] = [];
  const backend = {
    instantiate(def: TemplateDef, hosts: unknown[]): void {
      // one RecNode per def node, pre-order, parents wired; index 0 is the
      // parse's virtual root — a container no host represents
      const virtual = rec();
      hosts[0] = virtual;
      const make = (idx: number): RecNode => {
        const n = def.nodes[idx];
        const r: RecNode = { tag: n.tag || n.kind, text: n.raw ?? '', parent: null, kids: [] };
        if (n.parent >= 0) {
          r.parent = hosts[n.parent] as RecNode;
          (hosts[n.parent] as RecNode).kids.push(r);
        } else {
          r.parent = virtual;
          virtual.kids.push(r);
        }
        return r;
      };
      const walk = (idx: number): void => {
        hosts[idx] = make(idx);
        for (const c of def.nodes[idx].children) walk(c);
      };
      for (const c of def.nodes[0].children) walk(c);
    },
    instantiateMany(def: TemplateDef, count: number): unknown[][] {
      return Array.from({ length: count }, () => {
        const hosts: unknown[] = [];
        backend.instantiate(def, hosts);
        return hosts;
      });
    },
    cloneList(): null {
      return null;
    },
    instantiateBareText(text: string): HostNode {
      return { tag: 'text', text, parent: null, kids: [] } as unknown as HostNode;
    },
    createAnchor(): HostNode {
      const a = rec();
      anchors.push(a);
      return a as unknown as HostNode;
    },
    attach(host: HostNode, parent: HostNode, anchor: HostNode | null): void {
      const h = host as unknown as RecNode;
      const p = parent as unknown as RecNode;
      console.log('ATTACH', h?.tag, '->', p?.tag, 'kids', p?.kids?.length, 'anchor', anchor === null ? 'null' : 'node');
      const at = anchor === null ? p.kids.length : p.kids.indexOf(anchor as unknown as RecNode);
      h.parent = p;
      p.kids.splice(at < 0 ? p.kids.length : at, 0, h);
    },
    setText(host: HostNode, text: string): void {
      (host as unknown as RecNode).text = text;
    },
    setElementText(host: HostNode, text: string): void {
      (host as unknown as RecNode).text = text;
    },
  };
  return { backend, anchors, rec };
}

// ---- the test ----------------------------------------------------------------

const texts = (parent: RecNode): string[] =>
  parent.kids.flatMap((k) => (k.tag === 'text' ? [k.text] : texts(k)));

describe('vapor host contract on Solid signals', () => {
  it('mounts, updates and tears a static-shape list through the seam', async () => {
    setHostReactivity(solidReactivity);
    const { backend } = recordingBackend();
    setVaporBackend(backend as never);

    const [msg, setMsg] = createSignal('x');
    const page = rec();
    // a detached row host (the TplNode's .host) is the list's parent
    const rowNode = template('<view class=row>')();
    const row = rowNode.host as unknown as RecNode;
    setInsertionState(rowNode);
    // non-ONCE numeric list: per-item scope + effect — the reactive shape
    const list = createFor(
      () => 3,
      (item) => {
        const n = template('<view class=cell><text class=tiny> ')();
        renderEffect(() => {
          backend.setText(txt(child(n)).host as HostNode, `${msg()}-${item.value}`);
        });
        return n;
      },
    );

    insertBlock(blockOf(list) ?? { nodes: [] }, row as unknown as HostNode, null);
    // Solid defers effect first-runs to its own queue (Vue runs them
    // synchronously) — the structure is mounted, the texts land on flush
    await settle();
    expect(texts(row)).toEqual(['x-1', 'x-2', 'x-3']);

    // a signal write rewrites every cell through the seam's effects
    setMsg('y');
    await settle();
    expect(texts(row)).toEqual(['y-1', 'y-2', 'y-3']);

    // teardown stops the Solid roots: later writes reach nothing
    disposeBlock(blockOf(list) ?? { nodes: [] });
    setMsg('z');
    await settle();
    expect(texts(row)).toEqual(['y-1', 'y-2', 'y-3']);
  });
});
