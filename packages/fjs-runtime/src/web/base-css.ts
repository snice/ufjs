// Base stylesheet for the web adapter: makes the fjs tag set lay out the
// way flutter_fjs's widget layer does.
//
// The two big alignments with Flutter:
//   * every container is a column flexbox with border-box sizing, because
//     Flutter puts padding inside the sized/decorated box and margin outside
//   * `stack` overlaps its children (CSS grid, all children in cell 1/1),
//     which is what Flutter's Stack does
//
// Known difference: a `flex-direction: row` container centers its children
// on the cross axis in Flutter and stretches them in CSS. Set `align-items`
// explicitly when it matters — see docs/web.md.
export const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  color: #333333;
  background: #f4f5f7;
  -webkit-font-smoothing: antialiased;
}
#app { height: 100%; display: flex; flex-direction: column; }
/* A page's root widget gets the whole screen on Flutter (the route hands it
   tight constraints), so mirror that: the shell fills #app instead of
   shrinking to its content — otherwise a bottom tabBar rides up under a
   short page. */
#app > * { flex: 1 1 0%; min-height: 0; }
/* Each history entry mounts its own shell inside the host (Flutter does
   the same per Navigator route). Stretch that instance so a bottom tabBar
   stays pinned and the shell <scroll-view> is the one that scrolls. */
fjs-page-host > *,
fjs-page-entry,
fjs-page-entry > * {
  flex: 1 1 0%;
  min-height: 0;
  min-width: 0;
}
fjs-page-entry {
  display: flex;
  flex-direction: column;
}

view, scroll-view, list-view, safe-area, refresh, swiper-item,
fjs-modal-sheet, switch, checkbox, progress-bar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  min-height: 0;
  /* A Flutter Column/Row child keeps its natural size and overflows; CSS
     would shrink it to fit instead — which squeezed the padding and line
     boxes out of every row of a page one screen too long, and squashed the
     tabBar under it. A child that wants space asks with flex-grow, which
     injectStyle() turns into the Expanded it means (basis 0). */
  flex-shrink: 0;
}

text {
  display: block;
  /* template whitespace is already condensed by the Vue compiler, so
     pre-line only preserves the newlines the app itself put in a string */
  white-space: pre-line;
  min-width: 0;
  flex-shrink: 0;
  /* line-height: normal is the font's own metrics, and they differ from the
     ones Flutter would pick (and between Latin and CJK runs on the same
     page), so both adapters pin the same multiplier — widgets/text.dart. */
  line-height: 1.4;
}

/* A text inside a text is a span of the same paragraph (specs/034 §3.5) —
   the Flutter side builds it as a TextSpan (widgets/text.dart). A TextSpan
   has no margin, padding, border or size, so those are forced off here with
   !important: a page class would otherwise win on the web and do nothing on
   the app, a difference nobody would notice until it shipped. */
text text {
  display: inline !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  width: auto !important;
  height: auto !important;
  min-width: 0 !important;
}
/* Anything else in a paragraph (an image, a view) is an inline-block box on
   the line, bottom edge on the baseline — Flutter's WidgetSpan with
   PlaceholderAlignment.baseline. "text > :not(text)" alone is only (0,0,2)
   and loses to ".fjs-image { display: block }" (0,1,0), which would break the
   line — hence the second selector. Not !important: a page's display: none
   on the image must still hide it, as it does on Flutter. */
text > :not(text),
text > .fjs-image {
  display: inline-flex;
  vertical-align: baseline;
}

