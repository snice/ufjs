// The app build must NOT hoist static vnodes: their Static form mounts via
// the renderer's insertStaticContent, a DOM-innerHTML contract a non-DOM
// host node cannot implement (specs/070 — vant-feedback died at
// mountStaticNode with "not a function" and rendered blank, no error
// anywhere; the device stack trace is the ground truth for real-world SFCs
// reaching that path). Like the tag decision, a change here is silent, so
// the compiler options are pinned through the shared factory the esbuild
// plugin actually passes to compileTemplate.
import { describe, expect, it } from 'vitest';
import { compileTemplate } from '@vue/compiler-sfc';
import { templateCompilerOptions } from '../src/bundler/vue-plugin';

const TEMPLATE = `
  <view class="page">
    <text class="title">静态标题</text>
    <text>静态子树一</text>
    <text>静态子树二</text>
    <text class="echo">{{ dynamic }}</text>
  </view>
`;

function compile(web: boolean): string {
  const tpl = compileTemplate({
    source: TEMPLATE,
    filename: 'static-probe.vue',
    id: 'data-v-test',
    compilerOptions: templateCompilerOptions({
      web,
      bindings: { dynamic: 'setup-ref' },
    }),
  });
  expect(tpl.errors).toEqual([]);
  return tpl.code;
}

describe('templateCompilerOptions: no hoisting on the app build', () => {
  it('the flag lives in the shared factory: false for the app, true for web', () => {
    expect(templateCompilerOptions({}).hoistStatic).toBe(false);
    expect(templateCompilerOptions({ web: true }).hoistStatic).toBe(true);
  });

  it('app build: nothing is hoisted into the render cache', () => {
    // No hoisting at all strictly implies no Static vnodes, which is what
    // mountStaticNode would choke on. (Whether compiler-dom's
    // stringifyStatic merges a given tree into createStaticVNode depends on
    // its chunk thresholds; this assertion is threshold-independent.)
    expect(compile(false)).not.toContain('_cache[');
  });

  it('web build keeps hoisting (the DOM renderer implements it)', () => {
    // Proves the flag actually flips behavior — if this ever fails because
    // vue stopped caching, the pin above still holds, but re-think what the
    // app assertion should watch instead.
    expect(compile(true)).toContain('_cache[');
  });
});
