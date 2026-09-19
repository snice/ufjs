// `@keyframes` and the `animation` shorthand: the engine resolves them and
// hands the peer longhands + frames (css/animation.ts).
import { describe, expect, it } from 'vitest';
import { parseAnimationShorthand } from '../src/css/animation';
import { parseStylesheet } from '../src/css/parser';
import { StyleEngine } from '../src/css/style';

async function styleTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function engineWith(css: string, classes: string[], tags: string[] = []) {
  const parentOf = new Map<number, number | null>([[1, null]]);
  const childrenOf = new Map<number, number[]>([[1, []]]);
  for (let i = 2; i <= classes.length; i++) {
    parentOf.set(i, i - 1);
    childrenOf.set(i - 1, [i]);
    childrenOf.set(i, []);
  }
  const applied = new Map<number, Record<string, unknown>>();
  const engine = new StyleEngine(parentOf, childrenOf, (id, style) => applied.set(id, style));
  engine.register(null, css);
  classes.forEach((c, i) => {
    engine.ensure(i + 1, tags[i] ?? 'view');
    engine.setClasses(i + 1, c);
  });
  return applied;
}

describe('animation shorthand', () => {
  it('reads the parts in any order', () => {
    expect(parseAnimationShorthand('van-rotate .8s linear infinite')).toEqual({
      animationName: 'van-rotate',
      animationDuration: '.8s',
      animationTimingFunction: 'linear',
      animationDelay: '0s',
      animationIterationCount: 'infinite',
      animationDirection: 'normal',
      animationFillMode: 'none',
      animationPlayState: 'running',
    });
    const two = parseAnimationShorthand('fade 1s 200ms ease-in both alternate 3, spin steps(12) 2s');
    expect(two.animationName).toBe('fade, spin');
    expect(two.animationDuration).toBe('1s, 2s');
    expect(two.animationDelay).toBe('200ms, 0s');
    expect(two.animationTimingFunction).toBe('ease-in, steps(12)');
    expect(two.animationFillMode).toBe('both, none');
    expect(two.animationDirection).toBe('alternate, normal');
    expect(two.animationIterationCount).toBe('3, 1');
  });

  it('lets a later longhand override one part (vant --circular)', async () => {
    const applied = engineWith(
      `.spin { animation: van-rotate .8s linear infinite }
       .spin--circular { animation-duration: 2s }
       @keyframes van-rotate { 0% { transform: rotate(0) } to { transform: rotate(360deg) } }`,
      ['spin spin--circular'],
    );
    await styleTick();
    expect(applied.get(1)).toMatchObject({
      animationName: 'van-rotate',
      animationDuration: '2s',
      animationIterationCount: 'infinite',
    });
  });

  it('expands a shorthand holding var() after substitution', async () => {
    const applied = engineWith(
      `.root { --dur: .8s }
       .spin { animation: van-rotate var(--dur) linear infinite }
       @keyframes van-rotate { to { transform: rotate(360deg) } }`,
      ['root', 'spin'],
    );
    await styleTick();
    expect(applied.get(2)).toMatchObject({
      animationName: 'van-rotate',
      animationDuration: '.8s',
      animationTimingFunction: 'linear',
    });
  });
});

