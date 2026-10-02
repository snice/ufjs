// specs/150: every hello-fjs page mounted under both style engines at once
// (`__fjsNativeStyle = 'verify'`): each element libfjs-style styles
// differently from the TS engine is logged, and the totals print at the end.
// Pages that need the router or a device capability throw here and are
// reported as such. Generated list — regenerate when pages are added.
//   npx fjs build bench/verify-pages.ts --ts-style --out dist/verify-pages
//   fjsrun --frames --pump 300 dist/verify-pages/app/bundle.js
import './style-verify';
import type { Component } from 'vue';
import { createApp, flutterRoot, styleEngine } from 'fjs/vue';
import { flushNow } from 'fjs';
import { plugins } from 'fjs/plugins';
import { FjsDefer } from 'fjs/app';
import P0 from '../src/pages/about.vue';
import P1 from '../src/pages/api.vue';
import P2 from '../src/pages/api/fetch.vue';
import P3 from '../src/pages/api/runtime.vue';
import P4 from '../src/pages/comp/basic/divider.vue';
import P5 from '../src/pages/comp/basic/image.vue';
import P6 from '../src/pages/comp/basic/progress.vue';
import P7 from '../src/pages/comp/basic/rich-text.vue';
import P8 from '../src/pages/comp/basic/text.vue';
import P9 from '../src/pages/comp/canvas/canvas.vue';
import P10 from '../src/pages/comp/container/list-view.vue';
import P11 from '../src/pages/comp/container/page-container.vue';
import P12 from '../src/pages/comp/container/position.vue';
import P13 from '../src/pages/comp/container/safe-area.vue';
import P14 from '../src/pages/comp/container/scroll-view.vue';
import P15 from '../src/pages/comp/container/sticky.vue';
import P16 from '../src/pages/comp/container/swiper.vue';
import P17 from '../src/pages/comp/container/view.vue';
import P18 from '../src/pages/comp/feedback/modal.vue';
import P19 from '../src/pages/comp/feedback/refresh.vue';
import P20 from '../src/pages/comp/feedback/toast.vue';
import P21 from '../src/pages/comp/form/button.vue';
import P22 from '../src/pages/comp/form/checkbox.vue';
import P23 from '../src/pages/comp/form/form.vue';
import P24 from '../src/pages/comp/form/input.vue';
import P25 from '../src/pages/comp/form/picker.vue';
import P26 from '../src/pages/comp/form/picker-view.vue';
import P27 from '../src/pages/comp/form/radio.vue';
import P28 from '../src/pages/comp/form/slider.vue';
import P29 from '../src/pages/comp/form/switch.vue';
import P30 from '../src/pages/comp/form/textarea.vue';
import P31 from '../src/pages/comp/web/web-view.vue';
import P32 from '../src/pages/example.vue';
import P33 from '../src/pages/example/animation/anime.vue';
import P34 from '../src/pages/example/animation/motion.vue';
import P35 from '../src/pages/example/animation/shared-element.vue';
import P36 from '../src/pages/example/animation/shared-element-detail.vue';
import P37 from '../src/pages/example/canvas/echarts.vue';
import P38 from '../src/pages/example/canvas/f2.vue';
import P39 from '../src/pages/example/canvas/gltf-viewer.vue';
import P40 from '../src/pages/example/canvas/pelican.vue';
import P41 from '../src/pages/example/canvas/spine.vue';
import P42 from '../src/pages/example/canvas/three-gltf.vue';
import P43 from '../src/pages/example/canvas/webgl.vue';
import P44 from '../src/pages/example/canvas/webgl-instanced.vue';
import P45 from '../src/pages/example/game/2048.vue';
import P46 from '../src/pages/example/game/flappy-bird.vue';
import P47 from '../src/pages/example/game/gomoku.vue';
import P48 from '../src/pages/example/game/jump.vue';
import P49 from '../src/pages/example/game/leafer-match3.vue';
import P50 from '../src/pages/example/game/match3.vue';
import P51 from '../src/pages/example/game/shooter.vue';
import P52 from '../src/pages/example/game/tetris.vue';
import P53 from '../src/pages/example/game/watermelon.vue';
import P54 from '../src/pages/example/interaction/async-host.vue';
import P55 from '../src/pages/example/interaction/dnd.vue';
import P56 from '../src/pages/example/interaction/drag.vue';
import P57 from '../src/pages/example/interaction/flat-4050.vue';
import P58 from '../src/pages/example/interaction/page-settled.vue';
import P59 from '../src/pages/example/interaction/theme.vue';
import P60 from '../src/pages/example/style/percent.vue';
import P61 from '../src/pages/example/style/percent-spacing.vue';
import P62 from '../src/pages/example/style/pseudo.vue';
import P63 from '../src/pages/example/style/responsive.vue';
import P64 from '../src/pages/example/style/transition.vue';
import P65 from '../src/pages/index.vue';

