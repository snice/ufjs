// Offline smoke for the watermark replica (specs/135):
//
//   pnpm --filter demo run build:wm-smoke   (fjs build bench/wm-smoke.ts --out dist/wm-smoke)
//   ../packages/flutter_fjs/native/build-native/fjsrun --pump 500 dist/wm-smoke/app/bundle.js
//
// Mounts the vant-watermark page in a fresh VM under fjsrun — no Flutter. The
// tiling needs a measured rect, which the null host never reports, so this
// asserts the part that must not misbehave off-device: page/module eval,
// plugin + style registration (the vant watermark CSS rides the plugin list),
// mount/unmount, and the bounded rAF retry giving up quietly instead of
// spinning forever on a rect that never arrives.
import { createApp, flutterRoot } from 'fjs/vue';
import { flushNow, setOpSink } from 'fjs';
import { plugins } from 'fjs/plugins';
import VantWatermark from '../src/pages/vant/watermark.vue';

let frameBytes = 0;
setOpSink((frame: Uint8Array) => {
  frameBytes += frame.byteLength;
});

const root = flutterRoot('view');
const app = createApp(VantWatermark);
for (const plugin of plugins) plugin(app as never);
app.mount(root);
flushNow();
app.unmount();
flushNow();

if (frameBytes === 0) {
  console.error('[wm-smoke] FAIL: no op frames produced');
} else {
  console.log(`[wm-smoke] ok — mount/unmount clean, ${frameBytes} op bytes`);
}
