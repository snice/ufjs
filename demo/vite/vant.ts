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
    find: 'function useEventListener(type, listener, options = {}) {\n  if (!inBrowser) {',
    replace: 'function useEventListener(type, listener, options = {}) {\n  if (!inBrowser && !options.target) {',
    feature: 'Slider drag (useEventListener on an element target)',
  },
  {
    // Popup/Overlay lock page scrolling through `document` on every
    // open/close, unguarded; the ReferenceError unwinds the component update
    // mid-flight and the popup never reaches its new state. The app side
    // pins the page under an overlay by itself, so the lock is a no-op.
    file: LOCK_SCROLL,
    find: '  const lock = () => {\n',
    replace: '  const lock = () => {\n    if (typeof document === "undefined") return;\n',
    feature: 'Popup open (useLockScroll)',
  },
  {
    file: LOCK_SCROLL,
    find: '  const unlock = () => {\n',
    replace: '  const unlock = () => {\n    if (typeof document === "undefined") return;\n',
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
    find: '"aria-orientation": props.vertical ? "vertical" : "horizontal",\n',
    replace:
      '"aria-orientation": props.vertical ? "vertical" : "horizontal",\n        "style": { touchAction: "none" },\n',
    feature: 'Slider drag inside a scroll-view',
  },
  {
    // Rate only preventDefault()s horizontal moves: a vertical drag across
    // the stars still scrolls the page.
    file: RATE,
    find: '"onTouchstartPassive": onTouchStart\n    }, [list.value.map(renderStar)]);',
    replace: '"onTouchstartPassive": onTouchStart,\n      "style": { touchAction: "pan-y" }\n    }, [list.value.map(renderStar)]);',
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
    find: 'return _createVNode("textarea", _mergeProps(inputAttrs, {\n          "inputmode": props.inputmode\n        }), null);',
    replace:
      'return _createVNode("textarea", _mergeProps(inputAttrs, {\n          "inputmode": props.inputmode,\n          "autoHeight": !!props.autosize\n        }), null);',
    feature: 'Field autosize textarea',
  },
  {
    // Tabs (and Sticky / List / PullRefresh) look for their scroll parent
    // on mount through window.getComputedStyle — a ReferenceError that
    // aborted Tabs' mounted hook. With no scroll parent found they fall
    // back to the root (undefined here), which every caller already treats
    // as "no scroller": no scrollspy, no sticky offset from the page.
    file: VANT_USE,
    find: 'function getScrollParent(el, root = defaultRoot) {\n',
    replace: 'function getScrollParent(el, root = defaultRoot) {\n  if (typeof window === "undefined") return root;\n',
    feature: 'Tabs / Sticky mount (useScrollParent)',
  },
  {
    // isHidden() gates Tabs' and Swipe's (re)initialisation on
    // window.getComputedStyle. Without a computed style to read the app
    // side counts the element as shown — they initialise, which is what a
    // visible Tabs / Swipe needs; a hidden one re-measures once it shows.
    file: DOM_UTILS,
    find: '  const style = window.getComputedStyle(el);\n  const hidden = style.display === "none";',
    replace:
      '  if (typeof window === "undefined") return false;\n  const style = window.getComputedStyle(el);\n  const hidden = style.display === "none";',
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
    find: '        const title = titles[state.currentIndex].$el;\n',
    replace:
      '        const title = titles[state.currentIndex].$el;\n' +
      '        if (typeof window === "undefined" && !title.offsetWidth) {\n' +
      '          setLine.retries = (setLine.retries || 0) + 1;\n' +
      // the retry keeps the first call's "no animation" (state.inited is
      // true by then, and the line would slide in from the left edge)
      '          if (setLine.retries <= 10) requestAnimationFrame(() => {\n' +
      '            const inited = state.inited;\n' +
      '            state.inited = shouldAnimate;\n' +
      '            setLine();\n' +
      '            state.inited = inited;\n' +
      '          });\n' +
      '          return;\n' +
      '        }\n' +
      '        setLine.retries = 0;\n',
    feature: 'Tabs underline position on first render',
  },
  {
    // fjs's `input`/`textarea` are components on BOTH ends (webIsNativeTag
    // keeps them out of the native path), so Field's input handler receives
    // the emitted VALUE, not a DOM event — `event.target` is undefined and
    // every keystroke throws (specs/103, the first-argument contract). The
    // object path stays for a future where these tags go native again.
    file: FIELD,
    find: '    const onInput = (event) => {\n      if (!event.target.composing) {\n        updateValue(event.target.value);\n      }\n    };',
    replace:
      '    const onInput = (event) => {\n' +
      '      if (typeof event !== "object" || event === null) {\n' +
      '        updateValue(event);\n' +
      '        return;\n' +
      '      }\n' +
      '      if (!event.target.composing) {\n' +
      '        updateValue(event.target.value);\n' +
      '      }\n' +
      '    };',
    feature: 'Field 输入（v-model）',
  },
  {
    // Same value-not-event shape on Stepper's input (specs/103). The shim
    // keeps the body's format-and-write-back working on `input.value`; a
    // write to the shim only drops the in-place reformat — the value still
    // reaches setValue.
    file: STEPPER,
    find: '    const onInput = (event) => {\n      const input = event.target;',
    replace:
      '    const onInput = (event) => {\n' +
      '      const input = typeof event === "object" && event !== null ? event.target : { value: String(event) };',
    feature: 'Stepper 输入（v-model）',
  },
  {
    file: STEPPER,
    find: '    const onBlur = (event) => {\n      const input = event.target;\n      const value = format(input.value, props.autoFixed);',
    replace:
      '    const onBlur = (event) => {\n' +
      '      const input = typeof event === "object" && event !== null ? event.target : { value: String(event) };\n' +
      '      const value = format(input.value, props.autoFixed);',
    feature: 'Stepper 失焦格式化',
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
