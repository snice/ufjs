// Compiler tests for the mini-program target: template -> WXML codegen,
// script injection, and the scoped-CSS rewrite. These pin the semantics the
// hello-fjs corpus relies on (spec 046 §6.3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { genWxml, rewriteExpr, freeScopeIdentifiers, referencedBindings } from '../src/mp/wxml.js';
import { genScriptCode } from '../src/mp/script.js';
import { genWxss, replaceScopeAttr } from '../src/mp/css.js';
import { Emitter, rewriteImports } from '../src/mp/build.js';
import { appJson, componentJson, copyRuntimeComponents, projectConfigJson } from '../src/mp/project.js';

const BINDINGS: Record<string, string> = {
  wifi: 'setup-ref',
  count: 'setup-ref',
  items: 'setup-ref',
  toggle: 'setup-const',
  router: 'setup-maybe-ref',
  title: 'setup-props',
  tabs: 'setup-const',
};

function compile(template: string, bindings = BINDINGS, heightClasses?: Set<string>) {
  return genWxml(template, {
    bindings,
    vueImports: new Map([['Panel', '/x/Panel.vue']]),
    filename: 'test.vue',
    scopeId: 'data-v-test',
    heightClasses,
  });
}

let warn: string[] = [];
beforeEach(() => {
  warn = [];
  vi.spyOn(console, 'warn').mockImplementation((m: string) => warn.push(m));
});
afterEach(() => {
  (console.warn as ReturnType<typeof vi.fn>).mockRestore();
});

