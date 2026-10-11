// @vitest-environment happy-dom
// 页面级生命周期（page-lifecycle.ts）：mp 的 onShow / onHide / onUnload
// 语义在 web / Flutter 端的等价物。show 在挂载与 keep-alive 回切时触发，
// 首次挂载时 mounted / activated 同一轮 flush 去重成一次；hide 在切走时
// 触发；unload 在卸载时触发。
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { onHide, onShow, onUnload } from '../src/page-lifecycle';

async function tick(): Promise<void> {
  await nextTick();
  await new Promise((r) => setTimeout(r, 20));
}

function makePage(log: string[], name: string) {
  return defineComponent({
    name,
    setup() {
      onShow(() => log.push(`${name}:show`));
      onHide(() => log.push(`${name}:hide`));
      onUnload(() => log.push(`${name}:unload`));
      return () => h('view', name);
    },
  });
}

describe('page lifecycle (web/flutter surface)', () => {
  it('show fires once on mount, hide on switch away, show again on switch back', async () => {
    const log: string[] = [];
    const current = ref('a');
    const host = createApp({
      setup() {
        return () =>
          h(KeepAlive, () => h(current.value === 'a' ? makePage(log, 'a') : makePage(log, 'b')));
      },
    });
    const root = document.createElement('div');
    host.mount(root);
    await tick();
    // mounted + activated 同轮触发：去重后只记一次
    expect(log).toEqual(['a:show']);

    current.value = 'b';
    await tick();
    expect(log).toEqual(['a:show', 'a:hide', 'b:show']);

    current.value = 'a';
    await tick();
    expect(log).toEqual(['a:show', 'a:hide', 'b:show', 'b:hide', 'a:show']);

    host.unmount();
    await tick();
    // app 整体卸载时 KeepAlive 对当前激活实例可能触发两次 unmounted
    // （Vue 的缓存清理 + 子树拆卸各走一遍）——卸载语义只保证「必达」
    expect(new Set(log.filter((l) => l.endsWith(':unload')))).toEqual(
      new Set(['a:unload', 'b:unload']),
    );
  });
});
