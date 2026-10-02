// hello-js —— 不用任何框架，直接写 element API 的示例 app。
//
// 三屏：
//   4050 压测   和 hello-fjs 的 example/interaction/flat-4050 同构的一页，但没有
//               Vue：同样的 50×40 网格、同样的量法，量的是 element API 本身的账，
//               见 flat4050.ts
//   组件总览   已实现组件各来一个，见 gallery.ts
//   主题压测   和 hello-fjs 的 example/theme 同构的一页，把「样式重排慢」拆成
//              框架的账和引擎的账，见 theme-bench.ts
//
// 屏是**换掉**而不是藏起来的：藏起来的那一屏，它的定时器还在跑，压测采样窗口
// 里混进来的每一帧都会顶掉「最慢帧」那一格。
import { createRoot, h, insert, setProps, type Element } from 'fjs';
import { mountFlat4050 } from './flat4050';
import { mountGallery } from './gallery';
import { mountThemeBench } from './theme-bench';

type Screen = { name: string; mount: (host: Element) => () => void };

const SCREENS: Screen[] = [
  { name: '4050 压测', mount: mountFlat4050 },
  { name: '主题压测', mount: mountThemeBench },
  { name: '组件总览', mount: mountGallery },
];

const root = createRoot('safe-area');
const column = h('view', { style: { flexGrow: 1 } });
insert(root, column);

const tabs = h('view', {
  style: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    backgroundColor: '#F0F0F3',
  },
});
insert(column, tabs);

const stage = h('view', { style: { flexGrow: 1 } });
insert(column, stage);

// tab 条不进样式引擎：它是外壳，切主题时不该被重算，也不该出现在压测的
// 节点数里——不然「4000 节点」这个标签就不准了
const tabStyle = (on: boolean) => ({
  flexGrow: 1,
  alignItems: 'center',
  padding: '8px 0',
  borderRadius: 7,
  backgroundColor: on ? '#007AFF' : '#FFFFFF',
});

let current = -1;
let dispose: (() => void) | null = null;
const tabCells: Element[] = [];
const tabLabels: Element[] = [];

function show(index: number): void {
  if (index === current) return;
  dispose?.();
  current = index;
  for (let i = 0; i < tabCells.length; i++) {
    setProps(tabCells[i], { style: tabStyle(i === index) });
    setProps(tabLabels[i], { style: { fontSize: 13, color: i === index ? '#FFFFFF' : '#333333' } });
  }
  dispose = SCREENS[index].mount(stage);
}

SCREENS.forEach((screen, i) => {
  const label = h('text', {}, screen.name);
  const cell = h('view', { onTap: () => show(i) }, [label]);
  insert(tabs, cell);
  tabCells.push(cell);
  tabLabels.push(label);
});

show(0);

// 脚本手柄（specs/190）：真机上 `fjs eval '__helloTab(2)'` 切到压测屏，再用
// 该屏自己的手柄（__flat4050 等）驱动——不必手点。
(globalThis as Record<string, unknown>).__helloTab = show;