describe('genWxml', () => {
  it('passes fjs tags through and stamps the scope class', () => {
    const r = compile('<view><text>{{ title }}</text></view>');
    expect(r.wxml).toContain('<view class="fjs-box data-v-test">');
    // text runs sit inline: indentation inside <text> renders as blank lines
    expect(r.wxml).toContain('<text class="fjs-text data-v-test">{{ title }}</text>');
    expect(r.dataNames).toEqual(['title']);
  });

  it('merges static + dynamic class and keeps the scope class last', () => {
    const r = compile('<view class="a" :class="{ b: count > 1 }" />');
    expect(r.wxml).toContain(
      'class="fjs-box a {{ (count > 1 ? \'b \' : \'\') }} data-v-test"',
    );
  });

  it('expands object :class inline so v-for scope vars survive', () => {
    const r = compile(
      '<view v-for="(item, i) in items" :key="item.id" :class="{ on: i === 0 }">{{ item.name }}</view>',
    );
    // the list is projected to the properties the template reads (see the
    // "v-for list projection" block below)
    expect(r.wxml).toContain('wx:for="{{ __l0 }}"');
    expect(r.setupCode.join('\n')).toContain('__fjsProject(items.value, ["name", "id"])');
    expect(r.wxml).toContain('wx:for-item="item"');
    expect(r.wxml).toContain('wx:key="id"');
    expect(r.wxml).toContain('(i === 0 ? \'on \' : \'\')');
    expect(r.wxml).toContain('{{ item.name }}');
  });

  it('flattens a multi-line object literal and drops its trailing comma', () => {
    // wxml attribute values are one line and its parser has no trailing
    // commas, but both are ordinary in a Vue template
    const r = compile(`<view v-for="(s, i) in rows" :key="s.name" :variants="{
        initial: { x: 0 },
        right: { x: 100, transition: { stiffness: s.stiffness } },
      }" />`);
    expect(r.wxml).toContain(
      `variants="{{ { initial: { x: 0 }, right: { x: 100, transition: { stiffness: s.stiffness } } } }}"`,
    );
    expect(r.wxml).not.toContain('\n      ');
  });

  it('keeps whitespace inside strings when flattening', () => {
    const r = compile(`<view :data-a="{
        label: 'a  b',
      }" />`);
    expect(r.wxml).toContain(`data-a="{{ { label: 'a  b' } }}"`);
  });

  it('converts template literals in :class to concatenation', () => {
    const r = compile('<view :class="`slide-${i + 1}`" />');
    expect(r.wxml).toContain("'slide-' + (i + 1)");
  });

  it('compiles v-if / v-else-if / v-else chains to wx:if / wx:elif / wx:else', () => {
    const r = compile(
      '<view><text v-if="wifi">a</text><text v-else-if="count">b</text><text v-else>c</text></view>',
    );
    expect(r.wxml).toContain('wx:if="{{ wifi }}"');
    expect(r.wxml).toContain('wx:elif="{{ count }}"');
    expect(r.wxml).toContain('wx:else');
  });

  it('rewrites v-show to hidden', () => {
    const r = compile('<view v-show="wifi" />');
    expect(r.wxml).toContain('hidden="{{ !(wifi) }}"');
  });

  it('extracts inline arrow handlers; free non-loop scope names ride data-args', () => {
    const r = compile('<view @tap="() => router.push(item.path)" />', BINDINGS);
    expect(r.wxml).toContain('bindtap="__fjsCall"');
    expect(r.wxml).toContain('data-fn="__ev0"');
    expect(r.wxml).toContain('data-args="{{ [item] }}"');
    expect(r.setupCode[0]).toBe(
      'const __ev0 = (__e, ...__s) => { const [item] = __s; return (() => router.push(item.path))(); };',
    );
  });

  it('inside v-for a handler gets loop indexes and looks the reactive items up', () => {
    const r = compile(
      '<view v-for="row in items" :key="row.id"><view v-for="cell in row.cells" :key="cell.id" @tap="() => pick(row, cell)" /></view>',
      { ...BINDINGS, pick: 'setup-const' },
    );
    expect(r.wxml).toContain('data-args="{{ [index, __i1] }}"');
    const code = r.setupCode.join('\n');
    expect(code).toContain('const [index, __i1] = __s;');
    expect(code).toContain("const row = typeof (items.value) === 'number' ? index + 1 : (items.value)[index];");
    expect(code).toContain("const cell = typeof (row.cells) === 'number' ? __i1 + 1 : (row.cells)[__i1];");
  });

  it('generates the payload-first handler shape for typed arrows', () => {
    const r = compile('<switch @change="(v: string) => (wifi = v === \'1\')" />');
    expect(r.wxml).toContain('bindchange="__fjsCall"');
    expect(r.setupCode[0]).toBe(
      'const __ev0 = (__e, ...__s) => { return ((v: string) => (wifi.value = v === \'1\'))(__e); };',
    );
  });

  it('maps inline handlers onto wx-native event names and tags', () => {
    const r = compile('<swiper @page-changed="toggle" />');
    expect(r.wxml).toContain('bindchange="__fjsCall"');
    // dispatch is by e.type — no data-ev attribute at all
    expect(r.wxml).toContain('data-tag="swiper"');
    expect(r.wxml).not.toContain('data-ev');
  });

  it('rejects a swiper child that is not a swiper-item (specs/051)', () => {
    expect(() => compile('<swiper>\n  <view v-for="s in items" :key="s" />\n</swiper>')).toThrow(
      /test\.vue at template 2:3: <swiper> 的直接子节点必须是 <swiper-item>，发现 <view>/,
    );
    expect(() => compile('<swiper><template v-for="s in items"><view /></template></swiper>')).toThrow(
      /发现 <view>/,
    );
  });

  it('emits swiper-item pages as written, the direct child filling the item', () => {
    const r = compile(
      '<swiper><template v-for="s in items" :key="s"><swiper-item><view /></swiper-item></template></swiper>',
    );
    expect(r.wxml).toMatch(/<swiper[^>]*>\s*<block wx:for="{{ items }}"[^>]*>\s*<swiper-item/);
    expect(r.wxml).toMatch(/<view class="[^"]*fjs-fill/);
  });

  it('maps fjs modal to the fjs-modal component with its kebab event', () => {
    const r = compile('<modal :visible="wifi" @modal-closed="toggle" />');
    expect(r.wxml).toMatch(/<fjs-modal class="data-v-test" visible="{{ wifi }}"/);
    expect(r.wxml).toContain('bind:modal-closed="__fjsCall"');
    expect(r.usingComponents.get('fjs-modal')).toBe('fjs-modal');
  });

  it('extracts function-call interpolations into computeds', () => {
    const r = compile('<view>{{ Math.round(count) }}</view>');
    expect(r.wxml).toContain('{{ __d0 }}');
    expect(r.setupCode[0]).toBe('const __d0 = __fjsComputed(() => Math.round(count.value));');
    expect(r.returnedNames).toEqual(['__d0']);
  });

  it('emits scroll-view type=list + scroll-y and canvas type=2d', () => {
    const r1 = compile('<scroll-view style="height: 100vh" />');
    expect(r1.wxml).toContain('type="list"');
    // webview scroll-view needs an explicit direction
    expect(r1.wxml).toContain('scroll-y="{{ true }}"');
    const r2 = compile('<inner-canvas />');
    expect(r2.wxml).toContain('<canvas class="data-v-test" type="2d"');
  });

  it('errors on a scroll-view without a statically visible height', () => {
    // skyline renders a heightless scroll-view as nothing — compile-time
    // error instead (style, :style literal and class rules are accepted)
    expect(() => compile('<scroll-view />')).toThrow(/no explicit height/);
    expect(() => compile('<scroll-view class="sv-h" />', BINDINGS, new Set(['sv-h']))).not.toThrow();
  });

  it('adds local .vue imports to usingComponents as kebab tags', () => {
    const r = compile('<Panel :title="title"><text>x</text></Panel>');
    expect(r.wxml).toContain('<panel class="data-v-test" title="{{ title }}">');
    expect(r.usingComponents.get('panel')).toBe('/x/Panel.vue');
    expect(r.wxml).toContain('<text');
  });

  it('compiles v-model on input to value + bindinput setter', () => {
    const r = compile('<input v-model="wifi" />');
    expect(r.wxml).toContain('value="{{ wifi }}"');
    expect(r.wxml).toContain('bindinput="__fjsCall"');
    expect(r.wxml).toContain('data-fn="__ev0"');
    expect(r.setupCode[0]).toContain('wifi.value = __e;');
  });

  it('multi-event elements share one dataset via a type dispatcher', () => {
    const r = compile('<image @load="onLoad" @error="onError" />', {
      ...BINDINGS,
      onLoad: 'setup-const',
      onError: 'setup-const',
    });
    // one data-fn, no per-event dataset duplicates
    expect((r.wxml.match(/data-fn=/g) ?? []).length).toBe(1);
    expect((r.wxml.match(/data-tag=/g) ?? []).length).toBe(1);
    expect(r.wxml).toContain('bindload="__fjsCall"');
    expect(r.wxml).toContain('binderror="__fjsCall"');
    // plain-identifier handlers dispatch by name; one dispatcher per element
    expect(r.setupCode.join('\n')).toContain('if (__t === "load") onLoad(__e, ...__s); else if (__t === "error") onError(__e, ...__s);');
    // the runtime passes the event type first to flagged dispatchers
    expect(r.setupCode.join('\n')).toContain('(__t, __e, ...__s) =>');
    expect(r.setupCode.join('\n')).toContain('.__fjsByType = true;');
  });

  it('generated computeds are template data', () => {
    const r = compile('<view :style="{ color: title }" :class="[title]">{{ fmt(count) }}</view>', {
      ...BINDINGS,
      fmt: 'setup-const',
    });
    for (const name of r.returnedNames.filter((n) => /^__(d|sty|cls)\d/.test(n))) {
      expect(r.dataNames).toContain(name);
    }
  });

  it('item-dependent calls inside v-for become a per-item computed table', () => {
    const r = compile(
      '<view v-for="item in items" :key="item.id"><checkbox :value="picked.includes(item.id)" /></view>',
      { ...BINDINGS, picked: 'setup-ref' },
    );
    expect(r.wxml).toContain('value="{{ __d0[index] }}"');
    expect(r.setupCode[0]).toContain('.map((item, index) => picked.value.includes(item.id))');
    expect(r.dataNames).toContain('__d0');
  });

  it('a literal v-for range counts from 1, as in Vue', () => {
    const r = compile('<view v-for="n in 3" :key="n">{{ n }}</view>');
    expect(r.wxml).toContain('wx:for="{{ [1, 2, 3] }}"');
  });

  it('button gets the fjs button classes from its static attrs', () => {
    const r = compile('<button type="primary" size="mini" plain>ok</button>');
    expect(r.wxml).toContain(
      'class="fjs-button fjs-button--primary fjs-button--plain fjs-button--mini data-v-test"',
    );
    expect(r.wxml).toContain('>ok</button>');
    // WeUI press mask, base-css .fjs-button:active::after
    expect(r.wxml).toContain('hover-class="fjs-button--pressed"');
  });

  it('checkbox / radio / groups / label are runtime components', () => {
    const r = compile(
      '<radio-group><label class="row"><radio :value="wifi" /></label></radio-group><checkbox-group><checkbox /></checkbox-group>',
    );
    for (const tag of ['fjs-radio-group', 'fjs-label', 'fjs-radio', 'fjs-checkbox-group', 'fjs-checkbox']) {
      expect(r.usingComponents.get(tag)).toBe(tag);
    }
    expect(r.wxml).toContain('<fjs-label class="fjs-label-host row data-v-test">');
  });

  it('copies a host class layout into runtime controls and scroll-view wrappers', () => {
    const r = genWxml('<scroll-view class="list" style="height: 100px"><view /></scroll-view><label class="row"><text>a</text></label>', {
      bindings: BINDINGS,
      vueImports: new Map(),
      filename: 'test.vue',
      layoutClasses: new Map([
        ['list', 'gap: 8px'],
        ['row', 'flex-direction: row; gap: 4px'],
      ]),
    });
    expect(r.wxml).toContain('<view class="fjs-scroll-inner" style="gap: 8px">');
    expect(r.wxml).toContain('layout="flex-direction: row; gap: 4px"');
  });

  it('hands a module widget the color it inherits from the template classes', () => {
    const opts = {
      bindings: BINDINGS,
      vueImports: new Map(),
      filename: 'test.vue',
      moduleTags: new Set(['icon-mind']),
      colorClasses: new Map([
        ['bar', '#111111'],
        ['back', 'var(--fjs-primary)'],
      ]),
    };
    const own = genWxml('<view class="bar"><icon-mind class="back" name="x" /></view>', opts);
    expect(own.wxml).toContain('fjs-color="var(--fjs-primary)"');
    const inherited = genWxml('<view class="bar"><view><icon-mind name="x" /></view></view>', opts);
    expect(inherited.wxml).toContain('fjs-color="#111111"');
    const none = genWxml('<view><icon-mind name="x" /></view>', opts);
    expect(none.wxml).not.toContain('fjs-color');
  });

  it('a page root scroll-view inside the shell body compiles to a view', () => {
    const opts = { bindings: BINDINGS, vueImports: new Map(), filename: 'index.vue' };
    const inShell = genWxml('<scroll-view class="page"><scroll-view class="inner" style="height: 10px" /></scroll-view>', {
      ...opts,
      pageInScroll: true,
    });
    expect(inShell.wxml).toMatch(/^<view class="fjs-box page">/);
    // nested scroll-views below the root stay scrollers
    expect(inShell.wxml).toContain('<scroll-view');
    // without the shell's scrolling body the root keeps scrolling (and needs a height)
    expect(() => genWxml('<scroll-view class="page" />', opts)).toThrow(/no explicit height/);
  });

  it('marks the shell template root to fill the page', () => {
    const r = genWxml('<view class="shell"><view /></view>', {
      bindings: BINDINGS,
      vueImports: new Map(),
      filename: 'Shell.vue',
      rootClass: 'fjs-page-root',
    });
    expect(r.wxml).toContain('<view class="fjs-box fjs-page-root shell">');
    expect(r.wxml.match(/fjs-page-root/g)).toHaveLength(1);
  });

  it('stretches a text centered by its column parent so skyline wraps it', () => {
    const r = genWxml('<view class="hero"><text class="desc">long</text><text class="badge">b</text></view>', {
      bindings: BINDINGS,
      vueImports: new Map(),
      filename: 'test.vue',
      crossAlignClasses: new Map([['hero', 'center']]),
      boxedClasses: new Set(['badge']),
    });
    expect(r.wxml).toContain('class="fjs-text fjs-text--center desc"');
    expect(r.wxml).toContain('class="fjs-text badge"');
    expect(r.fjsClasses).toContain('fjs-text--center');
  });

  it('converts template literals in ordinary bindings to concatenation', () => {
    const r = compile('<panel :desc="`已选 ${count} / ${items.length}`" />');
    expect(r.wxml).toContain('desc="{{ __d0 }}"');
    expect(r.setupCode[0]).toBe(
      "const __d0 = __fjsComputed(() => ('已选 ' + (count.value) + ' / ' + (items.value.length)));",
    );
    expect(r.wxml).not.toContain('`');
  });

  it('keeps v-for-scoped template literals verbatim in wxml', () => {
    const r = compile(
      '<view v-for="item in items" :title="`cell-${item.id}`">{{ `#${item.id}` }}</view>',
    );
    expect(r.wxml).toContain('title="{{ (\'cell-\' + (item.id)) }}"');
    expect(r.wxml).toContain('{{ (\'#\' + (item.id)) }}');
    expect(r.wxml).not.toContain('`');
  });

  it('converts nested template literals; :key interpolation is warned + omitted', () => {
    const r = compile('<view :title="`a${ `b${count}` }c`">x</view>');
    expect(r.setupCode[0]).toBe(
      "const __d0 = __fjsComputed(() => ('a' + (('b' + (count.value))) + 'c'));",
    );
    expect(r.wxml).not.toContain('`');
    const r2 = compile('<view v-for="(line, i) in items" :key="`${i}-${line}`" />');
    expect(r2.wxml).not.toContain('wx:key');
    expect(warn.some((w) => w.includes(':key'))).toBe(true);
  });

  it('rewriteImports: component imports become null, assets become URL consts', () => {
    const code = [
      "import Panel from '@/components/Panel.vue';",
      "import img from '@/assets/a.png';",
      "import type { X } from '@ufjs/iconmind';",
      "import { ref } from 'vue';",
      "const x = 1;",
    ].join('\n');
    const out = rewriteImports(code, (spec) => {
      if (spec.endsWith('.vue')) return { kind: 'const', target: 'null' };
      if (spec.endsWith('.png')) return { kind: 'const', target: '"/assets/a-h.png"' };
      if (spec === 'vue') return { kind: 'path', target: '../../fjs/runtime' };
      return null;
    });
    expect(out).toContain('const Panel = null;');
    expect(out).toContain('const img = "/assets/a-h.png";');
    expect(out).not.toContain('import type');
    expect(out).toContain("from '../../fjs/runtime'");
    // the comment mentioning import is untouched (lexer skips comments)
    expect(out).toContain('const x = 1;');
  });

  it('emits expression strings verbatim (wxml processes no escapes)', () => {
    // \\u escapes are NOT decoded by wxml — they render literally, so the
    // string must go out raw
    const r = compile('<text>{{ \'</>\' }}</text>');
    expect(r.wxml).toContain("{{ '</>' }}");
    expect(r.wxml).not.toContain('\\u003c');
    // && in expressions must stay raw (&quot; is the only escape we emit)
    const r2 = compile('<view wx:if="a < b && b > 0" />');
    expect(r2.wxml).toContain('a < b && b > 0');
  });

  it('appJson: native tabBar from tab meta, text-only items', () => {
    const pages = [
      { path: '/', name: 'index', meta: { title: '内置组件', tab: 0 } },
      { path: '/comp/switch', name: 'comp-switch', meta: { title: '开关' } },
      { path: '/about', name: 'about', meta: { title: '关于', tab: 3 } },
      { path: '/api', name: 'api', meta: { title: '接口', tab: 1 } },
    ];
    const app = JSON.parse(appJson(pages));
    expect(app.tabBar.list).toEqual([
      { pagePath: 'pages/index/index', text: '内置组件' },
      { pagePath: 'pages/api/api', text: '接口' },
      { pagePath: 'pages/about/about', text: '关于' },
    ]);
    expect(app.tabBar.selectedColor).toBe('#007aff');
    expect(app.componentFramework).toBe('glass-easel');
    // fewer than two tab pages: no tabBar section
    expect(JSON.parse(appJson(pages.slice(0, 2))).tabBar).toBeUndefined();
  });

  it('projectConfigJson merges wxmp.setting over the defaults', () => {
    const cfg = JSON.parse(projectConfigJson('app', undefined, 'skyline', { minified: true, es6: false, custom: 1 }));
    expect(cfg.setting.minified).toBe(true);
    expect(cfg.setting.es6).toBe(false);
    expect(cfg.setting.custom).toBe(1);
    // untouched defaults stay
    expect(cfg.setting.postcss).toBe(false);
    expect(cfg.setting.useCompilerPlugins).toEqual(['typescript']);
    expect(cfg.setting.skylineRenderEnable).toBe(true);
  });

  it('appJson: renderer defaults to webview; skyline adds its keys', () => {
    const pages = [{ path: '/', name: 'index', meta: {} }];
    const webview = JSON.parse(appJson(pages));
    expect(webview.renderer).toBeUndefined();
    expect(webview.rendererOptions).toBeUndefined();
    const skyline = JSON.parse(appJson(pages, 'skyline'));
    expect(skyline.renderer).toBe('skyline');
    expect(skyline.rendererOptions.skyline.sdkVersionBegin).toBe('3.0.0');
  });

  it('componentJson opts into apply-shared so app.wxss reaches components', () => {
    expect(JSON.parse(componentJson({})).styleIsolation).toBe('apply-shared');
  });

  it('decodes text entities; < runs become one concatenation expression', () => {
    // entities are NOT decoded by wxml — decode, then emit the run as a
    // single {{ }} concatenation so it stays on ONE line (wxml preserves
    // whitespace, per-child lines would render real breaks)
    const r = compile('<view>&lt;{{ tag }}&gt;</view>');
    expect(r.wxml).toContain("{{ '<' + (tag) + '>' }}");
    expect(r.wxml).not.toContain('&lt;');
    // plain & is harmless raw
    const r2 = compile('<view>a & b</view>');
    expect(r2.wxml).toContain('a & b');
  });

  it('safe-area is a runtime component; divider stays a downcast view', () => {
    const r = compile('<safe-area><view /></safe-area>');
    expect(r.wxml).toContain('<fjs-safe-area class="data-v-test">');
    expect(r.usingComponents.get('fjs-safe-area')).toBe('fjs-safe-area');
    const r2 = compile('<divider />');
    expect(r2.wxml).toContain('class="fjs-box fjs-divider data-v-test"');
  });
});

