// VDOM page embedding a Vapor component (specs/161 §3.2). runtime-core 3.5
// has no Vapor interop interface, so the CLI generates a wrapper component:
// its setup mounts the Vapor block through this module and renders an
// `fjs-vapor-root` placeholder; the renderer's createElement consults the
// hook registered below and hands back the already-built host instead of
// making a new one. The Vapor subtree is therefore ordinary fjs elements in
// the VDOM tree — patching skips them, unmount removes them as usual.
import type { HostNode } from '../vue/renderer';
import { nodeOps, registerAdoptHook } from '../vue/renderer';
import { type Block, type VaporAppContext, type VaporComponent, disposeBlock, mountVaporComponentForAdopt } from './runtime';

interface AdoptEntry {
  root: HostNode;
  /** fragment adopt: the block's nodes, filled under `root` on mount */
  fragment: HostNode[] | null;
  block: Block;
}

const adopts = new Map<number, AdoptEntry>();
const adoptedHosts = new WeakSet<HostNode>();
let adoptSeq = 0;
/** set in setup, consumed by the renderer's createElement when the VDOM
 * mounts the placeholder — synchronous, one at a time */
let pending: { id: number } | null = null;

/** Mounts a Vapor component without inserting it and registers an adoption
 * slot. The generated wrapper calls this in setup, mounts the fragment (if
 * any) in onMounted, and releases in onBeforeUnmount. */
export function adoptVaporComponent(
  comp: VaporComponent,
  props: Record<string, unknown> | undefined,
  appContext: VaporAppContext | null,
): { id: number } {
  const block = mountVaporComponentForAdopt(comp, props, appContext).block;
  const id = ++adoptSeq;
  adopts.set(id, { root: null as unknown as HostNode, fragment: block.nodes.length === 1 ? null : ([...block.nodes] as unknown as HostNode[]), block });
  pending = { id };
  return { id };
}

/** Fills a fragment adoption: the wrapper's onMounted, after the VDOM put
 * the placeholder host into the tree. */
export function mountAdoptNodes(id: number): void {
  const entry = adopts.get(id);
  if (!entry?.fragment) return;
  for (const node of entry.fragment) nodeOps.insert(node as never, entry.root as never, null);
}

/** Stops the block's effects and drops the slot. Host removal is the VDOM's
 * job (it owns the placeholder) — removing here would double-remove. */
export function releaseAdopt(id: number): void {
  const entry = adopts.get(id);
  if (!entry) return;
  adopts.delete(id);
  disposeBlock(entry.block);
}

// the renderer consults these before its own createElement / patchProp
registerAdoptHook({
  createElement(tag: string): HostNode | null {
    if (tag !== 'fjs-vapor-root') return null;
    if (!pending) throw new Error('[fjs vapor] fjs-vapor-root mounted without an adoption slot');
    const entry = adopts.get(pending.id) as AdoptEntry;
    pending = null;
    if (entry.fragment) {
      // a fragment root needs a real host to hang the nodes on
      entry.root = nodeOps.createElement('view');
    } else {
      entry.root = entry.block.nodes[0] as HostNode;
    }
    adoptedHosts.add(entry.root);
    return entry.root;
  },
  isAdopted(el: HostNode): boolean {
    return adoptedHosts.has(el);
  },
});
