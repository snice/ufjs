import { warn } from '../terminal/colors.js';
// Vue template AST -> WXML. This is the mp half of what compileTemplate does
// for the other two platforms: instead of a render function (which would drag
// the vdom runtime in), directives become wx:* attributes, bindings become
// {{}} interpolations, and everything the WXML expression language cannot
// evaluate (function calls, object :class/:style, inline event handlers)
// is extracted into generated setup code (the wevu-shaped runtime in
// @ufjs/runtime/wx supplies ref/computed and the setData diff).
//
// Event handlers all funnel through one method, `__fjsCall`: the template
// carries the target's name and any v-for scope values in data-* attributes
// (closures generated into the script can't see template scope), and the
// runtime adapts the raw wx event to fjs payload semantics (events.ts).
import {
  baseParse,
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type RootNode,
  type SimpleExpressionNode,
  type TemplateChildNode,
  type TextNode,
  type InterpolationNode,
  type ExpressionNode,
  NodeTypes,
} from '@vue/compiler-core';
import { swiperChildMessage, swiperChildViolations } from '../template/swiper-children.js';

// ---- tag mapping (spec 046 §4.3) -------------------------------------------

/** fjs tag -> wxml tag. Everything not listed passes through verbatim —
 * hello-fjs's tag set deliberately mirrors the wx built-ins. */
const TAG_REWRITE: Record<string, string> = {
  'inner-canvas': 'canvas',
  modal: 'fjs-modal', // custom component shipped by @ufjs/runtime/wx
  // runtime component: env(safe-area-inset-*) is unreliable in the DevTools
  // webview simulator, so the insets are measured at runtime (getWindowInfo)
  'safe-area': 'fjs-safe-area',
  // the wx built-ins carry a different contract (checked vs value, change
  // only on the group), so the fjs controls are runtime components
  checkbox: 'fjs-checkbox',
  radio: 'fjs-radio',
  'checkbox-group': 'fjs-checkbox-group',
  'radio-group': 'fjs-radio-group',
  label: 'fjs-label',
  progress: 'fjs-progress',
  // rich-text: skyline only, see resolveTag
};

/** fjs tags that downgrade to a plain view carrying a builtin class — the
 * class gets its wxss appended to the component's stylesheet (see css.ts). */
const TAG_DOWNCAST: Record<string, { tag: string; cls: string }> = {
  stack: { tag: 'view', cls: 'fjs-stack' },
  divider: { tag: 'view', cls: 'fjs-divider' },
  position: { tag: 'view', cls: 'fjs-position' },
};

/** specs/052 + 053: sticky-header / sticky-section exist as native
 * components under skyline only. The webview renderer compiles them to the
 * runtime's custom components (fjs-sticky-header / fjs-sticky-section,
 * virtualHost + IntersectionObserver): a bare view downgrade would leave
 * `bindstickontopchange` on a node that can never fire it and could not
 * carry a bound offset-top. Skyline passes the tags through verbatim
 * (resolveTag). */
const STICKY_WX_COMPONENTS: Record<string, string> = {
  'sticky-header': 'fjs-sticky-header',
  'sticky-section': 'fjs-sticky-section',
};

/** Static `type="custom"` on a scroll-view: skyline's sticky mode. The
 * sticky components must be DIRECT children of such a scroll-view, which is
 * why the compiler keeps its hands off (no type injection, no
 * .fjs-scroll-inner wrapper). A bound type cannot be resolved here and
 * compiles as the ordinary list scroller. */
function isCustomScrollView(el: ElementNode): boolean {
  return staticAttr(el, 'type') === 'custom';
}

/** Attributes injected to keep skyline semantics right. */
const INJECTED_ATTRS: Record<string, Record<string, string>> = {
  // skyline's scroll-view only lays out as a list when typed; the attr is
  // accepted by the webview renderer too, so it's unconditional
  // enable-flex: the webview renderer needs it for a flex scroll-view — the
  // .fjs-box baseline makes every scroll-view one, and without the flex
  // display its scroll area ignores the content (scrollHeight stays at the
  // box height: nothing scrolls). Without the attr it also warns.
  'scroll-view': { type: 'list', 'enable-flex': '{{ true }}' },
  canvas: { type: '2d' },
};

/** Event name fixes for native tags (@click is the fjs spelling of tap). */
const NATIVE_EVENT_ALIAS: Record<string, string> = {
  click: 'tap',
  'long-press': 'longpress',
};

/** tag-specific fjs -> wx event name remaps (checked before NATIVE_EVENT_ALIAS). */
const TAG_EVENT_ALIAS: Record<string, Record<string, string>> = {
  swiper: { 'page-changed': 'change' },
  input: { submit: 'confirm' },
  textarea: { submit: 'confirm' },
};

/** rewritten tags backed by runtime-provided component four-packs */
const RUNTIME_COMPONENT_TAGS = new Set([
  'fjs-modal', 'fjs-safe-area', 'fjs-checkbox', 'fjs-radio', 'fjs-checkbox-group',
  'fjs-radio-group', 'fjs-label', 'fjs-progress', 'fjs-rich-text',
  'fjs-sticky-header', 'fjs-sticky-section',
]);

/** Host classes of runtime components (their default layout, APP_WXSS) —
 * a page's own classes on the same host come later and win. */
const RUNTIME_HOST_CLASS: Record<string, string> = {
  'fjs-checkbox': 'fjs-choice-host',
  'fjs-radio': 'fjs-choice-host',
  'fjs-checkbox-group': 'fjs-group-host',
  'fjs-radio-group': 'fjs-group-host',
  'fjs-label': 'fjs-label-host',
  'fjs-progress': 'fjs-progress-host',
};

/** Container tags carrying the layout baseline class. Skyline supports
 * CLASS selectors only — tag selectors (`view {}`) are ignored — so the
 * flex-column/border-box baseline rides on this class instead (see
 * APP_WXSS in project.ts). Must mirror APP_WXSS's old tag list. */
const CONTAINER_TAGS = new Set([
  'view', 'scroll-view', 'list-view', 'swiper-item', 'refresh', 'swiper',
  'form', 'label', 'radio', 'slider', 'checkbox', 'switch', 'progress',
  'picker-view', 'picker-view-column',
]);

const GLOBAL_IDENTIFIERS = new Set([
  'Math', 'JSON', 'console', 'Date', 'Number', 'String', 'Boolean', 'Array',
  'Object', 'undefined', 'null', 'true', 'false', 'Infinity', 'NaN',
  '$event', 'wx', 'getCurrentPages', 'encodeURIComponent', 'parseInt',
  'parseFloat', 'isNaN', 'Symbol', 'window', 'document',
]);

// ---- expression utilities ---------------------------------------------------

interface BindingInfo {
  bindings: Record<string, string>;
  /** identifiers never touched: v-for vars, handler params, generated names */
  skip: Set<string>;
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function prevMeaningful(expr: string, index: number): string {
  for (let i = index - 1; i >= 0; i--) {
    if (!/\s/.test(expr[i])) return expr[i];
  }
  return '';
}

function nextMeaningful(expr: string, index: number): string {
  for (let i = index; i < expr.length; i++) {
    if (!/\s/.test(expr[i])) return expr[i];
  }
  return '';
}

/** Walks the identifiers of `expr` (skipping string literals, object literal
 * keys, property accesses), feeding each to `visit` and joining results. */
function mapIdentifiers(
  expr: string,
  visit: (ident: string, isObjectKey: boolean, isProperty: boolean) => string,
): string {
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '`') {
      // template literal: the text is opaque, but every ${ } is an
      // expression whose identifiers count like any others
      let j = i + 1;
      out += ch;
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === '\\') {
          out += expr.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (expr[j] === '$' && expr[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          while (k < expr.length && depth > 0) {
            if (expr[k] === '{') depth++;
            else if (expr[k] === '}') depth--;
            if (depth > 0) k++;
          }
          out += '${' + mapIdentifiers(expr.slice(j + 2, k), visit) + '}';
          j = k + 1;
          continue;
        }
        out += expr[j];
        j++;
      }
      out += '`';
      i = j + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < expr.length && expr[j] !== quote) {
        if (expr[j] === '\\') j++;
        j++;
      }
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_$]/.test(expr[j])) j++;
      const ident = expr.slice(i, j);
      const isProperty = prevMeaningful(expr, i) === '.';
      const next = nextMeaningful(expr, j);
      const isObjectKey = (prevMeaningful(expr, i) === '{' || prevMeaningful(expr, i) === ',') && next === ':';
      out += visit(ident, isObjectKey, isProperty);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Free identifiers that are NOT setup bindings and NOT globals — on a
 * template, that means v-for/slot scope vars. These must ride to a handler
 * through data-args. */
export function freeScopeIdentifiers(
  expr: string,
  bindings: Record<string, string>,
  skip: Set<string>,
): string[] {
  const found: string[] = [];
  mapIdentifiers(expr, (ident, isObjectKey, isProperty) => {
    if (
      !isObjectKey &&
      !isProperty &&
      !skip.has(ident) &&
      !GLOBAL_IDENTIFIERS.has(ident) &&
      !(ident in bindings) &&
      !found.includes(ident)
    ) {
      found.push(ident);
    }
    return '';
  });
  return found;
}

/** Appends `.value` to setup refs (binding type `setup-ref`) so generated
 * code can read AND assign them. Mirrors what compileTemplate's
 * transformExpression does for render functions. */
export function rewriteExpr(expr: string, info: BindingInfo): string {
  return mapIdentifiers(expr, (ident, isObjectKey, isProperty) => {
    if (isObjectKey || isProperty || info.skip.has(ident)) return ident;
    if (info.bindings[ident] === 'setup-ref') return ident + '.value';
    return ident;
  });
}

/** Setup bindings referenced anywhere in an expression — the candidates for
 * the snapshot data the wxml expressions read. */
export function referencedBindings(expr: string, bindings: Record<string, string>): string[] {
  const found: string[] = [];
  mapIdentifiers(expr, (ident, isObjectKey, isProperty) => {
    if (!isObjectKey && !isProperty && ident in bindings && !found.includes(ident)) {
      found.push(ident);
    }
    return '';
  });
  return found;
}

// ---- codegen ----------------------------------------------------------------

export interface WxmlOptions {
  /** bindingMetadata from compileScript ('setup-ref' etc.). */
  bindings: Record<string, string>;
  /** scope id stamped as a class on every element (skyline doesn't match
   * attribute selectors, so the scoped-styles trick needs a class). */
  scopeId?: string;
  /** Local SFC imports: setup binding name -> source file. An element tag
   * matching a name here compiles as a custom component. */
  vueImports: Map<string, string>;
  /** Widget tags declared by fjs modules (`fjs.widgets.*.mp`) — custom
   * components the mp build copies from the module package. */
  moduleTags?: Set<string>;
  /** Local component tags removed from the mp emission entirely (the app's
   * custom tab bar when the native tabBar takes over). Usages in templates
   * are dropped; the SFC is never compiled. */
  stripTags?: Set<string>;
  /** Class names of THIS SFC whose rules set `height` — lets the scroll-view
   * check accept class-based heights (`.page { height: 100vh }`). */
  heightClasses?: Set<string>;
  /** Class for the template's root elements (the shell's: fills the page). */
  rootClass?: string;
  /** This page renders inside the shell's scrolling body: a root
   * scroll-view of its own compiles to a plain view (see genNode). */
  pageInScroll?: boolean;
  /** Class names of THIS SFC that put a column's children on the center or
   * end of the cross axis (`align-items`), and classes that give a text a
   * visible box (background, border, padding, width). See textFillClass. */
  crossAlignClasses?: Map<string, 'center' | 'end'>;
  boxedClasses?: Set<string>;
  /** class -> its `touch-action` (none / pan-x / pan-y) — see touchActionOf */
  touchActionClasses?: Map<string, TouchAction>;
  /** app renderer (app.config wxmp.renderer): skyline gets gesture handlers
   * around touch-action nodes */
  renderer?: 'webview' | 'skyline';
  /** Classes of THIS SFC that set the fjs `direction: horizontal` key —
   * such a scroll-view scrolls on x. */
  horizontalClasses?: Set<string>;
  /** Setup bindings initialized to a number (`const rows = ref(20)`) — a
   * v-for over one needs Vue's 1..n counting at runtime. */
  numericBindings?: Set<string>;
  /** Classes of THIS SFC used in an `X:active` selector (css.ts turns it
   * into the hover-class press state). */
  activeClasses?: Set<string>;
  /** subject class -> @media block indexes (css.ts extractMedia) */
  mediaClasses?: Map<string, number[]>;
  /** class -> its `color` declaration (see inheritedColorOf) */
  colorClasses?: Map<string, string>;
  /** class -> its flex layout declarations (see layoutStyleOf) */
  layoutClasses?: Map<string, string>;
  /** canvas `type` for this SFC when not 2d (the SFC imports @ufjs/webgl) */
  canvasType?: 'webgl';
  filename: string;
}