describe('v-for list projection (spec 061)', () => {
  const B = { dots: 'setup-const', rows: 'setup-const', names: 'setup-const', pick: 'setup-const' };

  it('projects to the properties the wxml reads, plus the wx:key one', () => {
    const r = compile(
      '<view v-for="dot in dots" :key="dot.id" :style="{ opacity: dot.o }">{{ dot.label }}</view>',
      B,
    );
    expect(r.wxml).toContain('wx:for="{{ __l0 }}"');
    expect(r.setupCode.join('\n')).toContain('__fjsProject(dots, ["o", "label", "id"])');
    // the source list itself no longer crosses setData
    expect(r.dataNames).not.toContain('dots');
    expect(r.dataNames).toContain('__l0');
  });

  it('projects to nothing but the key when the item is never read', () => {
    const r = compile('<view v-for="(dot, i) in dots" :key="dot.id" :style="dotStyle(dot)" />', {
      ...B,
      dotStyle: 'setup-const',
    });
    // dotStyle(dot) is a call: it becomes a per-item table in setup, so the
    // wxml itself reads nothing off the item
    expect(r.setupCode.join('\n')).toContain('__fjsProject(dots, ["id"])');
  });

  it('leaves the list alone when an expression reads the whole item', () => {
    const r = compile('<view v-for="name in names">{{ name }}</view>', B);
    expect(r.wxml).toContain('wx:for="{{ names }}"');
    expect(r.dataNames).toContain('names');
  });

  it('leaves the list alone for a computed member read', () => {
    const r = compile('<view v-for="dot in dots">{{ dot[pick] }}</view>', B);
    expect(r.wxml).toContain('wx:for="{{ dots }}"');
  });

  it('does not take the item name from a class or a wx:for-item', () => {
    const r = compile('<view v-for="dot in dots" :key="dot.id" class="dot" />', B);
    expect(r.setupCode.join('\n')).toContain('__fjsProject(dots, ["id"])');
  });

  it('leaves a nested v-for alone (an inner list is not setup scope)', () => {
    const r = compile(
      '<view v-for="row in rows"><view v-for="c in row">{{ c.x }}</view></view>',
      B,
    );
    expect(r.wxml).toContain('wx:for="{{ row }}"');
    expect(r.setupCode.join('\n')).not.toContain('__fjsProject(row');
  });
});

