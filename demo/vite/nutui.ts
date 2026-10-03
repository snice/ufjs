// NutUI on fjs: the Vite plugin that adapts NutUI for the fjs app build.
// Same shape as ./vant.ts: a local plugin with anchored source patches; the
// web build is untouched. When an anchor is missing (NutUI changed), the
// file loads untouched and the build warns once — the feature degrades to
// "off on the app side", never to a broken bundle (specs/203).
import type { Plugin } from 'vite';
import type { FjsAppHook } from '@ufjs/cli/vite';

interface Patch {
  file: RegExp;
  find: string;
  replace: string;
  /** What breaks on the app side when the anchor is gone. */
  feature: string;
}

// The dist chunk names carry a content hash; match past it.
const MOUNT_COMPONENT = /@nutui\/nutui\/dist\/packages\/mountComponent-[A-Za-z0-9]+\.js$/;
const TOAST = /@nutui\/nutui\/dist\/packages\/toast\/Toast\.js$/;
const DIALOG = /@nutui\/nutui\/dist\/packages\/dialog\/Dialog\.js$/;
const SWIPER = /@nutui\/nutui\/dist\/packages\/swiper\/Swiper\.js$/;

// The find/replace strings keep NutUI's dist indentation byte for byte —
// write them as flush-left template literals and never re-indent them.
export const PATCHES: Patch[] = [
  {
    // Toast / Dialog / Notify mount a second Vue app through CreateComponent.
    // The 'vue' shim's createApp throws on purpose (specs/137): createApp
    // must come from fjs/vue (like vant's own patch), with
    // createDetachedRoot standing in for the `<div>` appended to <body>.
    file: MOUNT_COMPONENT,
    find: 'import { createApp } from "vue";',
    replace: `import { createApp, createDetachedRoot, releaseDetachedRoot } from "fjs/vue";
const fjsRoots = new Map();
if (typeof document !== "undefined" && typeof document.getElementById !== "function") {
  document.getElementById = (id) => fjsRoots.get(String(id)) ?? null;
  const fjsBody = document.body;
  const fjsRawRemove = fjsBody.removeChild;
  fjsBody.removeChild = (child) => {
    const root = fjsRoots.get(child);
    if (root) {
      releaseDetachedRoot(root);
      return child;
    }
    return fjsRawRemove.call(fjsBody, child);
  };
}`,
    feature: '命令式 Toast / Dialog / Notify 挂载（CreateComponent）',
  },
  {
    // The container: dom-env's createElement answers a MeasureBox whose
    // subtree nothing would ever render — mount the second app into a
    // detached root instead; what it renders reaches the app-level overlay
    // host (specs/137). The `root.id = …` write is skipped: it would clobber
    // the detached root's numeric node id, which the renderer books by.
    file: MOUNT_COMPONENT,
    find: `  const root = document.createElement("view");
  const name = component.name ? component.name + "-" : "";
  const id1 = options.id || (/* @__PURE__ */ new Date()).getTime();
  root.id = name + id1;`,
    replace: `  const root = createDetachedRoot();
  const name = component.name ? component.name + "-" : "";
  const id1 = options.id || (/* @__PURE__ */ new Date()).getTime();`,
    feature: '命令式 Toast / Dialog / Notify 挂载（CreateComponent）',
  },
  {
    // Register the detached root where Toast's close path looks: clearToast
    // does document.getElementById(id) + document.body.removeChild(container)
    // with the timestamp id, and on the app the removal must release the
    // detached root or the toast stays on screen for good.
    file: MOUNT_COMPONENT,
    find: `  elWrap.appendChild(root);
  return {
    instance: instance.mount(root),
    unmount: () => {
      instance.unmount();
      elWrap.removeChild(root);
    }
  };`,
    replace: `  fjsRoots.set(String(id1), root);
  if (name) fjsRoots.set(name + id1, root);
  fjsRoots.set(root, root);
  return {
    instance: instance.mount(root),
    unmount: () => {
      fjsRoots.delete(String(id1));
      if (name) fjsRoots.delete(name + id1);
      fjsRoots.delete(root);
      instance.unmount();
      releaseDetachedRoot(root);
    }
  };`,
    feature: 'Toast 自动关闭（clearToast 释放 detached root）',
  },
  {
    // updateToast re-renders an existing toast with runtime-dom's `render`
    // — the shim has no such export; the renderer's render comes from
    // fjs/vue (the same one createApp above uses).
    file: TOAST,
    find: 'vShow, createVNode, render } from "vue";',
    replace: `vShow, createVNode } from "vue";
import { render } from "fjs/vue";`,
    feature: 'showToast({ id }) 复用更新（updateToast）',
  },
  {
    // Dialog's imperative wrapper teleports to `#${root.id}` — a selector
    // the runtime's querySelector deliberately does not answer (only
    // body/html, specs/129). Point it at the body: the app-level overlay
    // host, same place every other imperative overlay lands.
    file: DIALOG,
    find: 'options.teleport = `#${root.id}`;',
    replace: 'options.teleport = "body";',
    feature: 'showDialog 弹层落点（teleport → body）',
  },
  {
    // Swiper measures itself against the window: width = ref(window.innerWidth),
    // re-read on mount and on resize. dom-env's window keeps innerWidth ~0
    // (what vant always saw), so the swiper collapsed to zero height and the
    // page showed nothing. Fall back to the 390pt design width; the resize
    // listener stays (dom-env's window absorbs no-op listeners).
    file: SWIPER,
    find: `    const width = ref(window.innerWidth);
    const height = ref(window.innerHeight);
    const updateDimensions = () => {
      width.value = window.innerWidth;
      height.value = window.innerHeight;
    };`,
    replace: `    const fjsWinSize = () => ({
      width: typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 390,
      height: typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : 844,
    });
    const width = ref(fjsWinSize().width);
    const height = ref(fjsWinSize().height);
    const updateDimensions = () => {
      const size = fjsWinSize();
      width.value = size.width;
      height.value = size.height;
    };`,
    feature: 'Swiper 尺寸测量（window.innerWidth 兜底）',
  },
];

export function nutui(options: { warn?: (message: string) => void } = {}): Plugin & { fjs: { app: FjsAppHook } } {
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const warned = new Set<Patch>();
  const files = [...new Set(PATCHES.map((p) => p.file.source))];
  return {
    name: 'fjs-nutui',
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
              warn(`[nutui] app patch did not apply to ${id}; ${patch.feature} is broken on the app side`);
            }
          }
          return out === code ? null : out;
        },
      },
    },
  };
}