const PAGES: [string, Component][] = [
  ['about', P0],
  ['api', P1],
  ['api/fetch', P2],
  ['api/runtime', P3],
  ['comp/basic/divider', P4],
  ['comp/basic/image', P5],
  ['comp/basic/progress', P6],
  ['comp/basic/rich-text', P7],
  ['comp/basic/text', P8],
  ['comp/canvas/canvas', P9],
  ['comp/container/list-view', P10],
  ['comp/container/page-container', P11],
  ['comp/container/position', P12],
  ['comp/container/safe-area', P13],
  ['comp/container/scroll-view', P14],
  ['comp/container/sticky', P15],
  ['comp/container/swiper', P16],
  ['comp/container/view', P17],
  ['comp/feedback/modal', P18],
  ['comp/feedback/refresh', P19],
  ['comp/feedback/toast', P20],
  ['comp/form/button', P21],
  ['comp/form/checkbox', P22],
  ['comp/form/form', P23],
  ['comp/form/input', P24],
  ['comp/form/picker', P25],
  ['comp/form/picker-view', P26],
  ['comp/form/radio', P27],
  ['comp/form/slider', P28],
  ['comp/form/switch', P29],
  ['comp/form/textarea', P30],
  ['comp/web/web-view', P31],
  ['example', P32],
  ['example/animation/anime', P33],
  ['example/animation/motion', P34],
  ['example/animation/shared-element', P35],
  ['example/animation/shared-element-detail', P36],
  ['example/canvas/echarts', P37],
  ['example/canvas/f2', P38],
  ['example/canvas/gltf-viewer', P39],
  ['example/canvas/pelican', P40],
  ['example/canvas/spine', P41],
  ['example/canvas/three-gltf', P42],
  ['example/canvas/webgl', P43],
  ['example/canvas/webgl-instanced', P44],
  ['example/game/2048', P45],
  ['example/game/flappy-bird', P46],
  ['example/game/gomoku', P47],
  ['example/game/jump', P48],
  ['example/game/leafer-match3', P49],
  ['example/game/match3', P50],
  ['example/game/shooter', P51],
  ['example/game/tetris', P52],
  ['example/game/watermelon', P53],
  ['example/interaction/async-host', P54],
  ['example/interaction/dnd', P55],
  ['example/interaction/drag', P56],
  ['example/interaction/flat-4050', P57],
  ['example/interaction/page-settled', P58],
  ['example/interaction/theme', P59],
  ['example/style/percent', P60],
  ['example/style/percent-spacing', P61],
  ['example/style/pseudo', P62],
  ['example/style/responsive', P63],
  ['example/style/transition', P64],
  ['index', P65],
];

async function settle(): Promise<void> {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
    flushNow();
  }
}

async function main(): Promise<void> {
  for (const [name, page] of PAGES) {
    const before = styleEngine.verifyStats;
    let note = '';
    try {
      const app = createApp(page);
      app.component('defer', FjsDefer);
      for (const plugin of plugins) plugin(app as never);
      app.config.errorHandler = (e) => {
        note ||= ` (threw: ${String((e as Error)?.message ?? e).slice(0, 60)})`;
      };
      app.mount(flutterRoot('view'));
      await settle();
      app.unmount();
      await settle();
    } catch (e) {
      note ||= ` (threw: ${String((e as Error)?.message ?? e).slice(0, 60)})`;
    }
    const after = styleEngine.verifyStats;
    console.log(`[verify] ${name.padEnd(36)} compared ${after.compared - before.compared} mismatched ${after.mismatched - before.mismatched}${note}`);
  }
  console.log(`[verify] total ${JSON.stringify(styleEngine.verifyStats)}`);
}

void main();
