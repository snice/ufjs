# @ufjs/runtime

## 0.1.4

- **微信小程序渲染器**：支撑 Vue SFC 编译为微信小程序的运行时侧，
  webview/skyline 双渲染器（spec 046）；canvas 2d / WebGL 桥接、skyline 触摸
  事件补齐 offsetLeft/Top、public 数据文件真机可 fetch（specs 046/063 及后续
  修复）；分包产物去重。
- **吸顶布局（specs 052/053/054）**：`<sticky-header>` / `<sticky-section>`
  吸顶组件；样式级 `position: sticky` 全端生效；`scroll-into-view` 置空可重
  触发，sticky 目标落在分组起点。
- `<page-container>` 页面容器组件，三端同源（spec 065）。
- **CSS（specs 040/041/042/043/044/045）**：`@media` 响应式样式，窗口尺寸
  通道两端打通；伪类补全与单边边框；`el.style` shim，@vueuse/motion 两端可跑；
  百分比扩展到盒模型间距与定位偏移；transition 背景色/尺寸插值。
- WebGL：ArrayBuffer 直接上传，分包重复打包修复（specs 038/066 相关）。
- safe-area `edges` 属性三端同源；`<swiper>` 直接子节点必须是 swiper-item，
  编译期校验（spec 051）。
- `@ufjs/runtime/ambient` now declares the static files a build turns into a
  URL — `import logo from '@/assets/logo.png'` and the other extensions in
  ASSET_LOADERS. A project's tsconfig says `"types": []`, so nothing else
  declared them and every app hand-wrote the same `declare module '*.png'`.

## 0.1.3

- `<canvas>` and a Canvas 2D context. `getContext('2d')` returns a real
  `CanvasRenderingContext2D` — paths and `Path2D`, fills and strokes, line caps
  and joins and dashes, linear/radial/conic gradients and patterns, `fillText` /
  `strokeText` / `measureText` with font parsing, `drawImage`, clipping,
  transforms, `globalAlpha` and `globalCompositeOperation`, and the save/restore
  state stack. Commands are batched into a display list and flushed to the host
  once per frame.
- A full-canvas `clearRect` is the signal that discards the retained display
  list; a partial one now marks its chunk `NEEDS_LAYER` (op protocol 4) so the
  host replays it into its own layer instead of erasing what sits underneath.
  Going 240 frames without a full clear warns once — that is a display list
  growing per frame.
- `arcTo` is degraded to `lineTo` + `arc` in JS. The DOM's `arcTo(x1,y1,x2,y2,r)`
  is a fillet between two segments: the arc is tangent to both rays and
  `(x2,y2)` only gives a direction. Flutter has no fillet, only SVG-style
  `arcToPoint`, whose end point is the point it was given — a rounded rectangle
  came out as a barrel. The tangent points are plain geometry and come out the
  same on both ends, so they are computed here. The spec's degenerate cases are
  followed exactly: no current point means `moveTo(x1,y1)`; coincident points, a
  zero radius and three collinear points are a straight line to `(x1,y1)`; a
  negative radius throws, as in the DOM.
- Touch events carry `offsetX` / `offsetY`, which is what a hit test against a
  canvas needs — `clientX` is page space.
- `<image src>` and `<web-view src>` are typed against the project's own files.
  The two empty interfaces `FjsImageAssets` / `FjsHtmlAssets` are augmented by
  the `src/fjs-assets.d.ts` that `fjs` generates; with no table the props fall
  back to plain strings.
- Local images in the web renderer: `<image>` resolves a project asset path to
  a URL the browser can load.

## 0.1.1

- The `fjs*` module declarations ship with the package instead of being listed
  in each project's tsconfig.

## 0.1.0

- First release: the Vue 3 custom renderer, the pages router, and the element
  layer behind the HTML-like tags.
