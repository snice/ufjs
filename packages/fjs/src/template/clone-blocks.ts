// Template blocks for the VDOM path's native clones (specs/153).
//
// The Vapor compiler hands the runtime a static template per fragment, which
// libfjs-style clones in one word (specs/152). A VDOM render function has no
// such thing — only one vnode per node, each mounted by its own
// createElement / setElementText / setScopeId / class / insert. This
// transform recovers the template for the subtrees where that is exact:
// native elements with nothing but a static class (the subtree root may also
// have a key) whose content is either child elements of the same kind or
// text, where the text is the only thing that may change. The largest such
// subtree is compiled to ONE vnode of the runtime's `fjsTemplate` type,
// carrying its dynamic texts as `t` (fjs-runtime vue/template-block.ts).
//
// It runs at the ROOT's exit: by then every element has its VNodeCall, the
// v-if / v-for wrappers have taken their references to them, and text
// children are merged into one expression. The subtree root's VNodeCall is
// rewritten in place, so those references follow; the descendants' vnodes
// simply disappear from the output.
//
// Left alone:
//   - the template's root (and v-if branches at the root): it is the
//     component's root vnode, which takes fallthrough attrs and passes its
//     scope to the parent's — an element's job, not this vnode's;
//   - anything with events, bindings but :key, directives, refs, style,
//     other attributes, components, slots, v-if / v-for inside, comments, or
//     text mixed with elements (text vnodes).
import {
  CREATE_BLOCK,
  CREATE_VNODE,
  NodeTypes,
  createArrayExpression,
  createCallExpression,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  registerRuntimeHelpers,
  type ElementNode,
  type JSChildNode,
  type NodeTransform,
  type ObjectExpression,
  type ParentNode,
  type Property,
  type RootNode,
  type TemplateChildNode,
  type TransformContext,
  type VNodeCall,
} from '@vue/compiler-core';

/** `import { fjsTemplate as _fjsTemplate } from "vue"` — 'vue' is the fjs
 * shim in a Flutter build. */
export const FJS_TEMPLATE = Symbol('fjsTemplate');
registerRuntimeHelpers({ [FJS_TEMPLATE]: 'fjsTemplate' });

const ELEMENT_TAG = 0; // ElementTypes.ELEMENT
const PATCH_PROPS = 8; // PatchFlags.PROPS

/** [parent, tag, class, static text or null when dynamic] — the runtime's
 * TemplateNode. */
type TemplateNode = [number, string, string | null, string | null];

interface Block {
  nodes: TemplateNode[];
  texts: JSChildNode[];
}

function isTextChild(c: TemplateChildNode): boolean {
  return c.type === NodeTypes.TEXT || c.type === NodeTypes.INTERPOLATION || c.type === NodeTypes.COMPOUND_EXPRESSION;
}

/** The static class, or undefined when [el] has anything else (the key is
 * allowed on the block root only). */
function staticClass(el: ElementNode, isRoot: boolean): string | null | undefined {
  let cls: string | null = null;
  for (const p of el.props) {
    if (p.type === NodeTypes.ATTRIBUTE) {
      if (p.name === 'class') cls = p.value?.content ?? '';
      else if (!(isRoot && p.name === 'key')) return undefined;
    } else if (
      !(isRoot && p.name === 'bind' && p.arg?.type === NodeTypes.SIMPLE_EXPRESSION && p.arg.isStatic && p.arg.content === 'key')
    ) {
      return undefined;
    }
  }
  return cls;
}

/** Appends [el]'s subtree to [block], or returns false when it does not fit. */
function collect(el: ElementNode, parent: number, block: Block, isRoot: boolean): boolean {
  if (el.type !== NodeTypes.ELEMENT || el.tagType !== ELEMENT_TAG) return false;
  const call = el.codegenNode as VNodeCall | undefined;
  if (!call || call.type !== NodeTypes.VNODE_CALL || call.directives || (!isRoot && call.isBlock)) return false;
  const cls = staticClass(el, isRoot);
  if (cls === undefined) return false;
  const at = block.nodes.length;
  const kids = el.children;
  if (kids.length === 1 && isTextChild(kids[0])) {
    const only = kids[0];
    if (only.type === NodeTypes.TEXT) {
      block.nodes.push([parent, el.tag, cls, only.content]);
    } else {
      block.nodes.push([parent, el.tag, cls, null]);
      block.texts.push(call.children as JSChildNode);
    }
    return true;
  }
  block.nodes.push([parent, el.tag, cls, '']);
  for (const c of kids) {
    if (c.type !== NodeTypes.ELEMENT || !collect(c, at, block, false)) return false;
  }
  return true;
}

function keyOf(call: VNodeCall): Property | null | undefined {
  const props = call.props;
  if (props === undefined) return null;
  if (props.type !== NodeTypes.JS_OBJECT_EXPRESSION) return undefined;
  const key = (props as ObjectExpression).properties.find(
    (p) => p.key.type === NodeTypes.SIMPLE_EXPRESSION && p.key.content === 'key',
  );
  return key ?? null;
}

function rewrite(el: ElementNode, block: Block, context: TransformContext): void {
  const call = el.codegenNode as VNodeCall;
  const key = keyOf(call);
  if (key === undefined) return;
  const type = context.hoist(
    createCallExpression(context.helper(FJS_TEMPLATE), [createSimpleExpression(JSON.stringify(block.nodes), false)]),
  );
  const props: Property[] = key ? [key] : [];
  const { texts } = block;
  if (texts.length > 0) {
    props.push(createObjectProperty('t', texts.length === 1 ? texts[0] : createArrayExpression(texts)));
  }
  call.tag = type as unknown as VNodeCall['tag'];
  call.props = props.length ? createObjectExpression(props) : undefined;
  call.children = undefined;
  call.patchFlag = texts.length ? PATCH_PROPS : undefined;
  call.dynamicProps = texts.length ? '["t"]' : undefined;
  call.isComponent = true;
  context.helper(call.isBlock ? CREATE_BLOCK : CREATE_VNODE);
}

/** Top-down: the first node that fits is the largest block on its branch. */
function visit(node: ParentNode | TemplateChildNode, context: TransformContext, atRoot: boolean): void {
  if (node.type === NodeTypes.ELEMENT && !atRoot) {
    const block: Block = { nodes: [], texts: [] };
    if (collect(node, -1, block, true) && block.nodes.length >= 2) {
      rewrite(node, block, context);
      return;
    }
  }
  if (node.type === NodeTypes.IF) {
    for (const b of node.branches) visit(b, context, atRoot);
    return;
  }
  const children = (node as { children?: unknown }).children;
  if (!Array.isArray(children)) return;
  // a v-if branch keeps the root's position; anything else is below it
  const below = node.type !== NodeTypes.ROOT && node.type !== NodeTypes.IF_BRANCH ? false : atRoot;
  for (const c of children as TemplateChildNode[]) visit(c, context, node.type === NodeTypes.ROOT || below);
}

export const cloneBlocksTransform: NodeTransform = (node, context) => {
  if (node.type !== NodeTypes.ROOT) return;
  return () => visit(node as RootNode, context, true);
};