describe('v-motion (spec 061)', () => {
  const B = { CHIPS: 'setup-const', SPRINGS: 'setup-const', LANE: 'setup-const', setBall: 'setup-const' };

  it('binds the stand-in style and drops the variant attributes', () => {
    const r = compile(
      `<view v-motion :initial="{ opacity: 0 }" :enter="{ opacity: 1 }" class="chip" />`,
      B,
    );
    expect(r.wxml).toContain('style="{{ __m0 }}"');
    expect(r.wxml).not.toContain('initial=');
    expect(r.wxml).not.toContain('enter=');
    expect(r.setupCode.join('\n')).toContain(
      'const __m0 = __fjsMotion(__fjsUseMotion, () => ({ initial: { opacity: 0 }, enter: { opacity: 1 } }));',
    );
    expect(r.usesMotion).toBe(true);
    expect(r.dataNames).toContain('__m0');
  });

  it('makes one instance per v-for item and wires the :ref handle', () => {
    const r = compile(
      `<view v-for="(spring, i) in SPRINGS" :key="spring.name" v-motion :ref="setBall(i)"
         :variants="{ right: { x: LANE, transition: { stiffness: spring.stiffness } } }"
         :style="{ backgroundColor: 'red' }" />`,
      B,
    );
    const setup = r.setupCode.join('\n');
    expect(setup).toContain('const __m0 = __fjsMotionEach(__fjsUseMotion, () => SPRINGS,');
    expect(setup).toContain('(spring, i) => ({ ...({ right: { x: LANE, transition: { stiffness: spring.stiffness } } }) })');
    expect(setup).toContain('(__el, spring, i) => { (setBall(i))(__el); }');
    // the element's own :style stays, motion writes after it
    expect(r.wxml).toMatch(/style="\{\{ \('background-color:' \+ .*\) \+ ';' \+ __m0\[i\] \}\}"/);
    expect(r.wxml).not.toContain('ref=');
  });

  it('keeps a static style in front of the motion style', () => {
    const r = compile(`<view v-motion :enter="{ opacity: 1 }" style="width:10px" />`, B);
    expect(r.wxml).toContain('style="width:10px; {{ __m0 }}"');
  });

  it('passes the :key so a changed key replays the entrance', () => {
    const r = compile(
      `<view v-for="(chip, i) in CHIPS" :key="\`${'${run}'}-${'${chip}'}\`" v-motion :enter="{ opacity: 1 }" />`,
      { ...B, run: 'setup-ref' },
    );
    const setup = r.setupCode.join('\n');
    expect(setup).toContain('undefined, (chip, i) => (');
    // setup code is TS: the template literal stays one, only refs are unwrapped
    expect(setup).toContain('(chip, i) => (`${run.value}-${chip}`)');
  });

  it('warns for variants that need DOM events or an observer', () => {
    const r = compile(`<view v-motion :enter="{ opacity: 1 }" :hovered="{ scale: 1.1 }" />`, B);
    expect(warn.join('\n')).toContain('v-motion :hovered needs DOM events');
    expect(r.wxml).not.toContain('hovered=');
  });

  it('drops v-motion inside a nested v-for', () => {
    const r = compile(
      `<view v-for="row in items"><view v-for="(c, j) in row" v-motion :enter="{ opacity: 1 }" /></view>`,
      { ...B, items: 'setup-const' },
    );
    expect(warn.join('\n')).toContain('nested v-for is not supported');
    expect(r.usesMotion).toBe(false);
  });
});

