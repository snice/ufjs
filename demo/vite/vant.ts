// Vant on fjs: the Vite plugin that adapts vant for the fjs app build.
// A local plugin, not a package — each project carries the adapters for the
// component libraries it uses, next to its vite.config.
//
// The web build is untouched (vant runs in a real browser there). For the
// app build the plugin carries an `fjs.app` hook (see @ufjs/cli's
// FjsAppHook): anchored source patches for the places vant touches `window`
// / `document` without a browser check. The app runtime has neither global,
// on purpose — the patches make vant cope with that, rather than the
// runtime pretending to be a browser. Everything generic (DOM-shaped
// element APIs, <Transition>, CSS) lives in the fjs runtime.
//
// Each patch is a literal replacement. When its anchor is missing (vant
// changed), the file loads untouched and the build warns once: an upgrade
// degrades to "this feature is off on the app side again", never to a
// broken bundle.
import type { Plugin } from 'vite';
import type { FjsAppHook } from '@ufjs/cli/vite';

interface Patch {
  file: RegExp;
  find: string;
  replace: string;
  /** What breaks on the app side when the anchor is gone. */
  feature: string;
}

const VANT_USE = /\/@vant\/use\/dist\/index\.esm\.mjs$/;
const LOCK_SCROLL = /\/vant\/es\/composables\/use-lock-scroll\.mjs$/;
const SLIDER = /\/vant\/es\/slider\/Slider\.mjs$/;
const RATE = /\/vant\/es\/rate\/Rate\.mjs$/;
const FIELD = /\/vant\/es\/field\/Field\.mjs$/;
const DOM_UTILS = /\/vant\/es\/utils\/dom\.mjs$/;
const TABS = /\/vant\/es\/tabs\/Tabs\.mjs$/;
const STEPPER = /\/vant\/es\/stepper\/Stepper\.mjs$/;
const MOUNT_COMPONENT = /\/vant\/es\/utils\/mount-component\.mjs$/;
const LOCK_CLICK = /\/vant\/es\/toast\/lock-click\.mjs$/;
const NOTIFY = /\/vant\/es\/notify\/Notify\.mjs$/;
const IMAGE_PREVIEW = /\/vant\/es\/image-preview\/ImagePreview\.mjs$/;
const LIST = /\/vant\/es\/list\/List\.mjs$/;

