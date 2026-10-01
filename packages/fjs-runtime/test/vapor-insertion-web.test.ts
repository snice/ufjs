// @vitest-environment happy-dom
// specs/169 on the web (DOM) backend: a trailing block's numeric insertion
// anchor means "append", not "before raw child N" — an earlier v-if's anchor
// and branch nodes must not shift where a later v-for / component lands.
import { describe, expect, it } from 'vitest';
import { compileSfc } from './helpers/sfc';
import { CHILD, INSERTION_CASES, initialState, type InsertionState } from './helpers/vapor-insertion-cases';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('vapor insertion anchors (web)', () => {
  for (const c of INSERTION_CASES) {
    it(c.name, async () => {
      const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown> & {
        reactive: <T extends object>(v: T) => T;
        createVaporApp: (comp: unknown) => { mount(el: Element): void };
      };
      const st = vue.reactive(initialState()) as InsertionState;
      const child = compileSfc(CHILD, { vapor: true, runtime: vue });
      const page = compileSfc(c.source, { vapor: true, runtime: vue, imports: { st, child: child.component } });
      const div = document.createElement('div');
      vue.createVaporApp(page.component).mount(div);
      expect(div.textContent).toBe(c.mount);
      for (const step of c.steps) {
        step.run(st);
        await settle();
        expect(div.textContent).toBe(step.text);
      }
    });
  }
});