describe('expression rewriting', () => {
  it('appends .value only to setup refs, never to keys or properties', () => {
    expect(rewriteExpr('wifi = v', { bindings: BINDINGS, skip: new Set(['v']) })).toBe('wifi.value = v');
    expect(rewriteExpr('{ a: wifi, b: router.x }', { bindings: BINDINGS, skip: new Set() })).toBe(
      '{ a: wifi.value, b: router.x }',
    );
    expect(rewriteExpr("'wifi'", { bindings: BINDINGS, skip: new Set() })).toBe("'wifi'");
  });

  it('finds free scope identifiers for data-args', () => {
    expect(freeScopeIdentifiers('router.push(item.path)', BINDINGS, new Set())).toEqual(['item']);
  });

  it('collects referenced setup bindings for the data snapshot', () => {
    expect(referencedBindings('wifi || count', BINDINGS)).toEqual(['wifi', 'count']);
  });
});

describe('genScriptCode', () => {
  it('injects generated code around __returned__ without breaking accessors', () => {
    // `let` bindings compile into get/set accessor pairs — a naive textual
    // splice inside the object literal would corrupt them (see spec 046)
    const compiled = {
      content: `export default /* @__PURE__ */ _defineComponent({
  setup(__props) {
    let ticks = 1;
    const __returned__ = { get ticks() { return ticks }, set ticks(v) { ticks = v } };
    Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
    return __returned__;
  },
});`,
      bindings: { ticks: 'setup-let' },
    };
    const wxml = genWxml('<view @tap="ticks++">{{ ticks }}</view>', {
      bindings: compiled.bindings,
      vueImports: new Map(),
      filename: 'x.vue',
    });
    const code = genScriptCode({ compiled, wxml, kind: 'component', filename: 'x.vue' });
    expect(code).toContain('const __ev0 = (__e, ...__s) => { ticks++; };');
    expect(code).toContain('__returned__.__ev0 = __ev0;');
    expect(code).toContain('__sfc__.__fjsData = ["ticks"]');
    expect(code).toContain('export default __sfc__;');
    // the accessor pair must survive untouched
    expect(code).toContain('get ticks() { return ticks }');
  });
});

