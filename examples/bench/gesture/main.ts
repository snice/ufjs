// Per-frame cost of a gesture-driven :style update: VDOM vs Vapor.
// One dragged cell out of 9 (dnd.vue's shape); each step writes dx / dy,
// flushes, and the op frame is encoded. Median of 7 passes × 200 steps.
import { defineComponent, h, reactive } from 'vue';
import { createComponent, createVaporApp, defineVaporComponent } from 'fjs/vapor';
import { createApp, flutterRoot } from 'fjs/vue';
import { flush, nowMs, setOpSink } from 'fjs';
import Vdom from './GestureVdom.vue';
import Vapor from './GestureVapor.vue';

const hostSink = setOpSink((f) => hostSink(f));
const drain = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

async function measure(label: string, st: { dx: number; dy: number }): Promise<void> {
  const STEPS = 200;
  const xs: number[] = [];
  for (let pass = 0; pass <= 7; pass++) {
    const t0 = nowMs();
    for (let s = 0; s < STEPS; s++) {
      st.dx = s;
      st.dy = s * 0.5;
      await drain();
    }
    if (pass > 0) xs.push((nowMs() - t0) / STEPS);
  }
  xs.sort((a, b) => a - b);
  console.log(`[gesture] ${label} ${(xs[xs.length >> 1] * 1000).toFixed(0)} µs/step  (min ${(xs[0] * 1000).toFixed(0)} max ${(xs[xs.length - 1] * 1000).toFixed(0)})`);
}

async function main(): Promise<void> {
  const a = reactive({ dx: 0, dy: 0, from: 4 });
  createApp(defineComponent({ setup: () => () => h(Vdom, a) })).mount(flutterRoot());
  const b = reactive({ dx: 0, dy: 0, from: 4 });
  createVaporApp(defineVaporComponent({
    setup: () => createComponent(Vapor, { dx: () => b.dx, dy: () => b.dy, from: () => b.from }),
  })).mount(flutterRoot());
  await drain();
  for (let round = 0; round < 2; round++) {
    await measure('vdom ', a);
    await measure('vapor', b);
  }
}

main().catch((e) => console.log(`[gesture] failed: ${String(e)}\n${e?.stack}`));
