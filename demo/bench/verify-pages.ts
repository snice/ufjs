// specs/150: every demo page mounted under both style engines at once
// (`__fjsNativeStyle = 'verify'`): each element libfjs-style styles
// differently from the TS engine is logged, and the totals print at the end.
//   fjs build bench/verify-pages.ts --out dist/verify-pages
//   fjsrun --frames --pump 200 dist/verify-pages/app/bundle.js
import './style-verify';
import type { Component } from 'vue';
import { createApp, flutterRoot, styleEngine } from 'fjs/vue';
import { flushNow } from 'fjs';
import { plugins } from 'fjs/plugins';
import { FjsDefer } from 'fjs/app';
import Index from '../src/pages/index.vue';
import About from '../src/pages/basic/about.vue';
import Fetch from '../src/pages/basic/fetch.vue';
import Icons from '../src/pages/basic/icons.vue';
import Dnd from '../src/pages/interaction/dnd.vue';
import Drag from '../src/pages/interaction/drag.vue';
import NutBasic from '../src/pages/nutui/basic.vue';
import NutButton from '../src/pages/nutui/button.vue';
import VantBasic from '../src/pages/vant/basic.vue';
import VantFeedback from '../src/pages/vant/feedback.vue';
import VantFloat from '../src/pages/vant/float.vue';
import VantForm from '../src/pages/vant/form.vue';
import VantMore from '../src/pages/vant/more.vue';
import VantNav from '../src/pages/vant/nav.vue';
import VantVapor from '../src/pages/vant/vapor.vue';
import VantWatermark from '../src/pages/vant/watermark.vue';

const PAGES: [string, Component][] = [
  ['index', Index], ['basic/about', About], ['basic/fetch', Fetch], ['basic/icons', Icons],
  ['interaction/dnd', Dnd], ['interaction/drag', Drag], ['nutui/basic', NutBasic], ['nutui/button', NutButton],
  ['vant/basic', VantBasic], ['vant/feedback', VantFeedback], ['vant/float', VantFloat], ['vant/form', VantForm],
  ['vant/more', VantMore], ['vant/nav', VantNav], ['vant/vapor', VantVapor], ['vant/watermark', VantWatermark],
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
    const app = createApp(page);
    app.component('defer', FjsDefer);
    for (const plugin of plugins) plugin(app as never);
    try {
      app.mount(flutterRoot('view'));
      await settle();
      app.unmount();
      await settle();
    } catch (e) {
      console.log(`[verify] ${name}: threw ${String((e as Error)?.message ?? e)}`);
    }
    const after = styleEngine.verifyStats;
    console.log(`[verify] ${name.padEnd(18)} compared ${after.compared - before.compared} mismatched ${after.mismatched - before.mismatched}`);
  }
  console.log(`[verify] total ${JSON.stringify(styleEngine.verifyStats)}`);
}

void main();
