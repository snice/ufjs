// `<rich-text>` — a component, not a Dart tag.
//
// Everything rich-text does is organisation: parse the HTML, drop what is
// not trusted, pick default styles, number list items, fold a table into
// rows. By constitution VII that stays in JS, and BOTH platforms run this
// one file (rich-text/*.ts holds the pipeline). What it renders are four
// existing tags — view / text / image / divider — looked up with
// resolveDynamicComponent, which yields the host element name on Flutter and
// the web adapter's component in a browser (the same trick picker.ts uses).
//
// The one thing JS cannot do is lay several differently-styled runs out as
// ONE paragraph. That capability went into the hosts as the meaning of a
// `text` nested in a `text` (widgets/text.dart, web/base-css.ts), for every
// page, not as a private tag for this component (specs/034 §3.5).
import {
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  type PropType,
  type VNode,
} from '@vue/runtime-core';
// tag names resolve through the vapor runtime too (specs/171)
import { resolveDynamicComponent } from '../vapor/instance';
import { layoutRichText, type RenderChild, type RenderElement } from '../rich-text/layout';
import { parseHtml } from '../rich-text/parse';
import { sanitizeNodes } from '../rich-text/sanitize';
import type { RichTextNode } from '../rich-text/types';
import { warnRichTextOnce } from '../rich-text/warn';

export const FjsRichText = defineComponent({
  name: 'FjsRichText',
  inheritAttrs: false,
  props: {
    nodes: {
      type: [String, Array] as PropType<string | readonly RichTextNode[]>,
      default: () => [],
    },
    space: { type: String, default: undefined },
    userSelect: { type: [Boolean, String], default: false },
    mode: { type: String, default: 'default' },
  },
  setup(props, { attrs }) {
    // Inner nodes are rendered by THIS component, and Vue only stamps an
    // element with the scope of the component that rendered it — rich-text
    // has no <style scoped>, so the page's `.title[data-v-…]` would match
    // nothing inside it. The mini program applies the page's styles to
    // rich-text classes, so the page's scope id is copied onto every inner
    // vnode by hand; mountElement reads `vnode.scopeId` and hands it to the
    // renderer (styleEngine.addScope on Flutter, a data-v attribute on the
    // web). On the web the inner nodes are adapter COMPONENTS, whose root
    // element inherits their vnode's scopeId through Vue's setScopeId
    // parent walk (runtime-core, "vnode === subTree"). Pinned by
    // test/rich-text-component.test.ts and test/vue_styles.test.ts.
    const pageScope = getCurrentInstance()?.vnode.scopeId ?? null;

    const tree = computed(() => {
      const source = props.nodes;
      const raw = typeof source === 'string' ? parseHtml(source) : source;
      return layoutRichText(sanitizeNodes(raw), { space: props.space });
    });

    return () => {
      if (props.userSelect === true || props.userSelect === 'true' || props.userSelect === '') {
        warnRichTextOnce('user-select', 'user-select is not supported; text stays unselectable');
      }
      if (props.mode && props.mode !== 'default') {
        warnRichTextOnce(`mode:${props.mode}`, `mode="${props.mode}" is Skyline-only and not supported; rendered as default`);
      }

      const resolved = new Map<string, unknown>();
      const resolve = (tag: string) => {
        let target = resolved.get(tag);
        if (target === undefined) {
          target = resolveDynamicComponent(tag);
          resolved.set(tag, target);
        }
        return target as string;
      };

      const scoped = (vnode: VNode): VNode => {
        if (pageScope) vnode.scopeId = pageScope;
        return vnode;
      };

      const render = (child: RenderChild): VNode | string => {
        if (typeof child === 'string') return child;
        return scoped(renderElement(child));
      };

      const renderElement = (el: RenderElement): VNode => {
        const target = resolve(el.tag);
        const data: Record<string, unknown> = { ...el.props };
        if (el.class) data.class = el.class;
        if (el.style) data.style = el.style;
        if (!el.children) return h(target, data);
        if (el.children.length === 1 && typeof el.children[0] === 'string') {
          // A lone string is the element's own text (Vue's setElementText),
          // not a child: `<b>x</b>` is one node instead of a span plus a text
          // node under it — half the nodes of a spec 034 paragraph were
          // these leaves (specs/035 §1).
          const only = el.children[0];
          return typeof target === 'string' ? h(target, data, only) : h(target, data, { default: () => only });
        }
        const kids = el.children.map(render);
        // an element takes its children directly, a component through its
        // default slot
        return typeof target === 'string' ? h(target, data, kids) : h(target, data, { default: () => kids });
      };

      const view = resolve('view');
      const kids = tree.value.map(render);
      return scoped(
        typeof view === 'string'
          ? h(view, { ...attrs }, kids)
          : h(view, { ...attrs }, { default: () => kids }),
      );
    };
  },
});