describe('genWxss', () => {
  it('rewrites scoped attribute selectors into classes', () => {
    const css = replaceScopeAttr('.row[data-v-x]{color:red}\nview[data-v-x]{}', 'data-v-x');
    expect(css).toContain('.row.data-v-x');
    expect(css).toContain('view.data-v-x');
    expect(css).not.toContain('[data-v-x]');
  });

  it('appends builtin downcast styles when a downcast tag is used', () => {
    const r = compile('<divider />');
    const css = genWxss({ styles: [], id: 'data-v-test', filename: 'x.vue', fjsClasses: r.fjsClasses });
    expect(css).toContain('.fjs-divider');
  });

  it('warns about skyline-unsupported css', () => {
    genWxss({ styles: [{ type: 'style' } as never, ], id: 'data-v-test', filename: 'x.vue' });
    void warn;
  });

  it('suffixes px onto unitless lengths, as the web does', () => {
    const out = genWxss({
      styles: [{ type: 'style', content: '.a { height: 28; padding: 8 4%; line-height: 1.5; flex-grow: 1 }' } as never],
      id: 'data-v-test',
      filename: 'x.vue',
    });
    expect(out).toContain('height: 28px');
    expect(out).toContain('padding: 8px 4%');
    expect(out).toContain('line-height: 1.5');
    expect(out).toContain('flex-grow: 1');
  });

  it(':active becomes the hover-class press state; :hover is dropped', () => {
    const out = genWxss({
      styles: [{ type: 'style', scoped: true, content: '.item:active { color: red } .box:hover { color: blue }' } as never],
      id: 'data-v-test',
      filename: 'x.vue',
    });
    expect(out).toContain('.item.data-v-test.fjs-pressed');
    expect(out).not.toContain(':hover');
    const r = genWxml('<view class="item" /><view class="other" />', {
      bindings: BINDINGS,
      vueImports: new Map(),
      filename: 'test.vue',
      activeClasses: new Set(['item']),
    });
    expect(r.wxml).toContain('class="fjs-box item" hover-class="fjs-pressed"');
    expect(r.wxml).not.toMatch(/other"[^>]*hover-class/);
  });
});

describe('touch-action', () => {
  const opts = (renderer: 'webview' | 'skyline') => ({
    bindings: { onMove: 'setup-const' } as never,
    vueImports: new Map(),
    filename: 'test.vue',
    touchActionClasses: new Map([
      ['drag', 'none' as const],
      ['swipe', 'pan-y' as const],
    ]),
    renderer,
  });

  it('none: touchmove is caught, and skyline wraps both drag handlers', () => {
    const web = genWxml('<view class="drag" @touchmove="onMove" />', opts('webview')).wxml;
    expect(web).toContain('catchtouchmove="__fjsCall"');
    expect(web).not.toContain('gesture-handler');
    const sky = genWxml('<view v-if="ok" class="drag"><text>a</text></view>', opts('skyline')).wxml;
    expect(sky).toContain('catchtouchmove="__fjsNoop"');
    expect(sky).toMatch(
      /<horizontal-drag-gesture-handler wx:if="\{\{ ok \}\}"><vertical-drag-gesture-handler><view class="fjs-box drag"[^>]*>[\s\S]*<\/view><\/vertical-drag-gesture-handler><\/horizontal-drag-gesture-handler>/,
    );
  });

  it('pan-y keeps the vertical scroll: no catch, horizontal handler only', () => {
    const sky = genWxml('<view class="swipe" @touchmove="onMove" />', opts('skyline')).wxml;
    expect(sky).toContain('bindtouchmove="__fjsCall"');
    expect(sky).toContain('<horizontal-drag-gesture-handler><view');
    expect(sky).not.toContain('vertical-drag');
  });

  it('inline style counts, auto does not', () => {
    expect(genWxml('<view style="touch-action: none" />', opts('webview')).wxml).toContain('catchtouchmove');
    expect(genWxml('<view style="touch-action: auto" />', opts('webview')).wxml).not.toContain('catchtouchmove');
  });
});

describe('spec 048: rich-text / picker-view / form on the mini program', () => {
  it(':class object shorthand expands like `{ focused: focused }`', () => {
    const { wxml } = compile('<input class="v" :class="{ focused, on: count }" />', { ...BINDINGS, focused: 'setup-ref' });
    expect(wxml).toContain("(focused ? 'focused ' : '')");
    expect(wxml).toContain("(count ? 'on ' : '')");
    expect(warn.join('\n')).not.toContain('unsupported :class object entries');
  });

  it('an image imported by two modules is a quoted literal both times', () => {
    const emitter = new Emitter('/proj', '/proj/dist/mp/miniprogram');
    const first = emitter.resolveFor('/out/a', '/proj/src/pages/a.vue', '@/assets/x.png');
    const second = emitter.resolveFor('/out/b', '/proj/src/pages/b.vue', '@/assets/x.png');
    expect(first).toEqual({ kind: 'const', target: expect.stringMatching(/^"\/assets\/x-[0-9a-f]{6}\.png"$/) });
    expect(second).toEqual(first);
  });

  it('rich-text becomes the runtime component under skyline, carrying the page scope', () => {
    const { wxml, usingComponents } = genWxml('<rich-text class="box" :nodes="html" space="nbsp" @tap="toggle" />', {
      bindings: { ...BINDINGS, html: 'setup-const' },
      vueImports: new Map(),
      filename: 'test.vue',
      scopeId: 'data-v-test',
      renderer: 'skyline',
    });
    expect(wxml).toMatch(/^<fjs-rich-text class="fjs-rich-text-host box data-v-test" nodes="\{\{ html \}\}" space="nbsp"/);
    expect(wxml).toContain('scope="data-v-test"');
    expect(wxml).toContain('bind:tap="__fjsCall"');
    expect(usingComponents.get('fjs-rich-text')).toBe('fjs-rich-text');
  });

  it('spec 050: rich-text stays the native one under webview, without scope', () => {
    const { wxml, usingComponents } = genWxml('<rich-text class="box" :nodes="html" space="nbsp" @tap="toggle" />', {
      bindings: { ...BINDINGS, html: 'setup-const' },
      vueImports: new Map(),
      filename: 'test.vue',
      scopeId: 'data-v-test',
      renderer: 'webview',
    });
    expect(wxml).toMatch(/^<rich-text class="[^"]*fjs-rich-text-host box data-v-test"/);
    expect(wxml).toContain('nodes="{{ html }}"');
    expect(wxml).toContain('space="nbsp"');
    expect(wxml).toMatch(/bindtap="__fjsCall"/);
    expect(wxml).not.toContain('scope=');
    expect(wxml).not.toContain('fjs-rich-text ');
    expect(usingComponents.has('fjs-rich-text')).toBe(false);
  });

  it('spec 050: copyRuntimeComponents skips the named components', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-mp-copy-'));
    try {
      const runtimeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fjs-runtime');
      copyRuntimeComponents(runtimeDir, out, { skip: new Set(['fjs-rich-text', 'fjs-rich-node']) });
      expect(fs.existsSync(path.join(out, 'fjs', 'fjs-rich-text'))).toBe(false);
      expect(fs.existsSync(path.join(out, 'fjs', 'fjs-rich-node'))).toBe(false);
      expect(fs.existsSync(path.join(out, 'fjs', 'fjs-modal', 'fjs-modal.js'))).toBe(true);
      copyRuntimeComponents(runtimeDir, out);
      expect(fs.existsSync(path.join(out, 'fjs', 'fjs-rich-text', 'fjs-rich-text.js'))).toBe(true);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('picker-view: default size classes, rows classed, value re-sent through pickerSync', () => {
    const r = compile(
      '<picker-view :value="count" @change="toggle"><picker-view-column><view v-for="y in items" :key="y"><text>{{ y }}</text></view></picker-view-column></picker-view>',
    );
    expect(r.wxml).toContain('class="fjs-box fjs-picker-view data-v-test"');
    expect(r.wxml).toContain('indicator-style="height: 44px"');
    expect(r.wxml).toContain('value="{{ __fjs.pickerValue(count, __fjsPv0) }}"');
    expect(r.wxml).toMatch(/<view class="fjs-box fjs-picker-item data-v-test">/);
    expect(r.usesWxs).toBe(true);
    expect(r.setupCode).toContain('const __fjsPv0 = __fjsPickerSync(() => [count.value, items.value]);');
    expect(r.dataNames).toContain('__fjsPv0');
  });

  it('picker-view item-height sizes the wheel and the rows', () => {
    const { wxml } = compile(
      '<picker-view item-height="36"><picker-view-column><view v-for="y in items" :key="y" /></picker-view-column></picker-view>',
    );
    expect(wxml).toContain('indicator-style="height: 36px"');
    expect(wxml).toContain('style="height: 180px"');
    expect(wxml).toContain('style="height: 36px"');
    expect(wxml).not.toContain('item-height=');
  });

  it('button disabled / loading: state classes, compiler-drawn spinner, no wx loading attr', () => {
    const { wxml, fjsClasses } = compile('<view><button type="primary" disabled>a</button><button type="warn" plain :loading="count">b</button></view>');
    // the spinner's @keyframes must live in the component's own wxss (skyline ignores app.wxss keyframes)
    expect(fjsClasses).toContain('fjs-button-spinner');
    expect(wxml).toContain('class="fjs-button fjs-button--primary fjs-button--disabled data-v-test"');
    expect(wxml).toContain("{{ (count) ? 'fjs-button--loading' : '' }}");
    expect(wxml).not.toMatch(/ loading=/);
    expect(wxml).toMatch(/<view class="fjs-button-spinner" wx:if="\{\{ count \}\}">.*fjs-button-spinner-ring--warn.*<\/view>b<\/button>/);
  });
});

describe('spec 052: sticky-header / sticky-section', () => {
  it('a type=custom scroll-view keeps its direct children: no type injection, no inner wrapper', () => {
    const r = genWxml(
      '<scroll-view type="custom" style="height: 240px"><sticky-section><sticky-header><text>a</text></sticky-header><view>b</view></sticky-section></scroll-view>',
      {
        bindings: BINDINGS,
        vueImports: new Map([['Panel', '/x/Panel.vue']]),
        filename: 'test.vue',
        renderer: 'skyline',
      },
    );
    expect(r.wxml).not.toContain('type="list"');
    expect(r.wxml).not.toContain('enable-flex');
    expect(r.wxml).not.toContain('fjs-scroll-inner');
    expect(r.wxml).toMatch(/<scroll-view[^>]*type="custom"/); // re-anchor
    expect(r.wxml).toContain('<sticky-section');
    expect(r.wxml).toContain('<sticky-header');
    expect(r.wxml).toMatch(/<scroll-view[^>]*type="custom"/);
  });

  it('an ordinary scroll-view still gets type=list and the inner wrapper', () => {
    const r = compile('<scroll-view style="height: 100px"><view /></scroll-view>');
    expect(r.wxml).toContain('type="list"');
    expect(r.wxml).toContain('fjs-scroll-inner');
  });

  it('skyline: the sticky tags pass through verbatim, with the flip event', () => {
    const sky = genWxml(
      '<scroll-view type="custom" style="height: 200px" scroll-y><sticky-header @stickontopchange="onStick"><text>a</text></sticky-header></scroll-view>',
      {
        bindings: { onStick: 'setup-const' } as never,
        vueImports: new Map(),
        filename: 'test.vue',
        renderer: 'skyline',
      },
    );
    expect(sky.wxml).toContain('<sticky-header');
    expect(sky.wxml).toContain('bindstickontopchange="__fjsCall"');
    expect(sky.usingComponents.size).toBe(0);
  });

  it('webview renderer: the sticky pair compiles to the runtime custom components', () => {
    const web = genWxml(
      '<sticky-header offset-top="8" @stickontopchange="onStick"><text>a</text></sticky-header><sticky-section><view>b</view></sticky-section>',
      {
        bindings: { onStick: 'setup-const' } as never,
        vueImports: new Map(),
        filename: 'test.vue',
        renderer: 'webview',
      },
    );
    // the custom components carry the event and the props verbatim — the
    // 052 view downgrade could do neither (bindstickontopchange on a view
    // never fires; a bound offset-top cannot become an inline style)
    expect(web.wxml).toContain('<fjs-sticky-header');
    expect(web.wxml).toContain('offset-top="8"');
    expect(web.wxml).toContain('bind:stickontopchange="__fjsCall"');
    expect(web.wxml).toContain('data-tag="fjs-sticky-header"');
    expect(web.wxml).toContain('<fjs-sticky-section');
    expect(web.usingComponents.get('fjs-sticky-header')).toBe('fjs-sticky-header');
    expect(web.usingComponents.get('fjs-sticky-section')).toBe('fjs-sticky-section');
    // no downcast leftovers
    expect(web.wxml).not.toContain('<sticky-header');
    expect(web.fjsClasses).not.toContain('fjs-sticky-header');
  });

  it('webview renderer: a bound offset-top reaches the sticky component', () => {
    const web = genWxml('<sticky-header :offset-top="n" />', {
      bindings: { n: 'setup-ref' } as never,
      vueImports: new Map(),
      filename: 'test.vue',
      renderer: 'webview',
    });
    expect(web.wxml).toContain('offset-top="{{ n }}"');
    expect(warn.join('\n')).not.toContain('offset-top');
  });

  it('skyline: a page root type=custom scroll-view is not downgraded to a view', () => {
    const sky = genWxml(
      '<scroll-view type="custom" style="height: 100vh"><sticky-section /></scroll-view>',
      {
        bindings: {} as never,
        vueImports: new Map(),
        filename: 'test.vue',
        pageInScroll: true,
        renderer: 'skyline',
      },
    );
    expect(sky.wxml).toMatch(/^<scroll-view/);
    const web = genWxml(
      '<scroll-view type="custom" style="height: 100vh"><sticky-section /></scroll-view>',
      {
        bindings: {} as never,
        vueImports: new Map(),
        filename: 'test.vue',
        pageInScroll: true,
        renderer: 'webview',
      },
    );
    // webview pages scroll natively, so the root still becomes a view and
    // the downcast header pins against the page scroller
    expect(web.wxml).toMatch(/^<view/);
  });
});
