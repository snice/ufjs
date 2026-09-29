// specs/153: which subtrees the Flutter build compiles to fjsTemplate blocks,
// through the options the esbuild plugin passes to compileTemplate. A block
// taken where it should not be loses whatever the block cannot carry
// (events, bindings, fallthrough attrs) without an error anywhere.
import { describe, expect, it } from 'vitest';
import { compileTemplate } from '@vue/compiler-sfc';
import { templateCompilerOptions } from '../src/bundler/vue-plugin';

function compile(source: string, web = false): string {
  const tpl = compileTemplate({
    source,
    filename: 'blocks.vue',
    id: 'data-v-test',
    compilerOptions: templateCompilerOptions({ web, bindings: { n: 'setup-ref', on: 'setup-const', show: 'props' } }),
  });
  expect(tpl.errors).toEqual([]);
  return tpl.code;
}

const templates = (code: string) => [...code.matchAll(/_fjsTemplate\((.*)\)$/gm)].map((m) => JSON.parse(m[1]));

describe('clone blocks', () => {
  it("compiles flat-4050's cell to one vnode with its text as `t`", () => {
    const code = compile(`<view><view v-for="r in 50" :key="r" class="row"><view v-for="(_, i) in 40" :key="i" class="cell"><text class="tiny">{{ i }}</text></view></view></view>`);
    expect(code).toContain('import {');
    expect(code).toMatch(/fjsTemplate as _fjsTemplate/);
    expect(templates(code)).toEqual([[[-1, 'view', 'cell', ''], [0, 'text', 'tiny', null]]]);
    expect(code).toMatch(/_createVNode\(_hoisted_1, \{\s*key: i,\s*t: _toDisplayString\(i\)\s*\}, null, 8 \/\* PROPS \*\/, \["t"\]\)/);
    // the row holds a v-for: not a block itself
    expect(code).toContain('_createElementVNode("view", {');
  });

  it('merges mixed text into one slot and keeps static text in the table', () => {
    const code = compile(`<view><view class="a"><text>x {{ n }}</text><text>s</text></view></view>`);
    expect(templates(code)).toEqual([[[-1, 'view', 'a', ''], [0, 'text', null, null], [0, 'text', null, 's']]]);
    expect(code).toContain('t: "x " + _toDisplayString($setup.n)');
  });

  it('several slots go in an array, in pre-order', () => {
    const code = compile(`<view><view><text>{{ n }}</text><text>{{ n + 1 }}</text></view></view>`);
    expect(code).toMatch(/t: \[_toDisplayString\(\$setup\.n\), _toDisplayString\(\$setup\.n \+ 1\)\]/);
  });

  it('a fully static block has no props and no patch flag', () => {
    const code = compile(`<view><view class="a"><text>s</text></view></view>`);
    expect(code).toMatch(/_createVNode\(_hoisted_1\)/);
  });

  it('a v-if branch keeps its key', () => {
    const code = compile(`<view><view v-if="show" class="a"><text>s</text></view><text v-else>no</text></view>`);
    expect(code).toMatch(/_createBlock\(_hoisted_1, \{ key: 0 \}\)/);
  });

  it.each([
    ['an event', `<view><view @tap="on"><text>s</text></view></view>`],
    ['a binding', `<view><view :id="n"><text>s</text></view></view>`],
    ['a static attribute', `<view><view><text id="x">s</text></view></view>`],
    ['style', `<view><view style="color:red"><text>s</text></view></view>`],
    ['a ref', `<view><view ref="r"><text>s</text></view></view>`],
    ['a directive', `<view><view v-show="show"><text>s</text></view></view>`],
    ['a key below the block root', `<view><view><text key="k">s</text></view></view>`],
    ['a component', `<view><view><Foo /></view></view>`],
    ['a slot', `<view><view><slot /></view></view>`],
    ['v-if inside', `<view><view><text v-if="show">s</text></view></view>`],
    ['text between elements', `<view><view>a<text>s</text></view></view>`],
  ])('leaves a subtree with %s alone', (_, source) => {
    expect(compile(source)).not.toContain('_fjsTemplate');
  });

  it('never makes the template root (or a root v-if branch) a block', () => {
    expect(compile(`<view class="a"><text>{{ n }}</text></view>`)).not.toContain('_fjsTemplate');
    expect(compile(`<view v-if="show" class="a"><text>s</text></view><view v-else><text>t</text></view>`)).not.toContain('_fjsTemplate');
  });

  it('a lone element is not worth a block', () => {
    expect(compile(`<view><text class="a">{{ n }}</text></view>`)).not.toContain('_fjsTemplate');
  });

  it('the web build does not use blocks', () => {
    expect(compile(`<view><view class="a"><text>s</text></view></view>`, true)).not.toContain('_fjsTemplate');
  });
});
