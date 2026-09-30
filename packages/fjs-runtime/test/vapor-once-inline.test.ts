// The ONCE-cell rewrite (once-inline.ts) against real compiler-vapor
// output: a key-only text becomes repeatTemplate; a prop read stays an
// effect; a dynamic list stays createFor.
import { compileScript, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import { inlineVaporOnce } from '../src/vapor/once-inline';

function vapor(source: string): string {
  const { descriptor, errors } = parse(source, { filename: 't.vue' });
  if (errors.length) throw errors[0];
  const { content } = compileScript(descriptor, {
    id: 'data-v-x',
    inlineTemplate: true,
    templateOptions: { compilerOptions: { isNativeTag: (t: string) => t === 'view' || t === 'text' } },
  });
  return inlineVaporOnce(content);
}

describe('inlineVaporOnce', () => {
  it('turns a key-only static cell into repeatTemplate', () => {
    const code = vapor(`<script setup vapor lang="ts">
defineProps<{ show: boolean }>();
</script>
<template>
  <view>
    <view v-if="show">
      <view v-for="r in 50" :key="r" class="row">
        <view v-for="(_, i) in 40" :key="i" class="cell">
          <text class="tiny">{{ i }}</text>
        </view>
      </view>
    </view>
  </view>
</template>`);
    expect(code).toContain('repeatTemplate as _repeatTemplate');
    expect(code).toContain('_repeatTemplate(');
    expect(code).not.toMatch(/_renderEffect\(/);
    // the row list is still a for: its body is the cell batch, not a cell itself
    expect(code).toContain('_createFor(');
  });

  it('keeps an effect that reads a prop inside a static v-for', () => {
    const code = vapor(`<script setup vapor lang="ts">
defineProps<{ n: number }>();
</script>
<template>
  <view>
    <text v-for="i in 3" :key="i">{{ n }}</text>
  </view>
</template>`);
    expect(code).toContain('_renderEffect');
    expect(code).not.toContain('repeatTemplate');
  });

  it('leaves a dynamic list on createFor', () => {
    const code = vapor(`<script setup vapor lang="ts">
defineProps<{ items: number[] }>();
</script>
<template>
  <view>
    <text v-for="item in items" :key="item">{{ item }}</text>
  </view>
</template>`);
    expect(code).toContain('_createFor(');
    expect(code).toContain('_renderEffect');
    expect(code).not.toContain('repeatTemplate');
  });
});