describe('@keyframes', () => {
  it('is collected instead of warned about, frames sorted and merged', () => {
    const frames: { name: string; frames: { offset: number; decls: Record<string, unknown> }[] }[] = [];
    const rules = parseStylesheet(
      `@keyframes van-circular {
         0% { stroke-dasharray: 1,200; stroke-dashoffset: 0 }
         50% { stroke-dasharray: 90,150; stroke-dashoffset: -40 }
         to { stroke-dasharray: 90,150; stroke-dashoffset: -120 }
       }
       @-webkit-keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: .2 } }`,
      null,
      0,
      undefined,
      frames,
    );
    expect(rules).toHaveLength(0);
    expect(frames[0].name).toBe('van-circular');
    expect(frames[0].frames).toEqual([
      { offset: 0, decls: { strokeDasharray: '1,200', strokeDashoffset: 0 } },
      { offset: 0.5, decls: { strokeDasharray: '90,150', strokeDashoffset: -40 } },
      { offset: 1, decls: { strokeDasharray: '90,150', strokeDashoffset: -120 } },
    ]);
    expect(frames[1].frames.map((f) => f.offset)).toEqual([0, 0.5, 1]);
  });

  it('ships the frames of the named animations with the style', async () => {
    const applied = engineWith(
      `.a { animation: fade 1s }
       .b { animation-name: nope }
       @keyframes fade { from { opacity: 0 } to { opacity: 1 } }`,
      ['a', 'b'],
    );
    await styleTick();
    expect(applied.get(1)!.animationKeyframes).toEqual({
      fade: [
        { offset: 0, style: { opacity: 0 } },
        { offset: 1, style: { opacity: 1 } },
      ],
    });
    // a name with no @keyframes block runs nothing
    expect(applied.get(2)!.animationKeyframes).toBeUndefined();
  });

  it('resolves color: currentColor to the inherited value (vant spinner paint color)', async () => {
    // `.van-loading__spinner { color: currentColor }`: left verbatim the peer
    // would parse the literal string as no color and paint the arc black
    const applied = engineWith(
      `.btn { color: #fff }
       .spinner { color: currentColor }
       .icon { stroke: currentColor }`,
      ['btn', 'spinner', 'icon'],
    );
    await styleTick();
    expect(applied.get(2)!.color).toBe('#fff');
    // on fill/stroke the keyword stays for the svg painter to resolve
    // against the node's own color — that contract is unchanged
    expect(applied.get(3)!.color).toBe('#fff');
    expect(applied.get(3)!.stroke).toBe('currentColor');
  });

  it('resolves var() inside frames against the element', async () => {
    const applied = engineWith(
      `.root { --move: 40px }
       .bar { animation: slide 1s }
       @keyframes slide { to { transform: translateX(var(--move)) } }`,
      ['root', 'bar'],
    );
    await styleTick();
    expect(applied.get(2)!.animationKeyframes).toEqual({
      slide: [{ offset: 1, style: { transform: 'translateX(40px)' } }],
    });
  });
});

// vant's loading spinner — the shape this whole file exists for: the spinner
// box runs `van-rotate` (a var() shorthand, overridden duration), the svg
// circle runs `van-circular` on its stroke dashes via a type selector.
describe('vant loading spinner (svg + keyframes)', () => {
  it('matches `.wrap circle`, ships stroke props and the circle frames', async () => {
    const applied = engineWith(
      `:root { --van-loading-spinner-duration: .8s }
       .spinner { animation: van-rotate var(--van-loading-spinner-duration) linear infinite }
       .spinner--circular { animation-duration: 2s }
       .circular { display: block; width: 100%; height: 100% }
       .circular circle {
         animation: van-circular 1.5s ease-in-out infinite;
         stroke: currentColor; stroke-width: 3; stroke-linecap: round;
       }
       @keyframes van-rotate { 0% { transform: rotate(0) } to { transform: rotate(360deg) } }
       @keyframes van-circular {
         0% { stroke-dasharray: 1,200; stroke-dashoffset: 0 }
         50% { stroke-dasharray: 90,150; stroke-dashoffset: -40 }
         to { stroke-dasharray: 90,150; stroke-dashoffset: -120 }
       }`,
      ['spinner spinner--circular', 'circular', ''],
      ['view', 'svg', 'circle'],
    );
    await styleTick();
    // the spinner box: var() shorthand expanded, the later longhand override kept
    expect(applied.get(1)).toMatchObject({
      animationName: 'van-rotate',
      animationDuration: '2s',
      animationIterationCount: 'infinite',
      animationKeyframes: {
        'van-rotate': [
          { offset: 0, style: { transform: 'rotate(0)' } },
          { offset: 1, style: { transform: 'rotate(360deg)' } },
        ],
      },
    });
    // the svg circle: type selector matched, stroke props shipped verbatim,
    // `color` inherited for currentColor, dash frames attached
    expect(applied.get(3)).toMatchObject({
      strokeWidth: 3,
      strokeLinecap: 'round',
      stroke: 'currentColor',
      animationName: 'van-circular',
      animationDuration: '1.5s',
      animationKeyframes: {
        'van-circular': [
          { offset: 0, style: { strokeDasharray: '1,200', strokeDashoffset: 0 } },
          { offset: 0.5, style: { strokeDasharray: '90,150', strokeDashoffset: -40 } },
          { offset: 1, style: { strokeDasharray: '90,150', strokeDashoffset: -120 } },
        ],
      },
    });
  });
});
