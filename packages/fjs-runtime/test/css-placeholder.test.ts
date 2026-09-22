// specs/100: `::placeholder` support in the App path's CSS engine.
//
// Web paints the hint through native CSS, so nothing about this pseudo goes
// through the engine there; on the Flutter side the engine computes the
// declarations and the renderer carries them to the input widget as the
// `placeholderStyle` prop — the same four-key string the `placeholder-style`
// attribute takes (textarea/props.ts), parsed by input.dart's _hintStyle.
//
// Three layers pinned here:
//  1. parse: a ::placeholder selector splits out of a mixed rule and never
//     styles the element itself;
//  2. engine: the computed pseudo carries ONLY the matched declarations (a
//     rule without `color` must leave the pinned placeholder grey alone)
//     and dropping the match pushes a clear;
//  3. renderer: the computed pseudo reaches the element as a
//     `placeholderStyle` prop, serialized the way the peer parses it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { StyleEngine, type PseudoStyles } from '../src/css/style';
import { parseStylesheet, parseSelector } from '../src/css/parser';
import {
  createApp,
  flutterRoot,
  registerStyles,
  childElementIds,
  elementTag,
} from '../src/vue/renderer';
import { getWriter, setOpSink } from '../src/host';

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

beforeEach(() => {
  setOpSink(() => {});
});

describe('::placeholder at the selector layer', () => {
  it('splits out of a mixed rule so the declarations never style the element', () => {
    const rules = parseStylesheet('.a, .a::placeholder { color: #c8c9cc; }', null, 0);
    expect(rules).toHaveLength(2);
    const plain = rules.find((r) => r.pseudo === undefined);
    const ph = rules.find((r) => r.pseudo === 'placeholder');
    expect(plain?.selectors.map((s) => s.text)).toEqual(['.a']);
    expect(ph?.selectors.every((s) => s.pseudo === 'placeholder')).toBe(true);
    // same declarations, two worlds — the plain half styles .a itself
    expect(plain?.decls).toEqual({ color: '#c8c9cc' });
    expect(ph?.decls).toEqual({ color: '#c8c9cc' });
  });

  it('the pseudo costs one specificity step, like the decorative pair', () => {
    expect(parseSelector('.a::placeholder')!.specificity).toBe(
      parseSelector('.a')!.specificity + 1,
    );
  });
});

/** A standalone StyleEngine wired the way vue/renderer.ts wires it, with
 * every pseudo notification recorded. */
function engineWithPseudoLog() {
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const applied = new Map<number, Record<string, unknown>>();
  const pseudos: Array<{ id: number; pseudo: PseudoStyles | null | undefined }> = [];
  const engine = new StyleEngine(parentOf, childrenOf, (id, style, _a, _h, pseudo) => {
    applied.set(id, style);
    if (pseudo !== undefined) pseudos.push({ id, pseudo });
  });
  const add = (id: number, tag: string, parent: number | null, cls: string) => {
    parentOf.set(id, parent);
    childrenOf.set(id, []);
    if (parent != null) childrenOf.get(parent)!.push(id);
    engine.ensure(id, tag);
    engine.setClasses(id, cls);
    return id;
  };
  return { engine, add, applied, pseudos };
}

describe('::placeholder in the style engine', () => {
  it('computes the hint style apart from the element, resolving var()', async () => {
    const { engine, add, applied, pseudos } = engineWithPseudoLog();
    engine.register(
      null,
      `
      :root { --ph-color: #c8c9cc; }
      .fld { color: #323233; }
      .fld::placeholder { color: var(--ph-color); }
      `,
    );
    add(1, 'input', null, 'fld');
    engine.noteStructureChange(1);
    await tick();

    // the element keeps its own color — the pseudo rule styles the hint only
    expect(applied.get(1)).toMatchObject({ color: '#323233' });
    const last = pseudos.filter((p) => p.id === 1).at(-1);
    expect(last?.pseudo?.placeholder).toEqual({ color: '#c8c9cc' });
    expect(last?.pseudo?.before).toBeUndefined();
    expect(last?.pseudo?.after).toBeUndefined();
  });

  it('a rule without color leaves the hint grey (no inherited color leaks in)', async () => {
    const { engine, add, applied, pseudos } = engineWithPseudoLog();
    engine.register(
      null,
      `
      .fld { color: #323233; }
      .fld::placeholder { font-size: 10px; }
      `,
    );
    add(2, 'input', null, 'fld');
    engine.noteStructureChange(2);
    await tick();

    // only the matched declaration: no `color` key means the peer keeps the
    // grey both ends pin for an unstyled placeholder
    expect(pseudos.filter((p) => p.id === 2).at(-1)?.pseudo?.placeholder).toEqual({
      fontSize: 10,
    });
    // and the pseudo's font-size never styled the element itself
    expect(applied.get(2)).toMatchObject({ color: '#323233' });
    expect(applied.get(2)!.fontSize).not.toBe(10);
  });

  it('dropping the match pushes null so the peer can clear the prop', async () => {
    const { engine, add, pseudos } = engineWithPseudoLog();
    engine.register(null, '.fld::placeholder { color: #c8c9cc; }');
    add(3, 'input', null, 'fld');
    engine.noteStructureChange(3);
    await tick();
    expect(pseudos.filter((p) => p.id === 3).at(-1)?.pseudo?.placeholder).toEqual({
      color: '#c8c9cc',
    });

    engine.setClasses(3, 'other');
    await tick();
    expect(pseudos.filter((p) => p.id === 3).at(-1)?.pseudo).toBeNull();
  });
});

describe('::placeholder reaches the element as the placeholderStyle prop', () => {
  it('serializes the four keys the peer parses, and clears on unmatch', async () => {
    registerStyles(
      null,
      `
      .ph-input::placeholder {
        color: #c8c9cc;
        font-size: 14px;
        line-height: 24px;
      }
      `,
    );
    const writer = getWriter();
    const pushes: Array<Record<string, unknown>> = [];
    vi.spyOn(writer, 'setProps').mockImplementation((id, props) => {
      if (props.placeholderStyle !== undefined) {
        pushes.push({ id, ...props });
      }
      return writer;
    });

    const App = defineComponent(() => () => h('input', { class: 'ph-input', placeholder: 'x' }));
    const root = flutterRoot();
    createApp(App).mount(root as never);
    await nextTick();
    await tick();

    const findInput = (id: number): number | undefined => {
      for (const kid of childElementIds(id)) {
        if (elementTag(kid) === 'input') return kid;
        const nested = findInput(kid);
        if (nested !== undefined) return nested;
      }
      return undefined;
    };
    const inputId = findInput(root.id);
    expect(inputId).toBeDefined();

    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      id: inputId,
      // fixed key order, CSS-shaped: color first, then the size keys.
      // line-height arrives as px and goes over as the ratio the peer's
      // TextStyle.height reads (24 / 14 — a bare "24" would mean 24×)
      placeholderStyle: 'color:#c8c9cc;font-size:14px;line-height:1.714',
    });

    // unmatch -> clear, and only because this layer wrote one
    getWriter(); // engine state lives on the shared instance below
    const { styleEngine } = await import('../src/vue/renderer');
    styleEngine.setClasses(inputId!, 'plain');
    await tick();
    expect(pushes.at(-1)).toMatchObject({ id: inputId, placeholderStyle: '' });
  });
});