.fjs-canvas-box {
  /* the positioning context for the surface and whatever overlay the page
     slots in; the component sets position: relative inline, this only holds
     the box's own layout defaults */
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.fjs-canvas {
  /* a plain box: the page draws everything inside it. No background and no
     border, matching the Flutter adapter, which decorates nothing. The
     bitmap is sized in script (web/components/canvas.ts), so the element
     must not be inline — an inline canvas would sit on the text baseline
     and leave a few pixels under it. */
  display: block;
  box-sizing: border-box;
}

.fjs-image {
  display: block;
  max-width: 100%;
  box-sizing: border-box;
}

/* Scrolls along its own axis only, like the Flutter scrollable — a stray
   cross-axis scrollbar would otherwise steal a line of the page. The bars
   are hidden because Flutter's are overlays that take no layout width: a
   visible one appears and disappears with the page's length, and every tab
   switch would shift the layout sideways. */
scroll-view, list-view {
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
scroll-view::-webkit-scrollbar, list-view::-webkit-scrollbar { display: none; }
scroll-view[direction="horizontal"], list-view[direction="horizontal"] {
  flex-direction: row;
  overflow-x: auto;
  overflow-y: hidden;
}

safe-area {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}
/* edges="top bottom": only the named edges take their inset (Flutter's
   SafeArea(top:, bottom:, …) — widgets are built from the same attribute) */
safe-area[edges] { padding: 0; }
safe-area[edges~="top"] { padding-top: env(safe-area-inset-top, 0px); }
safe-area[edges~="bottom"] { padding-bottom: env(safe-area-inset-bottom, 0px); }
safe-area[edges~="left"] { padding-left: env(safe-area-inset-left, 0px); }
safe-area[edges~="right"] { padding-right: env(safe-area-inset-right, 0px); }

/* specs/052: the sticky pair. position: sticky pins within the PARENT box,
   which is the whole contract: bounds come from sticky-section, and a
   direct scroll-view child pins for the whole scroll. The Dart side mirrors
   this with pinned SliverPersistentHeaders in a SliverMainAxisGroup. The
   z-index is part of the component's own defaults (a pinned header would
   otherwise be painted over by the content that follows it in DOM order);
   it is NOT the user-level z-index, which stays unsupported on Flutter. */
sticky-section { display: block; }
sticky-header {
  display: block;
  position: sticky;
  top: 0px;
  z-index: 1;
}

divider {
  display: block;
  height: 16px;
  border: 0;
  background:
    linear-gradient(currentColor, currentColor) center / 100% 1px no-repeat;
  color: #e0e0e0;
}

.fjs-button {
  font: inherit;
  color: #007aff;
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
  text-align: center;
  min-width: 0;
  /* font: inherit would take line-height from the parent box, which is not
     the 1.4 the text tag uses — pin it so a button is the same height here
     and on Flutter (widgets/button.dart) */
  line-height: 1.4;
  position: relative;
}
.fjs-button:disabled { opacity: 0.5; cursor: default; }

/* Variants. Same numbers as widgets/button.dart: the accent follows the
   controls already shipped (#007AFF) rather than WeUI's green, while the
   press feedback below stays WeUI's 10% black mask.
   The --default rule restates the hairline the Dart side draws as its
   default border; it used to be injected per node from the HTML compat
   table (vue/renderer.ts). */
.fjs-button--default { border: 1px solid rgba(0, 0, 0, 0.16); }
.fjs-button--primary {
  background: #007aff;
  border-color: transparent;
  color: #ffffff;
}
.fjs-button--warn {
  background: #ff3b30;
  border-color: transparent;
  color: #ffffff;
}
.fjs-button--primary.fjs-button--plain {
  background: transparent;
  border-color: #007aff;
  color: #007aff;
}
.fjs-button--warn.fjs-button--plain {
  background: transparent;
  border-color: #ff3b30;
  color: #ff3b30;
}
.fjs-button--mini { padding: 6px 12px; font-size: 12px; }
/* Inert but not faded: the fade belongs to the disabled state alone. */
.fjs-button--loading { pointer-events: none; cursor: default; }
/* Flutter shows Material's CircularProgressIndicator here; the two are
   visually close but not identical (docs/web.md). */
.fjs-button-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  vertical-align: -2px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: fjs-button-spin 0.8s linear infinite;
}
@keyframes fjs-button-spin { to { transform: rotate(360deg); } }
/* Pressed state, WeUI's model: the button darkens under the finger whatever
   its own colors are (white turns grey, a filled one goes a shade down), so
   a page gets press feedback without writing any :active rule. The overlay
   is 10% black on both platforms — Material would tint with the foreground
   instead, which lightens a filled button (widgets/button.dart). */
.fjs-button:active:not(:disabled)::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: rgba(0, 0, 0, 0.1);
  pointer-events: none;
}

