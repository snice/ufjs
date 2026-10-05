// fjs <safe-area> on wx. env(safe-area-inset-*) is unreliable in the
// DevTools webview simulator, so the insets come from the window info
// instead — deterministic in both renderers, simulator and device.
//
// Flutter's SafeArea pads only what the system UI covers, and an outer one
// removes the insets from the MediaQuery it hands down, so a nested one pads
// nothing. The same two rules here:
//   * top: only while this box's top edge is under the status bar. The top
//     edge is measured — it does not move with this box's own padding. An
//     all-edges safe-area whose top is already below it is nested (the
//     shell's around a page that uses another) and pads nothing at all.
//     Relations cannot link the two — the shell and the page are different
//     component trees and relations do not cross the slot.
//   * bottom: the home-indicator strip, except on a tab page, where the
//     native tabBar already sits over it.
// `edges` limits which of these apply (same attribute as web and Flutter).
// The bottom edge is deliberately NOT measured: the webview renderer reports
// a box that grows with its own padding and content while it lays out, and
// a measured bottom once turned into a ~600px padding that squeezed the
// shell's scroll-view to nothing (content painted outside every hit area,
// so no tap or :active reached it).
function ownerPagePath(self) {
  let node = self;
  for (let i = 0; i < 20 && node && typeof node.selectOwnerComponent === 'function'; i++) {
    const owner = node.selectOwnerComponent();
    if (!owner || owner === node) break;
    node = owner;
  }
  if (node && node.route) return node.route;
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const top = pages[pages.length - 1];
  return top ? top.route : '';
}

/** `edges="top bottom"` -> Set; omitted -> null (all four). */
function namedEdges(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  return new Set(String(raw).split(/[\s,]+/).filter(Boolean));
}

Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    // which edges take the insets, as on the other ends (web base-css,
    // Flutter SafeArea(top:, bottom:, …)); omitted = all four
    edges: { type: String, value: '' },
    // 0-1: take only this fraction of each inset (same as web / Flutter)
    scale: { type: Number, value: 1 },
  },
  data: {
    pad: '',
  },
  observers: {
    'edges, scale'() {
      this.apply(this.__nested === true);
    },
  },
  lifetimes: {
    attached() {
      this.apply(false);
    },
    ready() {
      this.createSelectorQuery()
        .select('.fjs-safe-area-root')
        .boundingClientRect((rect) => {
          const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
          this.__nested = !!rect && rect.top >= (info.statusBarHeight || 0) && rect.top > 0;
          this.apply(this.__nested);
        })
        .exec();
    },
  },
  methods: {
    apply(topCovered) {
      const edges = namedEdges(this.data.edges);
      const want = (name) => edges === null || edges.has(name);
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const safe = info.safeArea;
      // An all-edges safe-area below the status bar sits inside another one
      // (the shell's around a page): Flutter pads nothing there. An explicit
      // edge list is the caller saying where the box is — a bottom bar's
      // `edges="bottom"` sits low on the screen by design, so only the top
      // edge keeps the measured check.
      const nested = edges === null && topCovered;
      let top = 0;
      let bottom = 0;
      let left = 0;
      let right = 0;
      if (!nested) {
        const wxrt = globalThis.__fjsWx;
        const tab = !!(wxrt && wxrt.isTabPagePath && wxrt.isTabPagePath(ownerPagePath(this)));
        if (want('top') && !topCovered) top = info.statusBarHeight || 0;
        // Measured against the window's bottom, not the screen's: Android
        // WeChat stops the page above the system navigation bar and paints
        // that strip itself, so the inset is already outside the window and
        // padding it again leaves a blank band. On iOS (and the simulator)
        // the window reaches the screen bottom and this is the full inset.
        if (want('bottom') && safe && !tab) {
          const windowBottom =
            typeof info.screenTop === 'number' && info.windowHeight
              ? info.screenTop + info.windowHeight
              : info.screenHeight;
          bottom = Math.max(0, Math.round(Math.min(windowBottom, info.screenHeight) - safe.bottom));
        }
        if (want('left') && safe) left = Math.max(0, Math.round(safe.left));
        if (want('right') && safe) right = Math.max(0, Math.round(info.screenWidth - safe.right));
      }
      const k = Math.min(1, Math.max(0, Number(this.data.scale)));
      if (k !== 1) {
        top = Math.round(top * k);
        right = Math.round(right * k);
        bottom = Math.round(bottom * k);
        left = Math.round(left * k);
      }
      const pad = top || right || bottom || left ? `padding: ${top}px ${right}px ${bottom}px ${left}px` : '';
      if (pad !== this.data.pad) this.setData({ pad });
    },
  },
});
