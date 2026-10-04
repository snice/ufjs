// specs/203: every NEW demo page mounted headlessly under fjsrun, one after
// another, each with its own Vue error handler — a page whose setup/render
// throws prints "FAIL <name>" and the process exits non-zero.
//   fjs build bench/pages-203.ts --out dist/pages-203
//   ../packages/flutter_fjs/native/build-native/fjsrun --pump 300 dist/pages-203/app/bundle.js
import type { Component } from 'vue';
import { createApp, flutterRoot } from 'fjs/vue';
import { flushNow } from 'fjs';
import { plugins } from 'fjs/plugins';
import NutBasic from '../src/pages/nutui/basic.vue';
import NutButton from '../src/pages/nutui/button.vue';
import NutForm from '../src/pages/nutui/form.vue';
import NutDisplay from '../src/pages/nutui/display.vue';
import NutNav from '../src/pages/nutui/nav.vue';
import NutFloat from '../src/pages/nutui/float.vue';
import NutVapor from '../src/pages/nutui/vapor.vue';
import VantPickers from '../src/pages/vant/pickers.vue';
import VantScroll from '../src/pages/vant/scroll.vue';
import VantVapor from '../src/pages/vant/vapor.vue';

const PAGES: [string, Component][] = [
  // specs/139 pages first: a registration dropped from plugins/nutui.ts
  // shows up as a missing component here before it shows up in the app
  ['nutui/basic', NutBasic],
  ['nutui/button', NutButton],
  ['nutui/form', NutForm],
  ['nutui/display', NutDisplay],
  ['nutui/nav', NutNav],
  ['nutui/float', NutFloat],
  ['nutui/vapor', NutVapor],
  ['vant/pickers', VantPickers],
  ['vant/scroll', VantScroll],
  ['vant/vapor (extended)', VantVapor],
];

async function settle(): Promise<void> {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
    flushNow();
  }
}

async function main(): Promise<void> {
  let failures = 0;
  for (const [name, page] of PAGES) {
    const errors: string[] = [];
    const app = createApp(page);
    app.config.errorHandler = (err: unknown, _i: unknown, info: string) => {
      errors.push(`${info}: ${err instanceof Error ? err.message : String(err)}`);
    };
    for (const plugin of plugins) plugin(app as never);
    try {
      app.mount(flutterRoot('view'));
      await settle();
    } catch (e) {
      errors.push(`mount threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    // unmount + settle so the next page starts from a clean host
    app.unmount();
    await settle();
    if (errors.length) {
      failures++;
      console.log(`FAIL ${name}: ${errors.join(' | ')}`);
    } else {
      console.log(`PASS ${name}`);
    }
  }
  console.log(failures ? `pages-203: ${failures} FAILED` : 'pages-203: all passed');
  if (failures) throw new Error(`${failures} pages failed`);
}
main().catch((e) => console.error(String(e?.stack ?? e)));
