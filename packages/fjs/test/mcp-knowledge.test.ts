// Knowledge tools answer from the build-time snapshot (specs/213). These
// tests pin the snapshot to its sources — tags.json, css/support.ts,
// element.ts EventType — so the generation script cannot silently drift
// (the same anti-drift idea as ops_intern.test.ts on the protocol side).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWLEDGE_TOOLS } from '../src/mcp/tools-knowledge.js';
import { CSS, COMPONENT_TAGS, DOCS, EVENTS, TAGS, UFJS_VERSION } from '../src/mcp/knowledge.gen.js';

const runtimeSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fjs-runtime/src',
);

function tool(name: string) {
  const found = KNOWLEDGE_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`knowledge tool ${name} not registered`);
  return found;
}

describe('knowledge snapshot vs sources', () => {
  it('carries the runtime version and the tag lists verbatim', () => {
    expect(TAGS).toEqual(
      JSON.parse(fs.readFileSync(path.join(runtimeSrc, 'tags.json'), 'utf8')),
    );
    expect(COMPONENT_TAGS).toEqual(
      JSON.parse(fs.readFileSync(path.join(runtimeSrc, 'component-tags.json'), 'utf8')),
    );
    expect(UFJS_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('mirrors the CSS support table, including a canary entry', () => {
    // If support.ts gains/renames a table and the snapshot misses it, this
    // is where it surfaces — the tools would answer "likely ok" for a gap.
    const support = fs.readFileSync(path.join(runtimeSrc, 'css/support.ts'), 'utf8');
    expect(CSS.droppedProperties.filter).toBeTruthy();
    expect(CSS.unsupportedDisplayValues).toContain('grid');
    expect(CSS.unsupportedUnits).toContain('vw');
    expect(CSS.sizeProperties).toContain('width');
    for (const table of [
      'DROPPED_PROPERTIES',
      'UNSUPPORTED_DISPLAY_VALUES',
      'UNSUPPORTED_UNITS',
      'TRANSITIONABLE_ON_APP',
      'KEYFRAMES_ANIMATABLE_ON_APP',
    ] as const) {
      expect(support, `${table} must still exist in support.ts`).toContain(table);
    }
  });

  it('mirrors the EventType table (onTap = 1, scrolltolower = 25)', () => {
    expect(EVENTS.onTap).toBe(1);
    expect(EVENTS.onScrolltolower).toBe(25);
    expect(Object.keys(EVENTS).length).toBeGreaterThanOrEqual(40);
  });

  it('bundles the app-facing docs corpus, ui-api intact', () => {
    const ids = DOCS.map((candidate) => candidate.id);
    for (const id of ['ui-api', 'css-compat', 'overlay-host', 'toolchain', 'fjs-go']) {
      expect(ids).toContain(id);
    }
    const uiApi = DOCS.find((candidate) => candidate.id === 'ui-api');
    expect(uiApi?.body).toContain('## 标签全集');
    expect(uiApi?.truncated).toBe(false);
  });
});

describe('knowledge tools', () => {
  it('list_tags shows both lists and the dual-listed tags', async () => {
    const text = await tool('list_tags').run({});
    expect(text).toContain('scroll-view');
    expect(text).toContain('JS component tags');
    expect(text).toContain('textarea');
  });

  it('get_tag quotes the ui-api table row and dedicated section', async () => {
    const text = await tool('get_tag').run({ name: 'scroll-view' });
    expect(text).toContain('SingleChildScrollView');
    expect(text).toContain('scroll-x');
    expect(text).toContain('docs/ui-api.md dedicated section');
  });

  it('get_tag marks JS component tags, with component precedence for form', async () => {
    const form = await tool('get_tag').run({ name: 'form' });
    expect(form).toContain('JS component tag');
    expect(form).toContain('constitution VII');
  });

  it('get_tag suggests near misses for unknown names', async () => {
    await expect(tool('get_tag').run({ name: 'scrollview' })).rejects.toThrow('scroll-view');
    await expect(tool('get_tag').run({ name: 'div' })).rejects.toThrow('divider');
    await expect(tool('get_tag').run({ name: 'xyzzy' })).rejects.toThrow('whitelist');
  });

  it('query_css answers drop / warn / likely-ok from the table', async () => {
    const drop = await tool('query_css').run({ property: 'word-break' });
    expect(drop).toContain('【drop】');
    expect(drop).toContain('max-lines');

    const grid = await tool('query_css').run({ property: 'display', value: 'grid' });
    expect(grid).toContain('【drop】');

    const units = await tool('query_css').run({ property: 'width', value: '100vw' });
    expect(units).toContain('【drop】');
    expect(units).toContain('px');

    const size = await tool('query_css').run({ property: 'width', value: 'max-content' });
    expect(size).toContain('【warn】');

    const ok = await tool('query_css').run({ property: 'position', value: 'fixed' });
    expect(ok).toContain('likely ok');
    expect(ok).toContain('css-compat');
  });

  it('query_css judges transition targets and keyframes frames', async () => {
    const transition = await tool('query_css').run({
      property: 'transition',
      value: 'transform 0.2s, color 0.2s, box-shadow 0.2s',
    });
    expect(transition).toContain('transform: animates');
    expect(transition).toContain('box-shadow: will NOT tween');

    const frames = await tool('query_css').run({
      property: 'color',
      context: 'keyframes',
    });
    expect(frames).toContain('【warn】');
  });

  it('list_events groups aliases and points at payload docs', async () => {
    const text = await tool('list_events').run({});
    expect(text).toContain('onTap / onClick');
    expect(text).toContain('onScrolltolower');
    expect(text).toContain('Payloads are ALWAYS strings');
    expect(text).toContain('事件（props 形式）');
  });

  it('search_docs ranks and excerpts; get_doc returns the body', async () => {
    const search = await tool('search_docs').run({ query: 'position fixed 弹层 返回拦截' });
    expect(search).toContain('overlay-host');
    expect(search).toContain('get_doc');

    const body = await tool('get_doc').run({ id: 'overlay-host' });
    expect(body).toContain('position: fixed');
    await expect(tool('get_doc').run({ id: 'nope' })).rejects.toThrow('available:');
  });
});