.fjs-input {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 8px 0;
  min-width: 0;
  line-height: 1.4;
}
/* No resize handle: Flutter has none, and a corner the user can drag on one
   platform only is a difference nobody declared. Height comes from rows
   (three lines, following the font size) or from the page's own CSS, the
   same two cases widgets/input.dart has. */
textarea.fjs-input { resize: none; overflow-y: auto; }
textarea.fjs-input.fjs-input--auto-height { overflow-y: hidden; }
/* the browsers' own placeholder greys differ from each other and from
   Flutter's hint color — pin one (widgets/input.dart uses the same).
   placeholder-style overrides these four through the variables. */
.fjs-input::placeholder {
  color: var(--fjs-placeholder-color, #999999);
  font-size: var(--fjs-placeholder-font-size, inherit);
  font-weight: var(--fjs-placeholder-font-weight, inherit);
  line-height: var(--fjs-placeholder-line-height, inherit);
  opacity: 1;
}

.fjs-switch {
  display: inline-flex;
  flex: 0 0 auto;
  align-self: center;
  width: 51px;
  height: 31px;
  padding: 2px;
  border-radius: 16px;
  background: #e5e5ea;
  transition: background 0.15s ease;
  cursor: pointer;
}
.fjs-switch.on { background: #34c759; }
.fjs-switch.disabled { opacity: 0.5; cursor: default; }
.fjs-switch-knob {
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: transform 0.15s ease;
}
.fjs-switch.on .fjs-switch-knob { transform: translateX(20px); }

/* Host is a row so a label slot sits beside the box and shares the same
   click handler. fit-content keeps an unlabeled control at 20px instead
   of stretching to the parent the way a column flex item would. */
checkbox {
  flex-direction: row;
  align-items: center;
  align-self: center;
  width: fit-content;
  gap: 8px;
  cursor: pointer;
}
checkbox.disabled { opacity: 0.5; cursor: default; }
.fjs-checkbox {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 2px solid #b0b0b0;
  border-radius: 4px;
}
.fjs-checkbox.on { background: #007aff; border-color: #007aff; }
.fjs-check {
  width: 10px;
  height: 5px;
  border-left: 2px solid #ffffff;
  border-bottom: 2px solid #ffffff;
  transform: translateY(-1px) rotate(-45deg);
}

/* swiper indicator dots. Same numbers as widgets/swiper.dart: 8px across,
   4px apart, 16px from the edge, WeUI's translucent black with a solid
   black for the current page. The vertical variant moves them down the
   right side. */
.fjs-swiper-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 16px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  pointer-events: none;
}
.fjs-swiper-dots.vertical {
  left: auto;
  right: 16px;
  top: 0;
  bottom: 0;
  flex-direction: column;
}
.fjs-swiper-dot {
  display: block;
  width: 8px;
  height: 8px;
  margin: 2px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
}
.fjs-swiper-dot.active { background: #000000; }

/* A page. Inside a swiper the component turns the page's own <swiper-item>
   into the track cell (.fjs-swiper-item below, which outranks this rule);
   only a bare child from a render function or a <slot> gets a cell of the
   component's own around it (specs/051). */
swiper-item {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
}

/* radio: the circle twin of .fjs-checkbox, same 20px box and 2px ring
   (widgets/radio.dart draws the same numbers). */
radio {
  flex-direction: row;
  align-items: center;
  align-self: center;
  width: fit-content;
  gap: 8px;
  cursor: pointer;
}
radio.disabled { opacity: 0.5; cursor: default; }
.fjs-radio {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 2px solid #b0b0b0;
  border-radius: 50%;
}
.fjs-radio.on { background: #007aff; border-color: #007aff; }
.fjs-radio.on::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffffff;
}

/* radio-group / checkbox-group / form: no chrome, they only scope their
   controls. label carries the defaults the HTML compat table used to give
   <label> (vue/renderer.ts), so an existing page looks the same. */
radio-group,
checkbox-group,
form {
  display: flex;
  flex-direction: column;
}
label {
  display: flex;
  flex-direction: column;
  margin: 4px;
  font-size: 14px;
  color: #666666;
  cursor: pointer;
}

/* picker-view: WeUI's flat wheel (spec 008 Q2). Same numbers as
   widgets/picker_view.dart — 44px rows, five of them, one hairline box in
   the middle, and the rows above and below fading out. Snapping is the
   browser's; over there it is ListWheelScrollView's. */
picker-view {
  display: block;
  position: relative;
  overflow: hidden;
  --fjs-picker-item-height: 44px;
}
.fjs-picker-body {
  display: flex;
  flex-direction: row;
  height: 100%;
}
picker-view-column {
  flex: 1 1 0;
  height: 100%;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
  /* two rows of padding top and bottom put the first and last item under
     the indicator, the way a wheel lets you reach its ends */
  padding: calc(var(--fjs-picker-item-height) * 2) 0;
  box-sizing: border-box;
  /* the fade the Flutter side paints over the wheel */
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 calc(var(--fjs-picker-item-height) * 1.4),
    #000 calc(100% - var(--fjs-picker-item-height) * 1.4),
    transparent 100%
  );
}
picker-view-column::-webkit-scrollbar { display: none; }
picker-view-column > * {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--fjs-picker-item-height);
  /* center, not start: a wheel's resting positions are "this item is in the
     middle", and with the two rows of padding above, snapping to an item's
     START would land on a different set of offsets than the ones that center
     an item — the browser quietly pulls the wheel one row off the value we
     set. */
  scroll-snap-align: center;
  font-size: 16px;
  color: #333333;
}
.fjs-picker-indicator {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: var(--fjs-picker-item-height);
  transform: translateY(-50%);
  border-top: 1px solid #e5e5ea;
  border-bottom: 1px solid #e5e5ea;
  pointer-events: none;
}

/* the sheet's bar, drawn by components/picker.ts on both platforms */
.fjs-picker-bar {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e5ea;
}
.fjs-picker-cancel { color: #888888; border: none; }
.fjs-picker-ok { color: #007aff; border: none; }

.fjs-slider { width: 100%; accent-color: #007aff; }

.fjs-progress {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 122, 255, 0.2);
  overflow: hidden;
}
.fjs-progress-fill { display: block; height: 100%; background: #007aff; }
.fjs-progress.indeterminate .fjs-progress-fill {
  width: 40%;
  animation: fjs-indeterminate 1.2s ease-in-out infinite;
}
@keyframes fjs-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
.fjs-progress-ring {
  display: block;
  width: 32px;
  height: 32px;
  border: 3px solid rgba(0, 122, 255, 0.25);
  border-top-color: #007aff;
  border-radius: 50%;
  animation: fjs-spin 0.9s linear infinite;
}
@keyframes fjs-spin { to { transform: rotate(360deg); } }

.fjs-swiper {
  display: flex;
  flex-direction: row;
  height: 200px;
  /* the dots are absolutely positioned inside the track */
  position: relative;
  /* hidden, not auto: the component scrolls the track itself (scrollLeft
     still works) so that one gesture turns exactly one page, the way a
     PageView does — a native fling would cross several. pan-y leaves the
     page's own vertical scrolling to the browser. */
  overflow: hidden;
  touch-action: pan-y;
}
/* vertical pages stack and the track scrolls down instead of across */
.fjs-swiper.vertical {
  flex-direction: column;
  touch-action: pan-x;
}
.fjs-swiper-item { flex: 0 0 100%; }
.fjs-swiper.vertical .fjs-swiper-item { flex: 0 0 100%; height: 100%; }
/* PageView hands each page a tight box, so a page's content fills the
   swiper instead of shrinking to its own height. swiper-item > * is the
   normal case; .fjs-swiper-item > * covers the wrapper the component adds
   around a bare child. */
.fjs-swiper-item > *,
swiper-item > * { flex: 1 1 0%; min-height: 0; }

.fjs-refresh { position: relative; overflow: auto; }
.fjs-refresh-hint {
  display: block;
  text-align: center;
  font-size: 12px;
  color: #999999;
  height: 0;
  overflow: hidden;
  transition: height 0.2s ease;
}
.fjs-refresh-hint.active { height: 28px; line-height: 28px; }

.fjs-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.fjs-modal-mask { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.4); }
.fjs-modal-sheet {
  position: relative;
  background: #ffffff;
  border-radius: 12px 12px 0 0;
  padding: 16px;
  max-height: 80%;
  overflow: auto;
  animation: fjs-sheet-in 0.22s ease;
}
@keyframes fjs-sheet-in { from { transform: translateY(100%); } }

/* page-container (specs/065): the fake-page overlay. --fjs-pc-dur carries
   the "duration" prop; the round prop sets border-radius inline, so the
   classes only do positioning and the transition. Mask and radius match
   widgets/page_container.dart (constitution IV). */
.fjs-page-container {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.fjs-page-container--top { justify-content: flex-start; }
.fjs-page-container--right {
  flex-direction: row;
  justify-content: flex-end;
  align-items: stretch;
}
.fjs-page-container--center {
  align-items: center;
  justify-content: center;
}
.fjs-page-container-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity var(--fjs-pc-dur, 300ms) ease;
}
.fjs-page-container.is-open .fjs-page-container-mask { opacity: 1; }
.fjs-page-container-panel {
  position: relative;
  background: #ffffff;
  overflow: auto;
  transition:
    transform var(--fjs-pc-dur, 300ms) ease,
    opacity var(--fjs-pc-dur, 300ms) ease;
}
.fjs-page-container-panel--bottom {
  width: 100%;
  max-height: 90%;
  transform: translateY(100%);
}
.fjs-page-container-panel--top {
  width: 100%;
  max-height: 90%;
  transform: translateY(-100%);
}
.fjs-page-container-panel--right {
  height: 100%;
  max-width: 85%;
  transform: translateX(100%);
}
.fjs-page-container-panel--center {
  max-width: 80%;
  max-height: 80%;
  opacity: 0;
}
.fjs-page-container.is-open .fjs-page-container-panel--bottom { transform: none; }
.fjs-page-container.is-open .fjs-page-container-panel--top { transform: none; }
.fjs-page-container.is-open .fjs-page-container-panel--right { transform: none; }
.fjs-page-container.is-open .fjs-page-container-panel--center { opacity: 1; }

/* page transition (web mirror of the native push animation). The host
   gives the leaving page something to be absolutely positioned against, so
   the two pages overlap for the length of the crossfade instead of
   stacking. */
fjs-page-host {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex-grow: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
/* While a transition runs both pages are laid over the host, and which one
   is on top is the *direction*, not the family: a push brings the new page
   in over the old one, a pop uncovers the old one by sliding the top one
   off. Written against the entry element so an app's own family gets the
   same stacking (Vue always names the classes this way). Without it the
   leaving page — the only positioned one — painted above whatever was
   arriving, and a full-width slide looked backwards. */
fjs-page-entry[class*="-enter-active"],
fjs-page-entry[class*="-leave-active"] {
  position: absolute;
  inset: 0;
}
fjs-page-entry[class*="-enter-active"] { z-index: 1; }
fjs-page-entry[class*="-leave-active"] { z-index: 0; }
fjs-page-host[data-nav="pop"] fjs-page-entry[class*="-enter-active"] { z-index: 0; }
fjs-page-host[data-nav="pop"] fjs-page-entry[class*="-leave-active"] { z-index: 1; }

.fjs-page-enter-active, .fjs-page-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.fjs-page-enter-from { transform: translateX(16px); opacity: 0; }
.fjs-page-leave-to { transform: translateX(-8px); opacity: 0; }

/* The named families a page or an app can pick (fjs/router's TRANSITIONS);
   each one is also a page route on the Dart side, so the same name is the
   same animation on web, iOS and Android. */
.fjs-slide-enter-active, .fjs-slide-leave-active,
.fjs-fade-enter-active, .fjs-fade-leave-active,
.fjs-slide-up-enter-active, .fjs-slide-up-leave-active,
.fjs-zoom-enter-active, .fjs-zoom-leave-active {
  transition: transform 0.28s cubic-bezier(0.2, 0, 0, 1), opacity 0.28s ease;
}
/* iOS-style: the arriving page covers, the leaving one trails a third of
   the way (the parallax UIKit does) */
.fjs-slide-enter-from { transform: translateX(100%); }
.fjs-slide-leave-to { transform: translateX(-30%); }
fjs-page-host[data-nav="pop"] .fjs-slide-enter-from { transform: translateX(-30%); }
fjs-page-host[data-nav="pop"] .fjs-slide-leave-to { transform: translateX(100%); }

.fjs-fade-enter-from, .fjs-fade-leave-to { opacity: 0; }

.fjs-slide-up-enter-from { transform: translateY(100%); }
.fjs-slide-up-leave-to { opacity: 0; }
fjs-page-host[data-nav="pop"] .fjs-slide-up-enter-from {
  transform: none;
  opacity: 0;
}
fjs-page-host[data-nav="pop"] .fjs-slide-up-leave-to {
  transform: translateY(100%);
  opacity: 1;
}

.fjs-zoom-enter-from { transform: scale(0.92); opacity: 0; }
.fjs-zoom-leave-to { transform: scale(1.06); opacity: 0; }
fjs-page-host[data-nav="pop"] .fjs-zoom-enter-from { transform: scale(1.06); }
fjs-page-host[data-nav="pop"] .fjs-zoom-leave-to { transform: scale(0.92); }

/* Going back is the same animation mirrored, so a pop reads as a pop and
   not as another push. Keyed off the host's data-nav and not off a second
   transition name on purpose: <KeepAlive> gives a page it brings back the
   hooks it was cached with, so the *name* on the page you return to can be
   one navigation stale. The attribute is plain DOM state — both pages see
   the current one. */
fjs-page-host[data-nav="pop"] .fjs-page-enter-from {
  transform: translateX(-8px);
}
fjs-page-host[data-nav="pop"] .fjs-page-leave-to {
  transform: translateX(16px);
}

/* No animation (a tab switch, or a page/app that turned it off). The
   <Transition> is still there — taking it out around <KeepAlive> would
   remount the page — so the leaving page only has to get out of the way
   for the one frame it is still mounted. */
.fjs-page-none-leave-active { opacity: 0; }
/* ...and cancels whatever family's classes a page brings with it. The
   entering page can be one navigation stale (KeepAlive caches the hooks
   with it), so this is written against the page host element rather than
   any one family's class names. */
fjs-page-host[data-nav="none"] fjs-page-entry {
  transition: none !important;
  transform: none !important;
  opacity: 1 !important;
}
fjs-page-host[data-nav="none"] fjs-page-entry.fjs-page-none-leave-active {
  opacity: 0 !important;
}

.fjs-toast {
  position: fixed;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  max-width: 80vw;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(34, 34, 34, 0.8);
  color: #ffffff;
  font-size: 14px;
  z-index: 10000;
  pointer-events: none;
}
`;

/** Injects [BASE_CSS] once per document. */
export function installBaseCss(doc: Document = document): void {
  const id = 'fjs-base-css';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = BASE_CSS;
  doc.head.appendChild(style);
}