export interface WxmlResult {
  wxml: string;
  /** `const __ev0 = ...` lines to inject into setup(). */
  setupCode: string[];
  /** Names to add to script-setup's __returned__ (handlers + computeds). */
  returnedNames: string[];
  /** The template calls the fjs wxs helpers (FJS_WXS in project.ts). */
  usesWxs: boolean;
  /** The template has a `v-motion` element — the module needs the motion
   * helpers and @vueuse/motion's `useMotion` (script.ts MOTION_IMPORT). */
  usesMotion: boolean;
  /** Setup bindings referenced from template expressions — the runtime
   * narrows setData to exactly these keys. */
  dataNames: string[];
  /** usingComponents entries: kebab tag -> absolute source path of the
   * local SFC, or a runtime component name. */
  usingComponents: Map<string, string>;
  /** builtin classes used by downcast tags (css.ts appends their styles). */
  fjsClasses: string[];
  /** `<canvas ref>`s — the runtime binds them to canvas nodes (wx/canvas.ts). */
  canvasRefs?: Array<{ ref: string; resize: boolean }>;
}

interface Ctx extends WxmlOptions, WxmlResult {
  canvasRefs: Array<{ ref: string; resize: boolean }>;
  counters: { ev: number; cls: number; sty: number; d: number; m: number; l: number };
  /** cross-axis alignment of each open element, innermost last */
  alignStack: Array<'center' | 'end' | null>;
  /** static `color` of each open element (null = not set there) */
  colorStack: Array<string | null>;
  /** row height of each open picker-view, innermost last */
  pickerRowStack: number[];
  /** open picker-views with a bound value: the generated sync flag and what
   * it watches (the value and the v-for lists of its rows), innermost last */
  pickerSyncStack: Array<{ name: string; deps: string[] } | null>;
  /** the sync entry genAttrs made for the picker-view being opened */
  pendingPickerSync: { name: string; deps: string[] } | null;
}

interface Scope {
  forVars: Set<string>;
  /** enclosing v-for loops, outermost first (list expr in its outer scope) */
  forStack: Array<{ item: string; index: string; list: string }>;
}

const INDENT = '  ';
const pad = (depth: number) => INDENT.repeat(depth);

export function genWxml(template: string, options: WxmlOptions): WxmlResult {
  const tree: RootNode = baseParse(template);
  const ctx: Ctx = {
    ...options,
    wxml: '',
    setupCode: [],
    returnedNames: [],
    dataNames: [],
    usesWxs: false,
    usesMotion: false,
    usingComponents: new Map(),
    fjsClasses: [],
    canvasRefs: [],
    counters: { ev: 0, cls: 0, sty: 0, d: 0, m: 0, l: 0 },
    alignStack: [],
    colorStack: [],
    pickerRowStack: [],
    pickerSyncStack: [],
    pendingPickerSync: null,
  };
  ctx.wxml = genChildren(tree.children, ctx, { forVars: new Set(), forStack: [] }, 0);
  if (ctx.usesWxs) ctx.wxml = `<wxs module="__fjs" src="/fjs/fjs.wxs" />\n${ctx.wxml}`;
  return {
    wxml: ctx.wxml,
    setupCode: ctx.setupCode,
    returnedNames: ctx.returnedNames,
    dataNames: ctx.dataNames,
    usesWxs: ctx.usesWxs,
    usesMotion: ctx.usesMotion,
    usingComponents: ctx.usingComponents,
    fjsClasses: ctx.fjsClasses,
    canvasRefs: ctx.canvasRefs,
  };
}

function trackData(ctx: Ctx, expr: string): void {
  for (const name of referencedBindings(expr, ctx.bindings)) {
    if (!ctx.dataNames.includes(name)) ctx.dataNames.push(name);
  }
}

function genChildren(nodes: TemplateChildNode[], ctx: Ctx, scope: Scope, depth: number, parentTag?: string): string {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === NodeTypes.COMMENT) continue;
    // WXML preserves whitespace: emitting each text/interpolation child on
    // its own indented line renders REAL line breaks inside <text>. Runs of
    // adjacent text/interpolation therefore join onto one line, whitespace
    // condensed (Vue's own condense semantics).
    if (node.type === NodeTypes.TEXT || node.type === NodeTypes.INTERPOLATION) {
      const run: Array<{ text?: string; expr?: string }> = [];
      for (let j = i; j < nodes.length; j++) {
        const n = nodes[j];
        if (n.type === NodeTypes.TEXT) run.push({ text: (n as TextNode).content });
        else if (n.type === NodeTypes.INTERPOLATION)
          run.push({ expr: inlineExpr(exprContent((n as InterpolationNode).content), ctx, scope) });
        else break;
      }
      i += run.length - 1;
      // condense whitespace: trim the run's ends, collapse inner runs; the
      // single spaces BETWEEN parts are meaningful (Wi-Fi {{ x }}，推送)
      if (run[0]?.text !== undefined) run[0].text = run[0].text.replace(/^\s+/, '');
      const last = run[run.length - 1];
      if (last?.text !== undefined) last.text = last.text.replace(/\s+$/, '');
      const emitted = run.filter((p) => (p.text !== undefined ? p.text !== '' : true));
      if (!emitted.length) continue;
      let out2: string;
      if (emitted.length === 1) {
        const only = emitted[0];
        out2 = only.text !== undefined ? escapeText(only.text) : `{{ ${only.expr} }}`;
      } else {
        // one concatenation expression: 'text' + (expr) + 'text'
        const terms = emitted
          .map((p) => {
            if (p.expr !== undefined) return `(${p.expr})`;
            const t = p.text!.replace(/\s+/g, ' ');
            const quote = t.includes("'") ? '"' : "'";
            return t.includes(quote) ? t : `${quote}${t}${quote}`;
          })
          .join(' + ');
        out2 = `{{ ${terms} }}`;
      }
      if (out2) out += pad(depth) + out2 + '\n';
      continue;
    }
    const ifDir = findDir(node, 'if');
    if (ifDir) {
      out += genNode(node, ctx, scope, depth, { ifAttr: ifAttrOf(ifDir.exp, ctx, scope, 'wx:if'), parentTag });
      let j = i + 1;
      while (j < nodes.length) {
        const sib = nodes[j];
        const elif = findDir(sib, 'else-if');
        const els = findDir(sib, 'else');
        if (elif) {
          out += genNode(sib, ctx, scope, depth, {
            ifAttr: ifAttrOf(elif.exp, ctx, scope, 'wx:elif'),
            parentTag,
          });
        } else if (els) {
          out += genNode(sib, ctx, scope, depth, { ifAttr: ' wx:else', parentTag });
        } else break;
        j++;
      }
      i = j - 1;
      continue;
    }
    if (findDir(node, 'else-if') || findDir(node, 'else')) {
      continue; // orphaned branch — the chain above consumed it
    }
    out += genNode(node, ctx, scope, depth, { parentTag });
  }
  return out;
}

function ifAttrOf(
  exp: ExpressionNode | undefined,
  ctx: Ctx,
  scope: Scope,
  name: 'wx:if' | 'wx:elif',
): string {
  const expr = exprContent(exp);
  trackData(ctx, expr);
  return ` ${name}="{{ ${inlineExpr(expr, ctx, scope)} }}"`;
}

interface GenOpts {
  /** pre-built wx:if/elif/else attribute (from the chain walk) */
  ifAttr?: string;
  /** called from genFor: don't re-emit this element's v-for / v-if */
  skipFor?: boolean;
  /** the containing element's tag, for context-sensitive emission */
  parentTag?: string;
}

