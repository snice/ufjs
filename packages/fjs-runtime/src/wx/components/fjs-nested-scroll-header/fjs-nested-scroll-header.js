// fjs <nested-scroll-header> for the WEBVIEW renderer (specs/208) — skyline
// uses the native component and never ships this file. The webview build
// degrades the nested contract to a single scroller (the same semantics web
// and the Flutter side ship); the one thing it keeps is the offset-top tail:
//
// virtualHost is what makes the CSS work at all (the specs/053 sticky
// finding): the view below is a real node in the page's flow, so CSS
// `position: sticky` with a NEGATIVE top pins it — `top: offset-top − own
// height` scrolls the header out until its bottom edge rests offset-top from
// the viewport top, then holds it there while the rows slide beneath. The
// own height is a layout product, so the pin line is measured, not
// authored; offset-top itself travels at COMPILE time from the sibling
// <nested-scroll-body> onto this tag (wxml.ts carryNestedInset).
Component({
  options: { virtualHost: true, mergeVirtualHostAttributes: true },
  properties: {
    offsetTop: { type: null, value: 0 },
  },
  data: { pinTop: 0 },
  observers: {
    offsetTop() {
      this.measure();
    },
  },
  lifetimes: {
    attached() {
      // the slot content may not be laid out at attach (async images make
      // the height settle even later): two retries, then the line stays —
      // a header whose height keeps changing is outside the v1 contract
      this.measureAt(0);
      this.measureAt(200);
    },
    detached() {
      (this._timers || []).forEach(clearTimeout);
      this._timers = [];
    },
  },
  methods: {
    measureAt(delay) {
      const t = setTimeout(() => {
        this._timers = (this._timers || []).filter((x) => x !== t);
        this.measure();
      }, delay);
      this._timers = (this._timers || []).concat(t);
    },
    measure() {
      this.createSelectorQuery()
        .select('.fjs-nested-scroll-header')
        .boundingClientRect((rect) => {
          // not laid out yet reads as all-zero — the retries cover it
          if (!rect || !rect.height) return;
          const n = Number(this.data.offsetTop);
          const inset = Number.isFinite(n) ? n : 0;
          const pinTop = Math.min(inset - rect.height, 0);
          if (pinTop !== this.data.pinTop) this.setData({ pinTop });
        })
        .exec();
    },
  },
});
