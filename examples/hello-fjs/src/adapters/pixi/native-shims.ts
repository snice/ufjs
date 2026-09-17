// Native-host shims for booting PixiJS v7 on the QuickJS host (spec 058).
//
// Pixi assumes less browser ambient than three.js but more than QuickJS
// provides. Every entry below is pinned to a concrete code path in the
// pixi.js 7.4.3 bundle — these are the only gaps; everything else pixi
// touches at boot (Math, console, requestAnimationFrame, setTimeout) the
// engine already answers.
//
//   navigator               EventSystem.addEvents opens with a bare
//                           `globalThis.navigator.msPointerEnabled` read —
//                           without the object QuickJS throws before it even
//                           picks the pointer vs mouse branch.
//   document                the same addEvents attaches mouse listeners to
//                           `globalThis.document`, and ResizePlugin.destroy
//                           calls `globalThis.removeEventListener` even when
//                           resizeTo was never set. Both are deliberately
//                           swallowed: hit testing is the page's job (it maps
//                           fjs touch offsets to board cells), so pixi's
//                           event plumbing is never meant to fire here.
//   addEventListener /
//   removeEventListener     EventSystem's mouse path adds its pointerup
//                           handler on the global.
//   performance.now         the Ticker's per-frame time source.
//   Intl                    TextMetrics module init does
//                           `typeof (Intl == null ? void 0 : Intl.Segmenter)`
//                           — a BARE reference to the global, so on a host
//                           without the binding it throws ReferenceError and
//                           the whole page chunk fails to eval (spec 058:
//                           every route broke at preload). Defining the
//                           binding makes the `Intl == null` guard finally
//                           mean what its author intended; pixi falls back
//                           to the string iterator, which is fine — we draw
//                           no pixi Text.
//
// ⚠️ GL 版本探测（spec 058 关键结论）：pixi 用
// `gl instanceof globalThis.WebGL2RenderingContext` 决定走 WebGL2 还是
// WebGL1 代码路径。宿主上绝不能定义 WebGL2RenderingContext —— GL2 路径
// 依赖 UBO（bindBufferBase/uniformBlockBinding），桥没有这些命令，投影
// 矩阵永远传不到 GPU，画面只剩 clear 色、无错误、无异常（实测纯黑且无声）。
// GL1 路径（逐个 uniform + 手动顶点属性 + 16 位索引）桥全支持，宿主
// scene 小，绰绰有余。WebGLRenderingContext（1.0 类）则要定义：ADAPTER
// 的 getWebGLRenderingContext() 裸引用它（ScissorSystem 构造期调用）。
//
// On web none of this installs — every name exists natively and the same
// page source must hit those natives untouched (constitution I). Import this
// module BEFORE pixi.js — ESM hoists imports, so declaration order in the
// page file decides module execution order.
import { hasNativeHost } from 'fjs';

type Globals = Record<string, unknown> & {
  navigator?: unknown;
  document?: unknown;
  addEventListener?: unknown;
  removeEventListener?: unknown;
  performance?: unknown;
  Intl?: unknown;
};

if (hasNativeHost) {
  const g = globalThis as unknown as Globals;

  if (typeof g.performance === 'undefined') {
    g.performance = { now: () => __fjs!.fns.nowMs() };
  }

  // An empty object, NOT undefined-on-purpose: `Intl == null` must hold for
  // pixi's guard to skip Segmenter, and `Intl.Segmenter` reads must not
  // throw — both are satisfied by `{}`.
  if (typeof g.Intl === 'undefined') {
    g.Intl = {};
  }

  // document/navigator/addEventListener 用合并而不是整体替换：宿主可能已经
  // 提供了残缺版本（QuickJS 宿主的 globalThis 可写，任何一层都可能塞过
  // 东西），替换会丢掉它们；缺的函数补上即可。
  {
    const doc = (g.document ?? {}) as Record<string, unknown>;
    g.document = Object.assign(doc, {
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    // ADAPTER.createCanvas → document.createElement('canvas')：Program 构造期
    // getTestContext() 探测片元精度就走这条。给一个 getContext 恒返回 null 的
    // 惰性元素 —— pixi 拿不到测试 context 就退回 MEDIUM 精度，与此前模拟器上
    // 碰巧由 F2 适配层 document 桩兜住时的行为一致。宿主已有 createElement
    // （如 F2 页先装过）则不覆盖。
    if (typeof doc.createElement !== 'function') {
      doc.createElement = () => ({
        width: 0,
        height: 0,
        style: {},
        getContext: () => null,
        addEventListener: () => {},
        removeEventListener: () => {},
        setAttribute: () => {},
        appendChild: () => {},
        removeChild: () => {},
      });
    }
  }
  {
    const nav = (g.navigator ?? {}) as Record<string, unknown>;
    g.navigator = Object.assign(nav, {
      userAgent: nav.userAgent ?? 'fjs-quickjs',
      platform: nav.platform ?? 'fjs',
      maxTouchPoints: nav.maxTouchPoints ?? 0,
    });
  }

  if (typeof g.addEventListener === 'undefined') {
    g.addEventListener = () => {};
  }
  if (typeof g.removeEventListener === 'undefined') {
    g.removeEventListener = () => {};
  }

  // ScissorSystem 等构造期会经 ADAPTER.getWebGLRenderingContext() 裸引用
  // WebGLRenderingContext 全局 —— 给个空类即可（仅作构造/类型标记用）。
  // ⚠️ 但 Web2 探测用的是 context 的 instanceof，见下方 GL1 路径说明。
  if (typeof g.WebGLRenderingContext === 'undefined') {
    class FjsWebGLRenderingContext {}
    g.WebGLRenderingContext = FjsWebGLRenderingContext;
  }
}