// The find/replace strings below keep vant's dist indentation byte for
// byte — write them as flush-left template literals and never re-indent
// them (the whitespace inside the backticks IS the patch).
export const PATCHES: Patch[] = [
  {
    // useRect() runs `val === window` on every call (Rate clicks, Slider
    // taps): an undeclared global throws a ReferenceError there
    file: VANT_USE,
    find: 'var isWindow = (val) => val === window;',
    replace: 'var isWindow = (val) => typeof window !== "undefined" && val === window;',
    feature: 'useRect (Rate click, Slider tap)',
  },
  {
    // useEventListener returns straight away outside a browser, so a
    // listener vant attaches to one of ITS OWN elements never reaches the
    // fjs element — the Slider's touchmove. Keep the early return only for
    // the default target (window, absent here); an explicit element target
    // goes through to the element's addEventListener.
    file: VANT_USE,
    find: `function useEventListener(type, listener, options = {}) {
  if (!inBrowser) {`,
    replace: `function useEventListener(type, listener, options = {}) {
  if (!inBrowser && !options.target) {`,
    feature: 'Slider drag (useEventListener on an element target)',
  },
  {
    // Popup/Overlay lock page scrolling through `document` on every
    // open/close, unguarded; the ReferenceError unwinds the component update
    // mid-flight and the popup never reaches its new state. The app side
    // pins the page under an overlay by itself, so the lock is a no-op.
    file: LOCK_SCROLL,
    find: `  const lock = () => {
`,
    replace: `  const lock = () => {
    if (typeof document === "undefined") return;
`,
    feature: 'Popup open (useLockScroll)',
  },
  {
    file: LOCK_SCROLL,
    find: `  const unlock = () => {
`,
    replace: `  const unlock = () => {
    if (typeof document === "undefined") return;
`,
    feature: 'Popup close (useLockScroll)',
  },
  {
    // Drags vs. the page's scroll-view. On the web vant wins them by calling
    // preventDefault() in a non-passive touchmove; on the app the listener
    // runs in JS, a frame after Flutter's gesture arena has already handed
    // the pointer to the scroller (the drag ends in touchcancel). The app
    // side's answer is the declaration browsers also honour: `touch-action`
    // makes the node claim the pointer up front. The Slider button
    // preventDefault()s every move, so it claims everything.
    file: SLIDER,
    find: `"aria-orientation": props.vertical ? "vertical" : "horizontal",
`,
    replace: `"aria-orientation": props.vertical ? "vertical" : "horizontal",
        "style": { touchAction: "none" },
`,
    feature: 'Slider drag inside a scroll-view',
  },
  {
    // Rate only preventDefault()s horizontal moves: a vertical drag across
    // the stars still scrolls the page.
    file: RATE,
    find: `"onTouchstartPassive": onTouchStart
    }, [list.value.map(renderStar)]);`,
    replace: `"onTouchstartPassive": onTouchStart,
      "style": { touchAction: "pan-y" }
    }, [list.value.map(renderStar)]);`,
    feature: 'Rate swipe inside a scroll-view',
  },
  {
    // `autosize` measures the textarea through the DOM (style.height =
    // 'auto', scrollHeight) and saves/restores `window.pageYOffset` around
    // it — a ReferenceError on the app. The app's multiline input grows
    // with its content natively (`auto-height`), so hand it that instead.
    file: FIELD,
    find: 'if (props.type === "textarea" && props.autosize && input) {',
    replace: 'if (props.type === "textarea" && props.autosize && input && typeof window !== "undefined") {',
    feature: 'Field autosize textarea',
  },
  {
    file: FIELD,
    find: `return _createVNode("textarea", _mergeProps(inputAttrs, {
          "inputmode": props.inputmode
        }), null);`,
    replace: `return _createVNode("textarea", _mergeProps(inputAttrs, {
          "inputmode": props.inputmode,
          "autoHeight": !!props.autosize
        }), null);`,
    feature: 'Field autosize textarea',
  },
  {
    // Tabs (and Sticky / List / PullRefresh) look for their scroll parent
    // on mount through window.getComputedStyle — a ReferenceError that
    // aborted Tabs' mounted hook. With no scroll parent found they fall
    // back to the root (undefined here), which every caller already treats
    // as "no scroller": no scrollspy, no sticky offset from the page.
    file: VANT_USE,
    find: `function getScrollParent(el, root = defaultRoot) {
`,
    replace: `function getScrollParent(el, root = defaultRoot) {
  if (typeof window === "undefined") return root;
`,
    feature: 'Tabs / Sticky mount (useScrollParent)',
  },
  {
    // isHidden() gates Tabs' and Swipe's (re)initialisation on
    // window.getComputedStyle. Without a computed style to read the app
    // side counts the element as shown — they initialise, which is what a
    // visible Tabs / Swipe needs; a hidden one re-measures once it shows.
    file: DOM_UTILS,
    find: `  const style = window.getComputedStyle(el);
  const hidden = style.display === "none";`,
    replace: `  if (typeof window === "undefined") return false;
  const style = window.getComputedStyle(el);
  const hidden = style.display === "none";`,
    feature: 'Tabs / Swipe init (isHidden)',
  },
  {
    // Tabs places its underline from the active title's offsetLeft /
    // offsetWidth right after mount. The app answers geometry from the last
    // frame the host laid out (fjs-runtime ui/geometry.ts) — at mount there
    // is none yet, so the line sat at 0 until the first tab switch. Retry
    // on the next frames while the title still measures 0 (bounded: a Tabs
    // that really is hidden stops asking).
    file: TABS,
    find: `        const title = titles[state.currentIndex].$el;
`,
    // In the replacement: the retry keeps the first call's "no animation"
    // (state.inited is true by then, and the line would slide in from the
    // left edge).
    replace: `        const title = titles[state.currentIndex].$el;
        if (typeof window === "undefined" && !title.offsetWidth) {
          setLine.retries = (setLine.retries || 0) + 1;
          if (setLine.retries <= 10) requestAnimationFrame(() => {
            const inited = state.inited;
            state.inited = shouldAnimate;
            setLine();
            state.inited = inited;
          });
          return;
        }
        setLine.retries = 0;
`,
    feature: 'Tabs underline position on first render',
  },
  {
    // fjs's `input`/`textarea` are components on BOTH ends (webIsNativeTag
    // keeps them out of the native path), so Field's input handler receives
    // the emitted VALUE, not a DOM event — `event.target` is undefined and
    // every keystroke throws (specs/103, the first-argument contract). The
    // object path stays for a future where these tags go native again.
    file: FIELD,
    find: `    const onInput = (event) => {
      if (!event.target.composing) {
        updateValue(event.target.value);
      }
    };`,
    replace: `    const onInput = (event) => {
      if (typeof event !== "object" || event === null) {
        updateValue(event);
        return;
      }
      if (!event.target.composing) {
        updateValue(event.target.value);
      }
    };`,
    feature: 'Field 输入（v-model）',
  },
  {
    // Same value-not-event shape on Stepper's input (specs/103). The shim
    // keeps the body's format-and-write-back working on `input.value`; a
    // write to the shim only drops the in-place reformat — the value still
    // reaches setValue.
    file: STEPPER,
    find: `    const onInput = (event) => {
      const input = event.target;`,
    replace: `    const onInput = (event) => {
      const input = typeof event === "object" && event !== null ? event.target : { value: String(event) };`,
    feature: 'Stepper 输入（v-model）',
  },
  {
    file: STEPPER,
    find: `    const onBlur = (event) => {
      const input = event.target;
      const value = format(input.value, props.autoFixed);`,
    replace: `    const onBlur = (event) => {
      const input = typeof event === "object" && event !== null ? event.target : { value: String(event) };
      const value = format(input.value, props.autoFixed);`,
    feature: 'Stepper 失焦格式化',
  },
  {
    // Imperative overlays (showToast / showDialog / showNotify /
    // showImagePreview) mount a second Vue app. The 'vue' shim's createApp
    // throws on purpose (specs/137 Q1): the real one comes from fjs/vue,
    // together with the container that stands in for a <div> on <body>.
    file: MOUNT_COMPONENT,
    find: 'import { createApp, reactive } from "vue";',
    replace: `import { reactive } from "vue";
import { createApp, createDetachedRoot, releaseDetachedRoot } from "fjs/vue";`,
    feature: 'showToast / showDialog / showNotify / showImagePreview',
  },
  {
    // The container: dom-env's document.createElement answers a MeasureBox
    // and body.appendChild is a no-op. A detached root belongs to no page;
    // what the app renders reaches the app-level overlay host — Teleport to
    // body lands there, a fixed Notify hoists there (specs/137).
    file: MOUNT_COMPONENT,
    find: `  const root = document.createElement("div");
  document.body.appendChild(root);
  return {
    instance: app.mount(root),
    unmount() {
      app.unmount();
      document.body.removeChild(root);
    }
  };`,
    replace: `  const root = createDetachedRoot();
  return {
    instance: app.mount(root),
    unmount() {
      app.unmount();
      releaseDetachedRoot(root);
    }
  };`,
    feature: 'showToast / showDialog / showNotify / showImagePreview',
  },
  {
    // `forbidClick` Toasts lock the page by putting `van-toast--unclickable`
    // on <body> — `.van-toast--unclickable * { pointer-events: none }`. The
    // app has no body for a class to land on (dom-env's classList swallows
    // it), so taps went through to the page. The app's lock is a transparent
    // full-screen box with a tap handler, mounted like the Toast itself: a
    // detached root, hoisted into the app overlay host above every page,
    // where it takes the hit before the Navigator does (specs/137).
    file: LOCK_CLICK,
    find: 'let lockCount = 0;',
    replace: `import { h } from "vue";
import { createApp, createDetachedRoot, releaseDetachedRoot } from "fjs/vue";
let fjsLock = null;
function fjsLockClick(on) {
  if (on && !fjsLock) {
    const root = createDetachedRoot();
    const app = createApp({ render: () => h("view", {
      style: { position: "fixed", left: 0, top: 0, right: 0, bottom: 0 },
      onClick: () => {},
    }) });
    app.mount(root);
    fjsLock = { app, root };
  } else if (!on && fjsLock) {
    fjsLock.app.unmount();
    releaseDetachedRoot(fjsLock.root);
    fjsLock = null;
  }
}
let lockCount = 0;`,
    feature: 'showToast forbidClick（锁点击）',
  },
  {
    file: LOCK_CLICK,
    find: '      document.body.classList.add("van-toast--unclickable");',
    replace: '      fjsLockClick(true);',
    feature: 'showToast forbidClick（锁点击）',
  },
  {
    file: LOCK_CLICK,
    find: '      document.body.classList.remove("van-toast--unclickable");',
    replace: '      fjsLockClick(false);',
    feature: 'showToast forbidClick（锁点击）',
  },
  {
    // Notify's root is `position: fixed; top: 0` (`.van-popup--top`), hoisted
    // into the app-level overlay host — which deliberately does no safe-area
    // handling (docs/overlay-host.md §5), so the message painted UNDER the
    // status bar clock on the edge-to-edge app. Wrapping the slot content in
    // `<safe-area edges="top">` keeps the bar's colour behind the status bar
    // (immersive, like the Shell's nav strip) while the text itself drops
    // below the inset: Flutter SafeArea on the app, `env(safe-area-inset-top)`
    // padding on the web stylesheet (specs/142). Web builds never see this
    // patch — there the browser chrome already owns that strip.
    file: NOTIFY,
    find: 'default: () => [slots.default ? slots.default() : props.message]',
    replace:
      'default: () => [_createVNode("safe-area", { edges: "top" }, [slots.default ? slots.default() : props.message])]',
    feature: 'showNotify 顶部让出状态栏（safe-area top）',
  },
  {
    // Same strip, same consequence: ImagePreview's close icon sits at
    // `top: var(--van-image-preview-close-top)` ≈ the very top of the screen,
    // inside the status-bar band where taps never reach the app, so the
    // button painted but was dead (specs/142). The `<safe-area edges="top">`
    // wrapper takes over the absolute positioning and the tap (a bigger hit
    // target, and the icon's tap bubbles to it); the Icon keeps its classes
    // for size/colour but goes `position: static` so the CSS top/right stop
    // fighting the wrapper. Only `top-right` moves — the other
    // closeIconPosition values anchor to edges the inset does not touch.
    file: IMAGE_PREVIEW,
    find: `if (props.closeable) {
        return _createVNode(Icon, {
          "role": "button",
          "name": props.closeIcon,
          "class": [bem("close-icon", props.closeIconPosition), HAPTICS_FEEDBACK],
          "onClick": emitClose
        }, null);
      }`,
    replace: `if (props.closeable) {
        const icon = _createVNode(Icon, {
          "role": "button",
          "name": props.closeIcon,
          "class": [bem("close-icon", props.closeIconPosition), HAPTICS_FEEDBACK],
          "style": { position: "static" }
        }, null);
        if (props.closeIconPosition !== "top-right") return icon;
        return _createVNode("safe-area", {
          "edges": "top",
          "style": { position: "absolute", top: 0, right: 0, zIndex: 1 },
          "onClick": emitClose
        }, [icon]);
      }`,
    feature: 'showImagePreview close 图标让出状态栏（safe-area top）',
  },
  {
    // List's whole loading loop hangs off its scroll parent. On the app the
    // parent probe is unreliable — sometimes none (useScrollParent answers
    // undefined, see the VANT_USE patch above), sometimes a zero-height
    // ancestor — and either way useRect's height is 0, so check() bails at
    // `!scrollParentRect.height` BEFORE ever emitting "load": the list stays
    // empty forever, silently (constitution V). A zero-height scroller can
    // never make the reach-edge test meaningful, so treat it as always at
    // the edge: run the branch the geometry path would (loading + emit),
    // guarded like check()'s own head so repeated checks don't pile up.
    // Pages load their items in one go instead of progressively (there is
    // no scroll listener to pace it; an fjs scroll-view's scroll event never
    // reaches the list).
    file: LIST,
    find: `        const scrollParentRect = useRect(scroller);
        if (!scrollParentRect.height || isHidden(root)) {
          return;
        }`,
    replace: `        const scrollParentRect = useRect(scroller);
        if (!scrollParentRect.height || isHidden(root)) {
          if (!loading.value && !props.finished && !props.disabled && !props.error) {
            loading.value = true;
            emit("update:loading", true);
            emit("load");
          }
          return;
        }`,
    feature: 'List 首次加载（无滚动父级时视为到达边缘）',
  },
];

export function vant(options: { warn?: (message: string) => void } = {}): Plugin & { fjs: { app: FjsAppHook } } {
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const warned = new Set<Patch>();
  const files = [...new Set(PATCHES.map((p) => p.file.source))];
  return {
    name: 'fjs-vant',
    fjs: {
      app: {
        filter: new RegExp(files.map((f) => `(?:${f})`).join('|')),
        transform(code, id) {
          let out = code;
          for (const patch of PATCHES) {
            if (!patch.file.test(id)) continue;
            if (out.includes(patch.find)) {
              out = out.replace(patch.find, patch.replace);
            } else if (!warned.has(patch)) {
              warned.add(patch);
              warn(`[vant] app patch did not apply to ${id}; ${patch.feature} is broken on the app side`);
            }
          }
          return out === code ? null : out;
        },
      },
    },
  };
}