function genNode(node: TemplateChildNode, ctx: Ctx, scope: Scope, depth: number, opts: GenOpts = {}): string {
  if (node.type === NodeTypes.TEXT) {
    return pad(depth) + escapeText((node as TextNode).content) + '\n';
  }
  if (node.type === NodeTypes.INTERPOLATION) {
    const expr = exprContent((node as InterpolationNode).content);
    return pad(depth) + `{{ ${inlineExpr(expr, ctx, scope)} }}\n`;
  }
  if (node.type !== NodeTypes.ELEMENT) return '';
  let el = node as ElementNode;

  const forDir = opts.skipFor ? undefined : findDir(el, 'for');
  if (forDir) {
    return genFor(el, forDir, ctx, scope, depth, opts);
  }

  // A page whose root is a scroll-view, inside the shell's scrolling body:
  // on web and Flutter the outer scroller hands off when the inner one runs
  // out, and the inner one has no bounded height to scroll in anyway — the
  // outer one does all the scrolling. Skyline chains nothing: the inner
  // scroll-view needs a fixed height, and whatever of it lies below the
  // body's viewport can never be reached. So the root becomes a plain
  // view and the shell's body is the one scroller, as on the other ends.
  //
  // type="custom" is the exception — skyline pages do not scroll on their
  // own, so a custom scroll-view downgraded to a view would take its sticky
  // children with it. It keeps the element (and the compile-time height
  // check below keeps it bounded); the webview renderer keeps the downgrade,
  // where page-level scrolling is native and sticky views pin against it.
  if (
    ctx.pageInScroll && el.tag === 'scroll-view' && ctx.alignStack.length === 0 && !opts.skipFor &&
    !(ctx.renderer === 'skyline' && isCustomScrollView(el))
  ) {
    return genNode({ ...el, tag: 'view' } as ElementNode, ctx, scope, depth, opts);
  }

  if (el.tag === 'list-view' && !ctx.vueImports.has(el.tag)) {
    const listed = genListView(el, ctx, scope, depth, opts);
    if (listed !== null) return listed;
  }

  // <defer> (specs/118) exists to keep below-the-fold content out of the
  // first frame of a JS-mounted page. Skyline builds its nodes on demand, so
  // there is no such cost to split here: it compiles to a transparent block
  // and its content renders with the rest of the page. placeholder-height
  // only sizes the pre-mount box the other two targets show, so it goes.
  const isDefer = el.tag === 'defer' && !ctx.vueImports.has('defer');
  if (isDefer) el = { ...el, props: el.props.filter((p) => !isDeferOnlyProp(p)) };
  const isBlock = el.tag === 'template' || isDefer;
  const resolved = isBlock ? { tag: 'block', custom: false } : resolveTag(el, ctx);
  if (resolved.strip) {
    // dropped wholesale (native tabBar replaces the app's custom one);
    // a stripped node inside an if/else chain would orphan the wx:else
    if (findDir(el, 'if') || findDir(el, 'else') || findDir(el, 'else-if')) {
      warn(
        `[fjs/mp] ${ctx.filename}: stripped component <${el.tag}> takes part in an if/else chain — the chain needs manual adjustment`,
      );
    }
    return '';
  }
  const tag = resolved.tag;
  const custom = resolved.custom;
  const attrs = genAttrs(el, ctx, scope, custom, tag, resolved.downcastCls, opts.parentTag);

  let ifAttr = opts.ifAttr ?? '';
  if (!ifAttr && !opts.skipFor) {
    const own = findDir(el, 'if');
    if (own) ifAttr = ifAttrOf(own.exp, ctx, scope, 'wx:if');
  }

  if (!isBlock && el.tag === 'slot') {
    const nameAttr = staticAttr(el, 'name');
    const outlet = `<slot${nameAttr ? ` name="${nameAttr}"` : ''} />`;
    return pad(depth) + outlet + '\n';
  }

  const showDir = findDir(el, 'show');
  if (showDir) {
    const expr = exprContent(showDir.exp);
    trackData(ctx, expr);
    attrs.push(`hidden="{{ !(${inlineExpr(expr, ctx, scope)}) }}"`);
  }

  // `touch-action`: this node takes the drag away from the scroll-view (or
  // swiper) it sits in, as it does on web and Flutter. See touchActionOf.
  const touchAction = custom ? null : touchActionOf(el, ctx);
  let gestureOpen = '';
  let gestureClose = '';
  if (touchAction) {
    if (touchAction === 'none') {
      // webview: a catch handler on touchmove cancels the scroll natively.
      // Not for pan-x / pan-y — it cannot tell directions and would stop
      // the scroll the node lets through.
      const i = attrs.findIndex((a) => a.startsWith('bindtouchmove='));
      if (i >= 0) attrs[i] = attrs[i].replace(/^bindtouchmove=/, 'catchtouchmove=');
      else attrs.push('catchtouchmove="__fjsNoop"');
    }
    if (ctx.renderer === 'skyline') {
      // skyline: catch does not reach the scroll-view's native gesture.
      // Nested drag handlers of the same type resolve innermost-first, so a
      // drag handler of the scroller's axis around the node wins the drag
      // and the scroll-view never recognizes it. The handlers are virtual —
      // the node stays the layout child — and wx:if moves onto the outer one.
      const handlers = [
        // pan-x lets horizontal scrolling through: the node takes vertical
        ...(touchAction !== 'pan-x' ? ['horizontal-drag-gesture-handler'] : []),
        ...(touchAction !== 'pan-y' ? ['vertical-drag-gesture-handler'] : []),
      ];
      gestureOpen = handlers.map((h, n) => `<${h}${n === 0 ? ifAttr : ''}>`).join('');
      gestureClose = handlers.map((h) => `</${h}>`).reverse().join('');
      ifAttr = '';
    }
  }
  const open = gestureOpen + `<${tag}${ifAttr}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;

  if (isBlock) {
    // a <template> is transparent: its children keep the block's own parent
    const inner = genChildren(el.children, ctx, scope, depth + 1, opts.parentTag);
    return `${pad(depth)}${open}\n${inner}${pad(depth)}</block>\n`;
  }

  // a custom component's slot content lands in ITS layout, unknown here
  ctx.alignStack.push(custom ? null : crossAlignOf(el, ctx));
  ctx.colorStack.push(custom ? null : ownColorOf(el, ctx));
  // wx pages through <swiper-item> children only; the same check the other
  // two targets run in compileTemplate (specs/051)
  const badPage = swiperChildViolations(el)[0];
  if (badPage) {
    const { line, column } = badPage.loc.start;
    throw new Error(`[fjs/mp] ${ctx.filename} at template ${line}:${column}: ${swiperChildMessage(badPage)}`);
  }
  if (tag === 'picker-view') {
    ctx.pickerRowStack.push(pickerRowHeight(el, ctx));
    ctx.pickerSyncStack.push(ctx.pendingPickerSync);
    ctx.pendingPickerSync = null;
  }
  let children = genSlotContent(el, ctx, scope, depth + 1, custom, tag);
  if (tag === 'picker-view') {
    ctx.pickerRowStack.pop();
    const sync = ctx.pickerSyncStack.pop();
    if (sync) ctx.setupCode.push(`const ${sync.name} = __fjsPickerSync(() => [${sync.deps.join(', ')}]);`);
  }
  ctx.alignStack.pop();
  ctx.colorStack.pop();
  // skyline's scroll-view type=list lays its direct children out as list
  // items — the flex properties a page puts on the scroll-view (gap,
  // align-items) never apply — and a bare slot child (a fragment) crashes
  // attachView with "appendChild expects a valid Node". One content wrapper
  // carrying the scroll-view's flex settings (copied, see layoutStyleOf)
  // fixes both. type="custom" must NOT get the wrapper: its children are
  // the sticky components, which are only valid as DIRECT children.
  if (tag === 'scroll-view' && children && !isCustomScrollView(el)) {
    if (!ctx.fjsClasses.includes('fjs-scroll-inner')) ctx.fjsClasses.push('fjs-scroll-inner');
    const layout = layoutStyleOf(el, ctx);
    children = `${pad(depth + 1)}<view class="fjs-scroll-inner"${layout ? ` style="${escapeAttr(layout)}"` : ''}>\n${children.replace(/^(?=.)/gm, INDENT)}${pad(depth + 1)}</view>\n`;
  }
  if (tag === 'button') {
    const spinner = buttonSpinner(el, ctx, scope);
    if (spinner) children = spinner + children;
  }
  if (!children) return `${pad(depth)}${open.replace(/>$/, ' />')}${gestureClose}\n`;
  // Pretty-printing whitespace is CONTENT inside <text>/<button>: the
  // indentation and newlines around a text run render as blank lines above
  // and below it (skyline and webview both keep them). An element with a
  // direct text child is emitted on one line — every generated line is a
  // whole tag or a whole text run, so trimming and joining is lossless.
  if (el.children.some((c) => c.type === NodeTypes.TEXT || c.type === NodeTypes.INTERPOLATION)) {
    const inline = children.split('\n').map((l) => l.trim()).join('');
    return `${pad(depth)}${open}${inline}</${tag}>${gestureClose}\n`;
  }
  return `${pad(depth)}${open}\n${children}${pad(depth)}</${tag}>${gestureClose}\n`;
}

/** Children of an element: default slot content verbatim; <template
 * v-slot:x> branches get slot="x" stamped onto each child element. */
function genSlotContent(el: ElementNode, ctx: Ctx, scope: Scope, depth: number, custom: boolean, parentTag?: string): string {
  if (el.children.length === 0) return '';
  const slotTemplates = el.children.filter(
    (c): c is ElementNode =>
      c.type === NodeTypes.ELEMENT && (c as ElementNode).tag === 'template' && !!findDir(c, 'slot'),
  );
  if (slotTemplates.length === 0) {
    // no named slots: ordinary children, v-if chains included
    return genChildren(el.children, ctx, scope, depth, parentTag);
  }
  void custom;
  let out = '';
  for (const child of el.children) {
    if (child.type === NodeTypes.ELEMENT && (child as ElementNode).tag === 'template' && findDir(child, 'slot')) {
      const slotDir = findDir(child, 'slot')!;
      const slotName = slotDir.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? slotDir.arg.content : '';
      if (slotDir.exp) {
        warn(
          `[fjs/mp] ${ctx.filename}: scoped slots are not supported (slot "${slotName}")`,
        );
      }
      for (const sub of (child as ElementNode).children) {
        out += withSlotAttr(sub, slotName, ctx, scope, depth);
      }
      continue;
    }
    out += genNode(child, ctx, scope, depth);
  }
  return out;
}

/** fjs `<list-view :items>` with a row slot (`#default="{ item, index }"`)
 * -> skyline `<scroll-view type="list">` over a wx:for block. Skyline builds
 * a list scroll-view's DIRECT children on demand, which is the virtualization
 * the other two ends do — so, unlike every other scroll-view, the rows get
 * no content wrapper. Returns null when the shape is not recognized. */
function genListView(el: ElementNode, ctx: Ctx, scope: Scope, depth: number, opts: GenOpts): string | null {
  const itemsDir = el.props.find(
    (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'items',
  );
  const slotTpl = el.children.find(
    (c): c is ElementNode => c.type === NodeTypes.ELEMENT && (c as ElementNode).tag === 'template' && !!findDir(c, 'slot'),
  );
  if (!itemsDir?.exp || !slotTpl) return null;
  const slotExp = exprContent(findDir(slotTpl, 'slot')!.exp).trim();
  let itemVar = 'item';
  let indexVar = scope.forStack.length ? `__i${scope.forStack.length}` : 'index';
  const destructured = /^\{([^}]*)\}$/.exec(slotExp);
  if (destructured) {
    for (const part of destructured[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const [key, alias] = part.split(':').map((x) => x.trim());
      if (key === 'item') itemVar = alias ?? key;
      else if (key === 'index') indexVar = alias ?? key;
    }
  } else if (slotExp) {
    warn(`[fjs/mp] ${ctx.filename}: list-view slot props must be destructured ({ item, index }) — got "${slotExp}"`);
    return null;
  }
  const listExpr = exprContent(itemsDir.exp).trim();
  trackData(ctx, listExpr);
  const inner: Scope = {
    forVars: new Set([...scope.forVars, itemVar, indexVar]),
    forStack: [...scope.forStack, { item: itemVar, index: indexVar, list: listExpr }],
  };

  const attrs = genAttrs(el, ctx, scope, false, 'scroll-view', undefined, opts.parentTag).filter(
    (a) => !a.startsWith('items='),
  );
  if (!attrs.some((a) => a.startsWith('scroll-y='))) attrs.push('scroll-y="{{ true }}"');
  let ifAttr = opts.ifAttr ?? '';
  if (!ifAttr) {
    const own = findDir(el, 'if');
    if (own) ifAttr = ifAttrOf(own.exp, ctx, scope, 'wx:if');
  }

  // wx:key from the row's own :key="item.prop"
  const rowEl = slotTpl.children.find((c): c is ElementNode => c.type === NodeTypes.ELEMENT);
  const keyDir = rowEl?.props.find(
    (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'key',
  );
  const keyProp = keyDir?.exp ? new RegExp(`^${itemVar}\\.(\\w+)$`).exec(exprContent(keyDir.exp).trim())?.[1] : undefined;

  ctx.alignStack.push(null);
  const rows = genChildren(slotTpl.children, ctx, inner, depth + 2, 'scroll-view');
  ctx.alignStack.pop();
  const forAttrs = [
    `wx:for="{{ ${inlineExpr(listExpr, ctx, scope)} }}"`,
    `wx:for-item="${itemVar}"`,
    `wx:for-index="${indexVar}"`,
    keyProp ? `wx:key="${keyProp}"` : '',
  ].filter(Boolean).join(' ');
  return (
    `${pad(depth)}<scroll-view${ifAttr} ${attrs.join(' ')}>\n` +
    `${pad(depth + 1)}<block ${forAttrs}>\n${rows}${pad(depth + 1)}</block>\n` +
    `${pad(depth)}</scroll-view>\n`
  );
}

function withSlotAttr(node: TemplateChildNode, slotName: string, ctx: Ctx, scope: Scope, depth: number): string {
  const rendered = genNode(node, ctx, scope, depth);
  if (!slotName || node.type !== NodeTypes.ELEMENT) return rendered;
  return rendered.replace(/^(\s*<[A-Za-z][^\s/>]*)/, `$1 slot="${slotName}"`);
}

function genFor(
  el: ElementNode,
  forDir: DirectiveNode,
  ctx: Ctx,
  scope: Scope,
  depth: number,
  opts: GenOpts = {},
): string {
  const exp = exprContent(forDir.exp).trim();
  const m = /^\(?([^()]*?)\)?\s+(?:in|of)\s+([\s\S]+)$/.exec(exp);
  if (!m) {
    warn(`[fjs/mp] ${ctx.filename}: cannot parse v-for "${exp}"`);
    return '';
  }
  const vars = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (vars.some((v) => /[^A-Za-z0-9_$]/.test(v))) {
    warn(`[fjs/mp] ${ctx.filename}: destructuring in v-for is not supported: "${exp}"`);
  }
  const itemVar = vars[0] ?? 'item';
  // nested loops need distinct index names: perItemExpr addresses its
  // per-item table by every level's index
  const indexVar = vars[1] ?? (scope.forStack.length ? `__i${scope.forStack.length}` : 'index');
  const listExpr = m[2].trim();

  const innerScope: Scope = {
    forVars: new Set([...scope.forVars, itemVar, indexVar]),
    forStack: [...scope.forStack, { item: itemVar, index: indexVar, list: listExpr }],
  };

  // v-if beside v-for: Vue 3 evaluates v-if first (it can't see the item),
  // so placing it on the block matches that semantics
  const ifDir = findDir(el, 'if');

  const keyAttr = el.props.find(
    (p): p is DirectiveNode =>
      p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'key',
  );
  let wxKey = '';
  if (keyAttr?.exp) {
    const k = exprContent(keyAttr.exp).trim();
    const prop = new RegExp(`^${itemVar}\\.(\\w+)$`).exec(k);
    if (prop) wxKey = prop[1];
    else if (k === itemVar) wxKey = '*this';
    else {
      warn(
        `[fjs/mp] ${ctx.filename}: :key="${k}" is not an item property — wx:key omitted`,
      );
    }
  }

  // a picker-view's row list: its changes re-send the picker's value
  const sync = ctx.pickerSyncStack[ctx.pickerSyncStack.length - 1];
  if (sync && sync.deps.length && scope.forStack.length === 0 && !/^\d+$/.test(listExpr)) {
    sync.deps.push(rewritten(listExpr, ctx, scope));
  }

  const inner = el.tag === 'template'
    ? genChildren(el.children, ctx, innerScope, depth + 1, opts.parentTag)
    : genNode(el, ctx, innerScope, depth + 1, { skipFor: true, parentTag: opts.parentTag }).trimEnd();

  // Vue counts `n in 3` from 1; wx:for over a number counts from 0. A
  // literal range becomes the array Vue would walk.
  const range = /^\d+$/.test(listExpr) ? Number(listExpr) : null;
  let wxList: string;
  const projected = range === null ? projectedList(listExpr, inner, itemVar, wxKey, ctx, scope) : null;
  if (range !== null && range <= 1000) {
    wxList = `[${Array.from({ length: range }, (_, i) => i + 1).join(', ')}]`;
  } else if (projected) {
    wxList = projected;
  } else if (!ctx.numericBindings?.has(listExpr)) {
    wxList = inlineExpr(listExpr, ctx, innerScope);
  } else {
    // the value may be a number only at runtime (`n in rows`): the wxs
    // helper turns a number into Vue's 1..n and passes anything else through
    ctx.usesWxs = true;
    wxList = `__fjs.list(${inlineExpr(listExpr, ctx, innerScope)})`;
  }
  const attrs = [
    `wx:for="{{ ${wxList} }}"`,
    `wx:for-item="${itemVar}"`,
    `wx:for-index="${indexVar}"`,
    wxKey ? `wx:key="${wxKey}"` : '',
    ifDir ? ifAttrOf(ifDir.exp, ctx, innerScope, 'wx:if') : opts.ifAttr ?? '',
  ].filter(Boolean);
  return `${pad(depth)}<block ${attrs.join(' ')}>\n${inner}\n${pad(depth)}</block>\n`;
}

/** A v-for list crosses the setData bridge only so wx:for can walk it, and
 * the template usually reads two or three properties off each item. The rest
 * is not just dead weight: it also counts as a CHANGE, so a page that writes
 * `dot.scale` 60 times a second re-sends all 25 dots every frame even though
 * the wxml reads nothing but `dot.id`. So the list is PROJECTED down to the
 * properties the emitted template actually reads — usually a constant array,
 * which then diffs equal and is never sent again.
 *
 * Returns null (list passes through as is) when the item is read as a whole
 * somewhere — `{{ chip }}`, `dot[key]`, an event's data-args — or the list
 * cannot be projected from setup scope (inside another v-for, or a binding
 * that may be a number at runtime). */
function projectedList(
  listExpr: string,
  inner: string,
  itemVar: string,
  wxKey: string,
  ctx: Ctx,
  scope: Scope,
): string | null {
  if (scope.forStack.length || ctx.numericBindings?.has(listExpr)) return null;
  if (wxKey === '*this') return null;
  const reads = itemReads(inner, itemVar);
  if (reads === null) return null;
  if (wxKey) reads.add(wxKey);
  const name = `__l${ctx.counters.l++}`;
  const keys = [...reads].map((k) => JSON.stringify(k)).join(', ');
  ctx.setupCode.push(
    computedSrc(name, `__fjsProject(${rewritten(listExpr, ctx, scope)}, [${keys}])`),
  );
  ctx.returnedNames.push(name);
  ctx.dataNames.push(name);
  return name;
}

/** Properties of `itemVar` the emitted wxml reads, or null when it reads the
 * item as a whole. Only `{{ }}` contents count — the item name also shows up
 * as a class name or in `wx:for-item`, which are not expressions. */
function itemReads(inner: string, itemVar: string): Set<string> | null {
  const props = new Set<string>();
  const re = new RegExp(`(?:^|[^\\w$.])${itemVar}(?:\\s*\\.\\s*([A-Za-z_$][\\w$]*))?`, 'g');
  for (const mustache of inner.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    // string bodies are text, not code: `'dot'` is not a read of `dot`
    const code = mustache[1].replace(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"/g, "''");
    for (const hit of code.matchAll(re)) {
      if (!hit[1]) return null;
      props.add(hit[1]);
    }
  }
  return props;
}

export type TouchAction = 'none' | 'pan-x' | 'pan-y';

/** The `touch-action` a node declares — through its static classes or its
 * static inline style — or null for auto. `manipulation` and friends mean
 * nothing on a mini program and stay null. */
function touchActionOf(el: ElementNode, ctx: Ctx): TouchAction | null {
  const inline = /(?:^|;)\s*touch-action\s*:\s*(none|pan-x|pan-y)\b/.exec(staticAttr(el, 'style') ?? '');
  if (inline) return inline[1] as TouchAction;
  for (const c of staticClasses(el)) {
    const action = ctx.touchActionClasses?.get(c);
    if (action) return action;
  }
  return null;
}

function staticClasses(el: ElementNode): string[] {
  return (staticAttr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
}

/** The flex layout a page gives an element through its static classes, as
 * inline CSS — for wrappers that sit between the element and its children
 * (the scroll-view content wrapper, a runtime control's root) and must lay
 * the children out the way the element itself would. Skyline does not
 * support `inherit` for these properties, so the values are copied. */
function layoutStyleOf(el: ElementNode, ctx: Ctx): string {
  return staticClasses(el)
    .map((c) => ctx.layoutClasses?.get(c))
    .filter(Boolean)
    .join('; ');
}

/** The `color` this element sets itself: its static style, else the last
 * of its static classes that declares one. */
function ownColorOf(el: ElementNode, ctx: Ctx): string | null {
  const inline = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(staticAttr(el, 'style') ?? '');
  if (inline) return inline[1].trim();
  let color: string | null = null;
  for (const c of staticClasses(el)) color = ctx.colorClasses?.get(c) ?? color;
  return color;
}

/** The text color a module widget would inherit on the web, as far as this
 * template's static classes tell: its own, else the nearest ancestor's. A
 * widget that paints outside CSS (icon-mind's SVG image) cannot inherit it
 * on skyline — computed styles are unreadable there — so the compiler hands
 * it over as `fjs-color` (possibly a `var(--x)`, resolved by the runtime). */
function inheritedColorOf(el: ElementNode, ctx: Ctx): string | null {
  const own = ownColorOf(el, ctx);
  if (own) return own;
  for (let i = ctx.colorStack.length - 1; i >= 0; i--) {
    if (ctx.colorStack[i]) return ctx.colorStack[i];
  }
  return null;
}

function crossAlignOf(el: ElementNode, ctx: Ctx): 'center' | 'end' | null {
  let align: 'center' | 'end' | null = null;
  for (const c of staticClasses(el)) align = ctx.crossAlignClasses?.get(c) ?? align;
  return align;
}

/** Skyline lays a text out on a single line when its column parent centers
 * (or end-aligns) it on the cross axis: the text is measured at max-content
 * and clamped afterwards, so a long line runs off the edges instead of
 * wrapping — max-width, even in px, does not help. Only a stretched text
 * gets the width constraint. Stretch plus the matching text-align looks the
 * same as web's centered fit-content box for any text that draws no box of
 * its own, so those texts get it; a text with a background, border, padding
 * or width keeps its real width (and the skyline limitation). */
function textFillClass(el: ElementNode, ctx: Ctx): string | null {
  const align = ctx.alignStack[ctx.alignStack.length - 1];
  if (!align) return null;
  if (staticClasses(el).some((c) => ctx.boxedClasses?.has(c))) return null;
  if (el.props.some((p) => p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'style')) return null;
  const cls = `fjs-text--${align}`;
  if (!ctx.fjsClasses.includes(cls)) ctx.fjsClasses.push(cls);
  return cls;
}

/** The wx button's own look (184px wide, bold, grey fill, centered with auto
 * margins) is not the fjs button — `.fjs-button` in APP_WXSS restates the
 * web adapter's numbers. Variants follow the static type/plain/size attrs,
 * the same classes web/components/basic.ts derives from its props. */
/** A boolean prop's condition: `true` for a bare / static true attribute,
 * the wxml expression for a binding, null when absent or static false. */
function boolPropCondition(el: ElementNode, name: string, ctx: Ctx, scope: Scope): true | string | null {
  for (const p of el.props) {
    if (p.type === NodeTypes.ATTRIBUTE && p.name === name) {
      const v = p.value?.content;
      return v === 'false' ? null : true;
    }
    if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === name) {
      const expr = exprContent(p.exp).trim();
      if (expr === 'true') return true;
      if (expr === 'false') return null;
      return inlineExpr(expr, ctx, scope);
    }
  }
  return null;
}

/** `loading` draws the web's spinner (base-css.ts .fjs-button-spinner: 14px,
 * 2px stroke in the label color, three quarters of a ring, 8px before the
 * label) instead of wx's built-in icon, which is a small dark glyph and, on
 * skyline, stacked above the label. A ring with one transparent side loses
 * its border-radius under skyline (four differing border colors), so the
 * three quarters are a full ring clipped twice: the left half and the
 * bottom-right quadrant. */
function buttonSpinner(el: ElementNode, ctx: Ctx, scope: Scope): string {
  const cond = boolPropCondition(el, 'loading', ctx, scope);
  if (!cond) return '';
  const type = staticAttr(el, 'type');
  const plain = el.props.some((p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'plain');
  const color = (type === 'primary' || type === 'warn') && !plain ? 'light' : type === 'warn' ? 'warn' : 'accent';
  if (!ctx.fjsClasses.includes('fjs-button-spinner')) ctx.fjsClasses.push('fjs-button-spinner');
  const ring = `fjs-button-spinner-ring fjs-button-spinner-ring--${color}`;
  const ifAttr = cond === true ? '' : ` wx:if="{{ ${cond} }}"`;
  return (
    `<view class="fjs-button-spinner"${ifAttr}>` +
    `<view class="fjs-button-spinner-half"><view class="${ring}" /></view>` +
    `<view class="fjs-button-spinner-corner"><view class="${ring} fjs-button-spinner-ring--corner" /></view>` +
    `</view>\n`
  );
}

function buttonClasses(el: ElementNode): string {
  const cls = ['fjs-button'];
  const type = staticAttr(el, 'type');
  cls.push(`fjs-button--${type === 'primary' || type === 'warn' ? type : 'default'}`);
  if (el.props.some((p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'plain')) cls.push('fjs-button--plain');
  if (staticAttr(el, 'size') === 'mini') cls.push('fjs-button--mini');
  return cls.join(' ');
}

function resolveTag(el: ElementNode, ctx: Ctx): { tag: string; custom: boolean; strip?: boolean; downcastCls?: string } {
  const tag = el.tag;
  if (ctx.vueImports.has(tag)) {
    const kebab = toKebab(tag);
    if (ctx.stripTags?.has(kebab)) return { tag: kebab, custom: true, strip: true };
    ctx.usingComponents.set(kebab, ctx.vueImports.get(tag)!);
    return { tag: kebab, custom: true };
  }
  if (ctx.moduleTags?.has(tag)) {
    ctx.usingComponents.set(tag, `module:${tag}`);
    return { tag, custom: true };
  }
  if (tag === 'input' && isMultiline(el)) return { tag: 'textarea', custom: false };
  // rich-text splits by renderer. Skyline's native one renders a subset
  // (inline elements on lines of their own, no list numbers, tables in one
  // line, img width / pre whitespace ignored), so there the runtime component
  // runs the shared JS pipeline (fjs-runtime/src/wx/rich-text.ts, bundled on
  // demand as fjs/rich-text.js). The webview renderer's native one is HTML
  // layout already: it is used as is and no pipeline ships — at the price of
  // browser default styles, page scoped classes not reaching inner nodes and
  // no whitelist warnings (docs/miniprogram.md 已知差异, spec 050).
  if (tag === 'rich-text' && ctx.renderer === 'skyline') {
    ctx.usingComponents.set('fjs-rich-text', 'fjs-rich-text');
    return { tag: 'fjs-rich-text', custom: true };
  }
  if (TAG_REWRITE[tag]) {
    const mapped = TAG_REWRITE[tag];
    if (RUNTIME_COMPONENT_TAGS.has(mapped)) ctx.usingComponents.set(mapped, mapped);
    return { tag: mapped, custom: RUNTIME_COMPONENT_TAGS.has(mapped) };
  }
  if (TAG_DOWNCAST[tag]) {
    const d = TAG_DOWNCAST[tag];
    if (!ctx.fjsClasses.includes(d.cls)) ctx.fjsClasses.push(d.cls);
    // the class must GO ON THE ELEMENT, not just into the stylesheet
    return { tag: d.tag, custom: false, downcastCls: d.cls };
  }
  if (ctx.renderer !== 'skyline' && STICKY_WX_COMPONENTS[tag]) {
    const mapped = STICKY_WX_COMPONENTS[tag];
    ctx.usingComponents.set(mapped, mapped);
    return { tag: mapped, custom: true };
  }
  return { tag, custom: false };
}

interface EventBinding {
  /** full attribute name — bindtap / bind:modal-closed */
  native: string;
  /** wx event type (e.type) the adapter dispatches on */
  type: string;
  /** setup binding to call */
  handler: string;
  scopeVars: string[];
}

function genAttrs(el: ElementNode, ctx: Ctx, scope: Scope, custom: boolean, mappedTag: string, downcastCls?: string, parentTag?: string): string[] {
  const attrs: string[] = [];
  const events: EventBinding[] = [];

  // type="custom" scroll-view: the sticky components demand direct children,
  // so neither the list typing nor enable-flex may be injected (skyline's
  // custom container manages its own layout).
  const customScroll = mappedTag === 'scroll-view' && isCustomScrollView(el);
  // webview sticky host: the scroller a sticky pair renders into. The class
  // lets the page-level tick measure the scroller's viewport top — a pinned
  // header sits at HOST top + offset-top, not at the viewport's own top
  // (the scroller usually sits mid-page).
  const stickyHost =
    mappedTag === 'scroll-view' && ctx.renderer !== 'skyline' &&
    el.children.some(
      (c) => c.type === NodeTypes.ELEMENT && STICKY_WX_COMPONENTS[(c as ElementNode).tag],
    );
  // class is assembled from up to four sources: the downcast builtin class
  // (safe-area -> .fjs-safe-area), the static class, the :class binding and
  // the scope id. Assembled once, at the end, in that order.
  const clsParts: string[] = [];
  if (downcastCls) clsParts.push(downcastCls);
  let dynamicClass: DirectiveNode | undefined;
  // v-motion animates a stand-in the runtime owns; what lands in the wxml is
  // its style string, merged into whatever :style / style the element has
  const motion = genMotion(el, ctx, scope);

  for (const prop of el.props) {
    if (motion?.consumed.has(prop)) continue;
    if (prop.type === NodeTypes.ATTRIBUTE) {
      const a = prop as AttributeNode;
      if (a.name === 'key' || a.name === 'class') continue; // assembled below / with v-for
      if (a.name === 'ref' && mappedTag === 'canvas') {
        // no vdom fills template refs: the runtime finds the node by this id
        // and assigns the setup ref (wx/canvas.ts)
        const refName = a.value?.content ?? '';
        if (!/^[A-Za-z_$][\w$]*$/.test(refName) || el.props.some((p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'id')) {
          warn(`[fjs/mp] ${ctx.filename}: <canvas ref="${refName}"> needs an identifier ref and no id attribute — ref ignored`);
          continue;
        }
        attrs.push(`id="fjs-cv-${refName}"`);
        ctx.canvasRefs.push({
          ref: refName,
          resize: el.props.some((p) => p.type === NodeTypes.DIRECTIVE && p.name === 'on' && dirArg(p) === 'resize'),
        });
        continue;
      }
      const name = wxAttrName(mappedTag, kebabAttr(a.name));
      if (!name) continue;
      const value = mappedTag === 'input' && a.name === 'keyboard' ? wxKeyboard(a.value?.content) : a.value?.content;
      if (value === undefined || value === null || value === '') {
        // bare attribute: native Boolean props treat "" as false, so emit an
        // explicit true (custom components get the bare name back)
        attrs.push(custom ? name : `${name}="{{ true }}"`);
      } else {
        attrs.push(`${name}="${escapeAttr(value)}"`);
      }
      continue;
    }
    if (prop.type !== NodeTypes.DIRECTIVE) continue;
    const d = prop as DirectiveNode;
    switch (d.name) {
      case 'if':
      case 'else-if':
      case 'else':
      case 'for':
      case 'slot':
      case 'show':
      case 'motion':
        continue; // handled by the chain/for/slot/genNode/genMotion logic
      case 'bind': {
        const arg = dirArg(d);
        if (!arg) {
          warn(`[fjs/mp] ${ctx.filename}: v-bind without an argument is not supported`);
          continue;
        }
        if (arg === 'key') continue;
        if (arg === 'class') {
          dynamicClass = d;
          continue;
        }
        if (arg === 'style') {
          attrs.push(genStyleBinding(el, d, ctx, scope, motion?.expr));
          continue;
        }
        const attrName = wxAttrName(mappedTag, kebabAttr(arg));
        if (!attrName) continue;
        const expr = exprContent(d.exp);
        trackData(ctx, expr);
        if (mappedTag === 'picker-view' && attrName === 'value') {
          // skyline drops the value a picker-view is created with, and again
          // whenever a column's rows change under it, but applies the same
          // indices handed over afterwards. A generated tick (pickerSync in
          // wx/vue.ts) bumps after the first render and after the value or a
          // row list changes; the wxs helper turns each bump into a fresh
          // copy of the array. Watched deps are setup-scope expressions — a
          // picker inside a v-for only gets the first-render bump.
          const name = `__fjsPv${ctx.counters.d++}`;
          const free = freeScopeIdentifiers(expr, ctx.bindings, new Set(GLOBAL_IDENTIFIERS));
          const deps = free.some((v) => scope.forVars.has(v)) ? [] : [rewritten(expr, ctx, scope)];
          ctx.pendingPickerSync = { name, deps };
          ctx.returnedNames.push(name);
          ctx.dataNames.push(name);
          ctx.usesWxs = true;
          attrs.push(`value="{{ __fjs.pickerValue(${inlineExpr(expr, ctx, scope)}, ${name}) }}"`);
          continue;
        }
        attrs.push(`${attrName}="{{ ${inlineExpr(expr, ctx, scope)} }}"`);
        continue;
      }
      case 'on': {
        const ev = dirArg(d) ?? '';
        const binding = genEvent(d, ev, ctx, scope, custom, el.tag, mappedTag);
        if (binding) events.push(binding);
        continue;
      }
      case 'model': {
        const binding = genModel(d, el, ctx, scope, attrs);
        if (binding) events.push(binding);
        continue;
      }
      case 'html':
      case 'text':
      case 'pre':
      case 'cloak':
      case 'scope':
      case 'slot-scope':
        warn(`[fjs/mp] ${ctx.filename}: v-${d.name} is not supported and was dropped`);
        continue;
      default:
        warn(`[fjs/mp] ${ctx.filename}: unsupported directive v-${d.name}`);
    }
  }

  // v-motion with no :style of its own: the stand-in's style is the binding
  // (a static style= stays in front of it, same order as genStyleBinding)
  if (motion) {
    const i = attrs.findIndex((a) => a.startsWith('style='));
    if (i < 0) attrs.push(`style="{{ ${motion.expr} }}"`);
    else if (!attrs[i].includes('{{')) {
      attrs[i] = `${attrs[i].slice(0, -1)}; {{ ${motion.expr} }}"`;
    }
  }

  // class value = chunks: literal text inlined, expressions as {{ }}
  // (never nested braces — wxml's expression scanner dies on them)
  const clsValue: Array<{ text?: string; expr?: string }> = [];
  if (CONTAINER_TAGS.has(mappedTag)) clsValue.push({ text: 'fjs-box' });
  // root element: nothing is open around it yet
  if (ctx.rootClass && ctx.alignStack.length === 0) clsValue.push({ text: ctx.rootClass });
  // press state: `.item:active` rules became `.item.fjs-pressed` (css.ts);
  // the mini program applies that class while the element is held
  if (
    !custom &&
    !attrs.some((a) => a.startsWith('hover-class=')) &&
    staticClasses(el).some((c) => ctx.activeClasses?.has(c))
  ) {
    attrs.push('hover-class="fjs-pressed"', 'hover-stay-time="60"');
  }
  if (custom && ctx.moduleTags?.has(el.tag)) {
    const color = inheritedColorOf(el, ctx);
    if (color) attrs.push(`fjs-color="${escapeAttr(color)}"`);
  }
  if (RUNTIME_HOST_CLASS[mappedTag]) {
    clsValue.push({ text: RUNTIME_HOST_CLASS[mappedTag] });
    const layout = layoutStyleOf(el, ctx);
    if (layout) attrs.push(`layout="${escapeAttr(layout)}"`);
  }
  if (mappedTag === 'button') {
    clsValue.push({ text: buttonClasses(el) });
    // state classes: the built-in disabled / loading looks (grey fill, a
    // green primary) outrank the variant colors, see APP_WXSS
    for (const state of ['disabled', 'loading'] as const) {
      const cond = boolPropCondition(el, state, ctx, scope);
      if (cond === true) clsValue.push({ text: `fjs-button--${state}` });
      else if (cond) clsValue.push({ expr: `(${cond}) ? 'fjs-button--${state}' : ''` });
    }
  }
  if (mappedTag === 'input' || mappedTag === 'textarea') clsValue.push({ text: 'fjs-input' });
  if (mappedTag === 'slider') clsValue.push({ text: 'fjs-slider' });
  // both renderers: a block box like the view the other ends render
  if (mappedTag === 'rich-text') clsValue.push({ text: 'fjs-rich-text-host' });
  if (mappedTag === 'fjs-rich-text') {
    clsValue.push({ text: 'fjs-rich-text-host' });
    // inner nodes are drawn by the component; the page's scoped class rides
    // along so `<style scoped>` rules still match them
    if (ctx.scopeId) attrs.push(`scope="${escapeAttr(ctx.scopeId)}"`);
  }
  // picker-view: the native one has no height of its own and takes its row
  // height from the rows' laid-out size, so the fjs defaults (five 44px rows,
  // base-css.ts / widgets/picker_view.dart) land on the wheel and on each
  // row. Skyline matches class selectors only (no `picker-view-column > *`),
  // hence a class on every direct child instead of a descendant rule.
  if (mappedTag === 'picker-view') {
    clsValue.push({ text: 'fjs-picker-view' });
    const row = pickerRowHeight(el, ctx);
    if (!attrs.some((a) => a.startsWith('indicator-style='))) {
      attrs.push(`indicator-style="height: ${row}px"`);
    }
    if (row !== PICKER_ROW_HEIGHT) prependStyle(attrs, `height: ${row * PICKER_VISIBLE_ROWS}px`);
  }
  if (parentTag === 'picker-view-column' && !custom) {
    clsValue.push({ text: 'fjs-picker-item' });
    const row = ctx.pickerRowStack[ctx.pickerRowStack.length - 1] ?? PICKER_ROW_HEIGHT;
    if (row !== PICKER_ROW_HEIGHT) prependStyle(attrs, `height: ${row}px`);
  }
  // a swiper page fills the item (base-css.ts `swiper-item > *`)
  if (parentTag === 'swiper-item' && !custom) clsValue.push({ text: 'fjs-fill' });
  // a text inside a text is a span of the same paragraph — no block baseline
  if (mappedTag === 'text' && parentTag !== 'text') {
    clsValue.push({ text: 'fjs-text' });
    const fill = textFillClass(el, ctx);
    if (fill) clsValue.push({ text: fill });
  }
  if (downcastCls) clsValue.push({ text: downcastCls });
  if (stickyHost) clsValue.push({ text: 'fjs-sticky-host' });
  const staticCls = staticAttr(el, 'class');
  if (staticCls) clsValue.push({ text: staticCls });
  if (dynamicClass) clsValue.push(...classValueChunks(el, dynamicClass, ctx, scope));
  // @media-conditioned rules match through a class the runtime switches
  const mq = [...new Set(staticClasses(el).flatMap((c) => ctx.mediaClasses?.get(c) ?? []))];
  for (const n of mq) clsValue.push({ expr: `__fjsMq[${n}]` });
  if (ctx.scopeId) clsValue.push({ text: ctx.scopeId });
  if (clsValue.length) {
    const value = clsValue
      .map((c) => (c.text !== undefined ? escapeAttr(c.text) : `{{ ${c.expr} }}`))
      .join(' ');
    attrs.unshift(`class="${value}"`);
  }

  // event funnel: every binding lands on the runtime's __fjsCall, which
  // reads data-fn (handler) and dispatches the payload by e.type. A
  // multi-event element shares ONE dataset — data-fn would collapse to the
  // last handler — so its handlers go behind a type dispatcher instead.
  if (events.length === 1) {
    const e = events[0];
    attrs.push(`${e.native}="__fjsCall"`, `data-fn="${e.handler}"`);
    if (e.scopeVars.length) attrs.push(`data-args="{{ [${e.scopeVars.join(', ')}] }}"`);
  } else if (events.length > 1) {
    const dispatcher = `__ev${ctx.counters.ev++}`;
    const branches = events
      .map((e) => `if (__t === ${JSON.stringify(e.type)}) ${e.handler}(__e, ...__s);`)
      .join(' else ');
    // the runtime hands handlers the ADAPTED payload, which has no type —
    // a dispatcher is flagged so __fjsCall passes the wx event type first
    ctx.setupCode.push(
      `const ${dispatcher} = (__t, __e, ...__s) => { ${branches} }; ${dispatcher}.__fjsByType = true;`,
    );
    ctx.returnedNames.push(dispatcher);
    for (const e of events) attrs.push(`${e.native}="__fjsCall"`);
    attrs.push(`data-fn="${dispatcher}"`);
    const scopeVars = [...new Set(events.flatMap((e) => e.scopeVars))];
    if (scopeVars.length) attrs.push(`data-args="{{ [${scopeVars.join(', ')}] }}"`);
  }
  if (events.length) attrs.push(`data-tag="${sourceTagOf(el, mappedTag)}"`);
  // the web pins placeholder grey (base-css.ts .fjs-input::placeholder);
  // wx's default is darker. placeholder-style, when given, still wins.
  if ((mappedTag === 'input' || mappedTag === 'textarea') && !attrs.some((a) => a.startsWith('placeholder-class='))) {
    attrs.push('placeholder-class="fjs-placeholder"');
  }
  // press feedback: base-css.ts gives every button WeUI's 10% black mask
  // while held (.fjs-button:active::after); wx's own button-hover is lost
  // under the fjs colors, so the mask rides on hover-class instead
  if (mappedTag === 'button' && !attrs.some((a) => a.startsWith('hover-class='))) {
    attrs.push('hover-class="fjs-button--pressed"');
  }
  // slider: the web's accent (base-css.ts .fjs-slider accent-color) instead
  // of wx's green and large white knob; a page's own attrs still win
  if (mappedTag === 'switch' && !attrs.some((a) => a.startsWith('color='))) attrs.push('color="#34c759"');
  if (mappedTag === 'slider') {
    for (const [k, v] of [['active-color', '#007aff'], ['block-color', '#007aff'], ['block-size', '16']]) {
      if (!attrs.some((a) => a.startsWith(k + '='))) attrs.push(`${k}="${v}"`);
    }
  }
  // fjs input has no length limit by default; wx input stops at 140
  if (mappedTag === 'input' && !attrs.some((a) => a.startsWith('maxlength='))) attrs.push('maxlength="-1"');
  // a wx canvas node is fixed to one context family by its type: a page
  // that brings in @ufjs/webgl gets webgl canvases (an explicit type wins)
  if (mappedTag === 'canvas' && ctx.canvasType && !attrs.some((a) => a.startsWith('type='))) {
    attrs.push(`type="${ctx.canvasType}"`);
  }
  for (const [k, v] of Object.entries(customScroll ? {} : INJECTED_ATTRS[mappedTag] ?? {})) {
    if (!attrs.some((a) => a.startsWith(k + '='))) attrs.push(`${k}="${v}"`);
  }
  // webview sticky host (specs/053): the fjs-sticky-header components
  // re-measure on every scroll frame of the scroller that hosts them — an
  // IntersectionObserver cannot see the pin moment of a fully visible
  // header (its intersection ratio never changes). Skyline needs nothing:
  // its native sticky-header reports the state itself.
  if (stickyHost) {
    attrs.push('bindscroll="__fjsStickyTick"');
  }
  // WebView scroll-view does not scroll without an explicit direction
  // (skyline recommends it too); horizontal scrollers opt out via scroll-x.
  // fjs spells horizontal as `direction: horizontal` (a class or the style
  // attribute) or a direction="horizontal" attribute, as on the web.
  if (mappedTag === 'scroll-view' && !attrs.some((a) => a.startsWith('scroll-y=')) && !attrs.some((a) => a.startsWith('scroll-x='))) {
    const horizontal =
      staticAttr(el, 'direction') === 'horizontal' ||
      /(^|;)\s*direction\s*:\s*horizontal/.test(staticAttr(el, 'style') ?? '') ||
      staticClasses(el).some((c) => ctx.horizontalClasses?.has(c));
    attrs.push(horizontal ? 'scroll-x="{{ true }}"' : 'scroll-y="{{ true }}"');
  }
  // skyline renders a scroll-view with no definite height as NOTHING (webview
  // flex-grow chains hide the difference). Enforced at compile time so the
  // failure is loud: explicit height must be visible in style/:style, or in
  // one of the element's classes (this SFC's rules).
  if (mappedTag === 'scroll-view' && scrollviewHeightMissing(el, ctx)) {
    const at = el.loc ? ` at template ${el.loc.start.line}:${el.loc.start.column}` : '';
    throw new Error(
      `[fjs/mp] ${ctx.filename}${at}: <scroll-view> has no explicit height — ` +
        'skyline renders it with zero height. Add one, e.g. ' +
        'style="height: 100vh", .cls { height: 100vh }, or height: 0px + flex-grow.',
    );
  }
  return attrs;
}

/** True when no height is statically visible on this scroll-view. */
function scrollviewHeightMissing(el: ElementNode, ctx: Ctx): boolean {
  const style = staticAttr(el, 'style') ?? '';
  if (/(^|;)\s*height\s*:/.test(style)) return false;
  const styleDir = el.props.find(
    (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'style',
  );
  if (styleDir?.exp && /(^|;|\{)\s*height\s*:/.test(exprContent(styleDir.exp))) return false;
  const classes = (staticAttr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
  for (const c of classes) {
    if (ctx.heightClasses?.has(c)) return false;
  }
  return true;
}

/** :class value chunks: literal text inlined into the attribute, expression
 * segments emitted as separate {{ }} — object/array literals expand INLINE
 * so the entry values keep their wxml scope (v-for item/index), which an
 * instance-level computed could never see. Other shapes fall back to a
 * computed (which then cannot reference for-scope vars — warned below). */
type ClassChunk = { text?: string; expr?: string };

function classValueChunks(el: ElementNode, d: DirectiveNode, ctx: Ctx, scope: Scope): ClassChunk[] {
  const expr = flattenExpr(exprContent(d.exp).trim());
  if (expr.startsWith('{')) {
    return [{ expr: inlineClassObject(expr, ctx, scope) }];
  }
  if (expr.startsWith('[')) {
    const chunks: ClassChunk[] = [];
    let ok = true;
    for (const part of splitTopLevel(expr.slice(1, -1))) {
      const e = part.trim();
      if (/^['"]/.test(e)) chunks.push({ text: e.slice(1, -1) });
      else if (e.startsWith('{')) chunks.push({ expr: inlineClassObject(e, ctx, scope) });
      else {
        trackData(ctx, e);
        chunks.push({ expr: e });
      }
    }
    if (ok && chunks.length) return chunks;
  } else if (expr.startsWith('`')) {
    return [{ expr: templateLiteralToConcat(expr) }];
  }
  // computed fallback; inside v-for a per-item table keeps the loop vars
  const free = freeScopeIdentifiers(expr, ctx.bindings, new Set(GLOBAL_IDENTIFIERS));
  if (free.some((v) => scope.forVars.has(v))) {
    return [{ expr: perItemExpr(expr, ctx, scope, (b) => `__fjsStringifyClass(${b})`) }];
  }
  const name = `__cls${ctx.counters.cls++}`;
  ctx.setupCode.push(computedSrc(name, `__fjsStringifyClass(${rewritten(expr, ctx, scope)})`));
  ctx.returnedNames.push(name);
  // generated computeds are template data too: __fjsData narrows setData
  // to dataNames, and a computed left out never reaches the wxml
  ctx.dataNames.push(name);
  // no trackData for the source expression: it is read HERE, in setup, by the
  // computed above — only what the wxml itself names has to cross setData
  return [{ expr: name }];
}

/** Object-literal :class entries expanded to a concatenation of conditional
 * class names (values keep their wxml scope). */
function inlineClassObject(expr: string, ctx: Ctx, scope: Scope): string {
  const parts = splitTopLevel(expr.slice(1, -1));
  const out = parts
    .map((part) => {
      const i = findKeyColon(part);
      // `{ focused }` — shorthand property: the class name is the binding
      const shorthand = i < 0 && /^[A-Za-z_$][\w$]*$/.test(part.trim());
      if (i < 0 && !shorthand) return null;
      const key = shorthand ? part.trim() : part.slice(0, i).trim().replace(/^['"]|['"]$/g, '');
      const value = shorthand ? part.trim() : part.slice(i + 1).trim();
      if (!key || !value) return null;
      trackData(ctx, value);
      return `(${value} ? '${key} ' : '')`;
    })
    .filter((v): v is string => v !== null);
  if (out.length !== parts.length) {
    warn(`[fjs/mp] ${ctx.filename}: unsupported :class object entries — dropped: "${expr}"`);
  }
  return out.join(' + ') || "''";
}

/** Variant bindings the mini program can run: pure style targets driven by
 * the frame loop. `leave` needs a vdom unmount hook, which this host has no
 * equivalent for. */
const MOTION_KEYS = new Set(['initial', 'enter', 'variants', 'delay', 'duration']);
/** Variants that need DOM event listeners or an IntersectionObserver. */
const MOTION_DOM_KEYS = new Set([
  'hovered', 'tapped', 'focused', 'visible', 'visible-once', 'visibleOnce', 'leave',
]);

interface MotionBinding {
  /** wxml expression for the stand-in's style (`__m0`, or `__m0[i]`). */
  expr: string;
  /** props genAttrs must not emit — the directive and its variant bindings. */
  consumed: Set<unknown>;
}

/** `v-motion` on the mini program. There is no element for motion to write
 * to, so the runtime gives it a DOM-shaped stand-in and the element binds the
 * stand-in's style (wx/motion.ts). The variant objects are evaluated in the
 * SETUP scope — inside a v-for that is the per-item factory's parameters, so
 * an expression reading the loop item keeps working. */
function genMotion(el: ElementNode, ctx: Ctx, scope: Scope): MotionBinding | null {
  const dir = el.props.find(
    (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === 'motion',
  );
  if (!dir) return null;
  const consumed = new Set<unknown>([dir]);
  const entries: string[] = [];
  let spread = '';
  let refExpr: string | null = null;
  for (const p of el.props) {
    if (p.type !== NodeTypes.DIRECTIVE) continue;
    const d = p as DirectiveNode;
    if (d.name !== 'bind') continue;
    const arg = dirArg(d) ?? '';
    if (arg === 'ref') {
      refExpr = flattenExpr(exprContent(d.exp).trim());
      consumed.add(p);
      continue;
    }
    if (MOTION_DOM_KEYS.has(arg)) {
      warn(
        `[fjs/mp] ${ctx.filename}: v-motion :${arg} needs DOM events or an ` +
          `IntersectionObserver — dropped`,
      );
      consumed.add(p);
      continue;
    }
    if (!MOTION_KEYS.has(arg)) continue;
    consumed.add(p);
    const src = rewritten(flattenExpr(exprContent(d.exp).trim()), ctx, scope);
    if (arg === 'variants') spread = `...(${src})`;
    else entries.push(`${arg}: ${src}`);
  }
  if (!spread && !entries.length) {
    warn(`[fjs/mp] ${ctx.filename}: v-motion with no variants — dropped`);
    return null;
  }
  if (scope.forStack.length > 1) {
    warn(`[fjs/mp] ${ctx.filename}: v-motion inside nested v-for is not supported — dropped`);
    return null;
  }
  const variants = `{ ${[spread, ...entries].filter(Boolean).join(', ')} }`;
  const name = `__m${ctx.counters.m++}`;
  ctx.usesMotion = true;
  ctx.returnedNames.push(name);
  ctx.dataNames.push(name);
  if (scope.forStack.length === 0) {
    const attach = refExpr ? `, (__el) => { (${rewritten(refExpr, ctx, scope)})(__el); }` : '';
    ctx.setupCode.push(
      `const ${name} = __fjsMotion(__fjsUseMotion, () => (${variants})${attach});`,
    );
    return { expr: name, consumed };
  }
  const f = scope.forStack[0];
  const list = rewriteExpr(f.list, { bindings: ctx.bindings, skip: new Set() });
  const params = `${f.item}, ${f.index}`;
  const attach = refExpr
    ? `(__el, ${params}) => { (${rewritten(refExpr, ctx, scope)})(__el); }`
    : 'undefined';
  // :key on the v-motion element itself: a changed key remounts on the other
  // hosts, which is how a page replays an entrance — the runtime rebuilds the
  // instance instead (the key is NOT consumed, wx:key still reads it)
  const keyDir = el.props.find(
    (p): p is DirectiveNode =>
      p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'key',
  );
  const keyFn = keyDir
    ? `, (${params}) => (${rewritten(flattenExpr(exprContent(keyDir.exp).trim()), ctx, scope)})`
    : '';
  const tail = keyFn ? `, ${attach}${keyFn}` : refExpr ? `, ${attach}` : '';
  ctx.setupCode.push(
    `const ${name} = __fjsMotionEach(__fjsUseMotion, () => ${list}, ` +
      `(${params}) => (${variants})${tail});`,
  );
  // the list is read here, in setup, by the helper above — not by the wxml
  return { expr: `${name}[${f.index}]`, consumed };
}

function genStyleBinding(
  el: ElementNode,
  d: DirectiveNode,
  ctx: Ctx,
  scope: Scope,
  motionExpr?: string,
): string {
  const expr = flattenExpr(exprContent(d.exp).trim());
  const inline = inlineStyleExpr(expr, ctx, scope);
  const staticSty = staticAttr(el, 'style');
  // motion writes last: a tweened transform must win over the resting one
  const value = motionExpr ? `(${inline}) + ';' + ${motionExpr}` : inline;
  return `style="${staticSty ? escapeAttr(staticSty) + '; ' : ''}{{ ${value} }}"`;
}

function inlineStyleExpr(expr: string, ctx: Ctx, scope: Scope): string {
  // spreads and calls cannot be evaluated by wxml: the whole object goes
  // through stringifyStyle (a computed, or a per-item table inside v-for)
  const inlineable = expr.startsWith('{') && !expr.includes('...') && !hasCall(expr);
  if (inlineable) {
    const parts = splitTopLevel(expr.slice(1, -1));
    const out = parts
      .map((part) => {
        const i = findKeyColon(part);
        if (i < 0) return null;
        const key = toKebab(part.slice(0, i).trim().replace(/^['"]|['"]$/g, ''));
        const value = part.slice(i + 1).trim();
        if (!key || !value) return null;
        trackData(ctx, value);
        // a quoted literal inlines as is; anything else may be a number at
        // runtime, which fjs reads as px (stringifyStyle) — the wxs helper
        // applies the same rule inside the template
        if (/^(['"]).*\1$/.test(value)) return `'${key}:' + ${value} + ';'`;
        ctx.usesWxs = true;
        return `'${key}:' + __fjs.unit(${inlineExpr(value, ctx, scope)}, '${key}') + ';'`;
      })
      .filter((v): v is string => v !== null);
    if (out.length !== parts.length) {
      warn(`[fjs/mp] ${ctx.filename}: unsupported :style object entries — dropped: "${expr}"`);
    }
    if (out.length) return out.join(' + ');
  } else if (expr.startsWith('`')) {
    return templateLiteralToConcat(expr);
  }
  const free = freeScopeIdentifiers(expr, ctx.bindings, new Set(GLOBAL_IDENTIFIERS));
  if (free.some((v) => scope.forVars.has(v))) {
    return perItemExpr(expr, ctx, scope, (b) => `__fjsStringifyStyle(${b})`);
  }
  const name = `__sty${ctx.counters.sty++}`;
  ctx.setupCode.push(computedSrc(name, `__fjsStringifyStyle(${rewritten(expr, ctx, scope)})`));
  ctx.returnedNames.push(name);
  // generated computeds are template data too: __fjsData narrows setData
  // to dataNames, and a computed left out never reaches the wxml
  ctx.dataNames.push(name);
  // no trackData for the source expression: it is read HERE, in setup, by the
  // computed above — only what the wxml itself names has to cross setData
  return name;
}

/** Compiles an inline handler into a generated function. The generated
 * signature is `(__e, ...__s)`: __e is the adapted fjs payload, __s the
 * data-args (v-for scope vars). User arrow params receive the payload
 * first, matching fjs's "@change gives you the value" semantics. */
function genInlineHandler(
  handler: string,
  ctx: Ctx,
  scope: Scope,
  name: string,
): { code: string; scopeVars: string[] } {
  const arrow = /^\s*(\(([^)]*)\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/.exec(handler);
  if (arrow) {
    const headEnd = arrow[0].length;
    const rawParams = arrow[2] !== undefined ? arrow[2] : arrow[1].replace(/\s*=>\s*$/, '');
    const userParams = rawParams.split(',').map((s) => s.trim()).filter(Boolean);
    const userNames = userParams
      .map((p) => /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(p)?.[0] ?? '')
      .filter(Boolean);
    const body = handler.slice(headEnd).trim();
    // NOTE: scope.forVars are deliberately NOT in this skip set — a free
    // for-var inside a generated closure must ride through data-args
    // (closures can't see wxml scope)
    const skip = new Set([...userNames, '__e', '__s']);
    const free = freeScopeIdentifiers(body, ctx.bindings, skip);
    const rewritten = rewriteExpr(body.replace(/\$event/g, '__e'), {
      bindings: ctx.bindings,
      skip: new Set([...scope.forVars, ...userNames, ...free, '__e', '__s']),
    });
    if (userParams.length === 0 && free.length === 0) {
      return { code: `const ${name} = (__e) => ${rewritten};`, scopeVars: [] };
    }
    const { args, bind } = scopeBinding(free, ctx, scope);
    return {
      code: `const ${name} = (__e, ...__s) => { ${bind}return ((${userParams.join(', ')}) => ${rewritten})(${userParams.length ? '__e' : ''}); };`,
      scopeVars: args,
    };
  }
  // statement(s): bind scope vars via destructured data-args
  const skip = new Set(['__e', '__s']);
  const free = freeScopeIdentifiers(handler, ctx.bindings, skip);
  const rewritten = rewriteExpr(handler.replace(/\$event/g, '__e'), {
    bindings: ctx.bindings,
    skip: new Set([...scope.forVars, ...free, '__e', '__s']),
  });
  const { args, bind } = scopeBinding(free, ctx, scope);
  return { code: `const ${name} = (__e, ...__s) => { ${bind}${rewritten}; };`, scopeVars: args };
}

/** How a handler gets at the template scope it closes over. data-args is
 * serialized: a v-for item arriving through it is a COPY of the setData
 * snapshot, so `block.x = …` in a handler would change nothing (on the other
 * two ends it is the reactive object itself). Inside v-for the template
 * therefore passes the loop INDEXES — every level, outermost first — and the
 * handler looks the items up again in the reactive lists. Other free scope
 * names (none today: scoped slots are unsupported) ride by value after them.
 * Every handler on one element gets the same index list, so a multi-event
 * dispatcher's shared data-args lines up for all of them. */
function scopeBinding(free: string[], ctx: Ctx, scope: Scope): { args: string[]; bind: string } {
  const others = free.filter((v) => !scope.forVars.has(v));
  if (!scope.forStack.length) {
    return { args: free, bind: free.length ? `const [${free.join(', ')}] = __s; ` : '' };
  }
  const indexes = scope.forStack.map((f) => f.index);
  let bind = `const [${[...indexes, ...others].join(', ')}] = __s; `;
  const outer = new Set<string>();
  for (const f of scope.forStack) {
    const list = rewriteExpr(f.list, { bindings: ctx.bindings, skip: new Set(outer) });
    bind += `const ${f.item} = typeof (${list}) === 'number' ? ${f.index} + 1 : (${list})[${f.index}]; `;
    outer.add(f.item).add(f.index);
  }
  return { args: [...indexes, ...others], bind };
}

function genEvent(
  d: DirectiveNode,
  event: string,
  ctx: Ctx,
  scope: Scope,
  custom: boolean,
  sourceTag: string,
  mappedTag: string,
): EventBinding | null {
  if (!d.exp) {
    warn(`[fjs/mp] ${ctx.filename}: @${event} without a handler was dropped`);
    return null;
  }
  const handler = exprContent(d.exp).trim();
  const isCustom = custom || mappedTag === 'fjs-modal';
  const nativeName = isCustom
    ? event
    : TAG_EVENT_ALIAS[sourceTag]?.[event] ??
      NATIVE_EVENT_ALIAS[event] ??
      event.toLowerCase().replace(/-/g, '');
  const native = isCustom ? 'bind:' + nativeName : 'bind' + nativeName;

  // plain identifier: reference the setup function directly by name
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(handler)) {
    if (!(handler in ctx.bindings)) {
      warn(`[fjs/mp] ${ctx.filename}: handler "${handler}" is not a setup binding`);
    }
    return { native, type: nativeName, handler, scopeVars: [] };
  }

  // inline expression -> generated handler (see genInlineHandler)
  const name = `__ev${ctx.counters.ev++}`;
  const { code, scopeVars } = genInlineHandler(handler, ctx, scope, name);
  ctx.setupCode.push(code);
  ctx.returnedNames.push(name);
  return { native, type: nativeName, handler: name, scopeVars };
}

function genModel(d: DirectiveNode, el: ElementNode, ctx: Ctx, scope: Scope, attrs: string[]): EventBinding | null {
  const expr = exprContent(d.exp);
  const tag = el.tag;
  if (tag !== 'input' && tag !== 'textarea') {
    warn(
      `[fjs/mp] ${ctx.filename}: v-model on <${tag}> is not supported — use :value + @change`,
    );
    return null;
  }
  const name = `__ev${ctx.counters.ev++}`;
  ctx.setupCode.push(
    `const ${name} = (__e) => { ${rewriteExpr(expr, { bindings: ctx.bindings, skip: scope.forVars })} = __e; };`,
  );
  ctx.returnedNames.push(name);
  trackData(ctx, expr);
  attrs.push(`value="{{ ${inlineExpr(expr, ctx, scope)} }}"`);
  return { native: 'bindinput', type: 'input', handler: name, scopeVars: [] };
}

// ---- small helpers ----------------------------------------------------------

/** The tag the runtime event adapter keys on: the MAPPED tag (inner-canvas
 * adapts as canvas), not the fjs spelling. */
/** fjs attribute -> wx attribute on native tags; null drops it. */
const PICKER_ROW_HEIGHT = 44;
const PICKER_VISIBLE_ROWS = 5;

/** A picker-view's `item-height`: a static attribute or a numeric literal
 * binding. Anything else cannot size the rows at compile time — warned, and
 * the default is used. */
function pickerRowHeight(el: ElementNode, ctx: Ctx): number {
  for (const p of el.props) {
    let raw: string | undefined;
    if (p.type === NodeTypes.ATTRIBUTE && p.name === 'item-height') raw = p.value?.content;
    else if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && dirArg(p) === 'item-height') {
      raw = exprContent(p.exp).trim();
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        warn(`[fjs/mp] ${ctx.filename}: picker-view :item-height="${raw}" is not a number literal — rows use ${PICKER_ROW_HEIGHT}px`);
        return PICKER_ROW_HEIGHT;
      }
    } else continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return PICKER_ROW_HEIGHT;
}

/** Puts declarations in front of the element's own style (static or bound),
 * so the page's style still wins. */
function prependStyle(attrs: string[], css: string): void {
  const i = attrs.findIndex((a) => a.startsWith('style="'));
  if (i < 0) attrs.push(`style="${css}"`);
  else attrs[i] = `style="${css}; ${attrs[i].slice('style="'.length)}`;
}

function wxAttrName(tag: string, name: string): string | null {
  // item-height is folded into row / wheel sizes (pickerRowHeight)
  if (tag === 'picker-view' && name === 'item-height') return null;
  // drawn by the compiler (buttonSpinner) + a state class, not wx's icon
  if (tag === 'button' && name === 'loading') return null;
  // fjs switch state is `value`; wx's is `checked`
  if (tag === 'switch' && name === 'value') return 'checked';
  if (tag === 'input' || tag === 'textarea') {
    if (name === 'secure') return tag === 'input' ? 'password' : null;
    if (name === 'multiline') return null; // expressed by the tag itself
    if (name === 'keyboard') return tag === 'input' ? 'type' : null;
  }
  return name;
}

/** fjs keyboard names -> wx input types (docs/ui-api.md `input`). */
function wxKeyboard(value: string | undefined): string | undefined {
  const map: Record<string, string> = { decimal: 'digit', tel: 'number', email: 'text' };
  return value ? map[value] ?? value : value;
}

/** `<input multiline>` / `:multiline="true"` is a wx textarea. A bound
 * non-literal expression cannot switch tags at runtime — it stays an input. */
function isMultiline(el: ElementNode): boolean {
  return el.props.some(
    (p) =>
      (p.type === NodeTypes.ATTRIBUTE && p.name === 'multiline' && p.value?.content !== 'false') ||
      (p.type === NodeTypes.DIRECTIVE &&
        p.name === 'bind' &&
        dirArg(p) === 'multiline' &&
        exprContent(p.exp).trim() === 'true'),
  );
}

function sourceTagOf(el: ElementNode, mappedTag: string): string {
  return mappedTag;
}


/** Splits on commas that sit at brace/bracket/paren depth zero and outside
 * string literals. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
    } else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  if (text.slice(start).trim()) out.push(text.slice(start));
  return out;
}

/** Index of the `key:` colon at depth zero of an object entry, or -1. */
function findKeyColon(part: string): number {
  let depth = 0;
  let i = 0;
  while (i < part.length) {
    const ch = part[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < part.length && part[i] !== quote) {
        if (part[i] === '\\') i++;
        i++;
      }
    } else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ':' && depth === 0) return i;
    i++;
  }
  return -1;
}

/** A wxml attribute value is one line, and the wxml expression parser has no
 * trailing commas — so a multi-line object/array literal that is perfectly
 * valid in a Vue template (`:variants="{\n  a: { … },\n}"`) has to be
 * flattened before it lands in an attribute. Whitespace inside string and
 * template literals is content, so it is copied through untouched. */
export function flattenExpr(expr: string): string {
  if (!/[\n\r\t]|,\s*[}\])]/.test(expr)) return expr;
  let out = '';
  let quote = '';
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      out += ch;
      if (ch === '\\') out += expr[++i] ?? '';
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (out && !out.endsWith(' ')) out += ' ';
      continue;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      // the space the comma sat before is the literal's own spacing
      out = out.replace(/,(\s*)$/, (_m, ws: string) => (ws ? ' ' : ''));
    }
    out += ch;
  }
  return out.trim();
}

/** Converts every template literal in an expression to string
 * concatenation — wxml {{}} has no backticks. Handles nesting
 * (`` `a${ `b` }c` ``) and escapes. */
export function convertTemplateLiterals(expr: string): string {
  if (!expr.includes('`')) return expr;
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== ch) {
        if (expr[j] === '\\') j++;
        j++;
      }
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      const [inner, next] = scanTemplateLiteral(expr, i);
      out += '(' + templateParts(inner) + ')';
      i = next;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Content between the backticks at `start`, with ${} interpolations kept
 * (nested backticks inside them stay verbatim — templateParts recurses). */
function scanTemplateLiteral(code: string, start: number): [string, number] {
  let i = start + 1;
  let inner = '';
  let depth = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') {
      inner += ch + (code[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (depth === 0 && ch === '`') return [inner, i + 1];
    if (ch === '$' && code[i + 1] === '{') {
      depth++;
      inner += '${';
      i += 2;
      continue;
    }
    if (depth > 0 && ch === '}') depth--;
    inner += ch;
    i++;
  }
  return [inner, i];
}

/** `` a${b}c `` -> `'a' + (b) + 'c'`. Literal chunks re-quote as single
 * strings; interpolation expressions recurse through
 * convertTemplateLiterals for nested backticks. */
function templateParts(inner: string): string {
  const parts: string[] = [];
  let lit = '';
  let i = 0;
  const flush = () => {
    if (lit) {
      const escaped = lit.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      parts.push(`'${escaped}'`);
    }
    lit = '';
  };
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '$' && inner[i + 1] === '{') {
      flush();
      let depth = 1;
      let j = i + 2;
      let expr = '';
      while (j < inner.length && depth > 0) {
        if (inner[j] === '{') depth++;
        else if (inner[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
        expr += inner[j];
        j++;
      }
      parts.push('(' + convertTemplateLiterals(expr.trim()) + ')');
      i = j + 1;
      continue;
    }
    lit += ch;
    i++;
  }
  flush();
  return parts.join(' + ') || "''";
}

/** Whole-expression form (`` `...` ``) kept for the :class/:style branches. */
function templateLiteralToConcat(expr: string): string {
  return convertTemplateLiterals(expr);
}

/** Inline expression for {{}}/attrs: extract anything containing a call into
 * a computed (wxml cannot call functions), otherwise pass through verbatim. */
function inlineExpr(expr: string, ctx: Ctx, scope: Scope): string {
  const trimmed = flattenExpr(convertTemplateLiterals(expr.trim()));
  // v-for scope vars must stay in wxml (an instance-level computed cannot
  // see them); concatenation without backticks is wxml-safe verbatim
  const forScoped = freeScopeIdentifiers(trimmed, ctx.bindings, new Set(GLOBAL_IDENTIFIERS)).some(
    (v) => scope.forVars.has(v),
  );
  if (!forScoped && /\(/.test(trimmed) && !/^['"]/.test(trimmed)) {
    const name = `__d${ctx.counters.d++}`;
    ctx.setupCode.push(computedSrc(name, rewritten(trimmed, ctx, scope)));
    ctx.returnedNames.push(name);
    // generated computeds are template data too: __fjsData narrows setData
    // to dataNames, and a computed left out never reaches the wxml
    ctx.dataNames.push(name);
    // no trackData for the source expression: it is read HERE, in setup, by the
    // computed above — only what the wxml itself names has to cross setData
    return name;
  }
  if (forScoped && hasCall(trimmed)) return perItemExpr(trimmed, ctx, scope);
  trackData(ctx, trimmed);
  return trimmed;
}

/** A call on a string-free expression: `f(`, `a.b(`, `x[0](`, `g()(`. */
function hasCall(expr: string): boolean {
  // template-literal text is not code: keep only its ${ } expressions
  const noTemplates = expr.replace(/`(?:\\.|\$\{[^}]*\}|[^`])*`/g, (t) =>
    [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => `(${m[1]})`).join(' + ') || "''",
  );
  const noStrings = noTemplates.replace(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"/g, "''");
  return /[\w$\])]\s*\(/.test(noStrings);
}

/** WXML cannot call functions, and an instance computed cannot see v-for
 * scope — so an item-dependent call (`picked.includes(item.id)`) becomes a
 * computed TABLE with one value per item, mapped over the same lists the
 * template walks, and the template reads `__dN[index]` (one subscript per
 * loop level). */
function perItemExpr(expr: string, ctx: Ctx, scope: Scope, wrap = (body: string) => body): string {
  const name = `__d${ctx.counters.d++}`;
  const skip = new Set<string>();
  let body = wrap(rewriteExpr(expr, { bindings: ctx.bindings, skip: scope.forVars }));
  for (let i = scope.forStack.length - 1; i >= 0; i--) {
    const f = scope.forStack[i];
    for (const outer of scope.forStack.slice(0, i)) skip.add(outer.item).add(outer.index);
    const list = rewriteExpr(f.list, { bindings: ctx.bindings, skip });
    skip.clear();
    // v-for over a number counts 1..n, as in Vue
    body = `(typeof (${list}) === 'number' ? Array.from({ length: ${list} }, (_, i) => i + 1) : Array.from(${list} || [])).map((${f.item}, ${f.index}) => ${body})`;
  }
  ctx.setupCode.push(computedSrc(name, body));
  ctx.returnedNames.push(name);
  ctx.dataNames.push(name);
  // no trackData for the source expression: it is read HERE, in setup, by the
  // computed above — only what the wxml itself names has to cross setData
  return name + scope.forStack.map((f) => `[${f.index}]`).join('');
}

function computedSrc(name: string, body: string): string {
  return `const ${name} = __fjsComputed(() => ${body});`;
}

function rewritten(expr: string, ctx: Ctx, scope: Scope): string {
  return rewriteExpr(expr, { bindings: ctx.bindings, skip: scope.forVars });
}

function findDir(node: TemplateChildNode, name: string): DirectiveNode | undefined {
  if (node.type !== NodeTypes.ELEMENT) return undefined;
  return (node as ElementNode).props.find(
    (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === name,
  );
}

function dirArg(d: DirectiveNode): string | undefined {
  if (!d.arg) return undefined;
  return d.arg.type === NodeTypes.SIMPLE_EXPRESSION
    ? d.arg.content
    : String((d.arg as unknown as { content?: string }).content ?? '');
}

/** Raw (untransformed) parse output only ever produces simple expression
 * nodes; the union type just reflects post-transform shapes. */
function exprContent(exp: ExpressionNode | undefined): string {
  return exp && exp.type === NodeTypes.SIMPLE_EXPRESSION
    ? (exp as SimpleExpressionNode).content
    : '';
}

/** `placeholder-height`, static or bound, in either spelling. */
function isDeferOnlyProp(p: ElementNode['props'][number]): boolean {
  const names = ['placeholder-height', 'placeholderHeight'];
  if (p.type === NodeTypes.ATTRIBUTE) return names.includes(p.name);
  const arg = p.type === NodeTypes.DIRECTIVE ? p.arg : undefined;
  return p.name === 'bind' && arg?.type === NodeTypes.SIMPLE_EXPRESSION && names.includes(arg.content);
}

function staticAttr(el: ElementNode, name: string): string | null {
  const a = el.props.find(
    (p): p is AttributeNode => p.type === NodeTypes.ATTRIBUTE && p.name === name,
  );
  return a?.value?.content ?? null;
}

function toKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function kebabAttr(name: string): string {
  if (/^(data-|wx:|aria-)/.test(name)) return name;
  return toKebab(name);
}

/** WXML text nodes are RAW: entities are not decoded (`&lt;` renders
 * literally) and a bare `<` reads like a tag start. Decode the HTML
 * entities Vue templates legitimately use, then emit anything containing
 * < or > as a string interpolation. */
const TEXT_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeTextEntities(text: string): string {
  return text.replace(/&([a-z]+);/g, (m, name: string) => TEXT_ENTITIES[name] ?? m);
}

function escapeText(text: string): string {
  const decoded = decodeTextEntities(text);
  if (!decoded.includes('<') && !decoded.includes('>')) return decoded;
  const quote = decoded.includes("'") ? '"' : "'";
  if (!decoded.includes(quote) && !decoded.includes('{{') && !decoded.includes('}}')) {
    return `{{ ${quote}${decoded}${quote} }}`;
  }
  // hostile edge (both quotes / braces in text): keep entities, they at
  // least parse — display degrades instead of breaking the file
  return text;
}

function escapeAttr(text: string): string {
  // WXML attributes are not entity-decoded either; & must stay raw or
  // expressions like `a && b` would corrupt. Only the quote needs care.
  return text.replace(/"/g, '&quot;');
}
