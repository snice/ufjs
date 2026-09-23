// 共享元素动画的公共件（spec 101）。
//
// 全部是应用层代码：测距用 getBoundingClientRect（web 是 DOM 原生，App 端
// 是 fjs.ui.rect 的同步宿主调用，两者都是视口逻辑像素），飞行靠
// position: fixed 的盒子 + 几何 transition——没有协议变更、没有 Dart 代码。
//
// 两张登记表都是模块级的：跨页面的两个页面 import 同一个模块（分包构建下
// 被两页引用的模块自动进 shared.js prelude），同一个 VM / 同一个页面栈里
// 读写的就是同一份数据。
import { ref, type Ref } from 'vue';

/** 视口坐标系里的一个矩形。 */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 去程 / 同页面的飞行时长：与 fjs-fade 路由转场的 280ms 同拍。 */
export const FLY_MS = 280;
/** 回飞时长：必须先于 280ms 的路由淡出结束，否则飞行盒会随顶层页面
 *  一起被销毁，列表真身接不上（spec 101 §4）。 */
export const CLOSE_MS = 240;

/**
 * 模板 ref 的矩形。web 上函数/字符串 ref 给回组件实例（$el 才是真元素），
 * Flutter 上给回 fjs 元素本身——两种都吃。读不到（ref 还没挂上、元素不存在）
 * 返回零矩形：调用方按「没有起点」跳过飞行，绝不飞向 (0,0)。
 */
export function rectOf(target: unknown): Rect {
  const el = ((target as { $el?: unknown } | null | undefined)?.$el ?? target) as {
    getBoundingClientRect?: () => {
      left: number;
      top: number;
      width: number;
      height: number;
    };
  } | null;
  if (typeof el?.getBoundingClientRect !== 'function') {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const b = el.getBoundingClientRect();
  return { left: b.left, top: b.top, width: b.width, height: b.height };
}

// ── 跨页面：起点槽位登记表 ─────────────────────────────────────────────
// 列表页 push 前记下缩略图的视口矩形。页面被压栈后不会滚动（顶层页盖着
// 它），这张矩形到详情页回飞时依然有效，不需要回去重测——压栈页在 App 端
// 可能已经 offstage，测了反而不可靠。

const sources = new Map<string, Rect>();

export function rememberSource(id: string, rect: Rect): void {
  sources.set(id, rect);
}

export function sourceOf(id: string): Rect | undefined {
  return sources.get(id);
}

// ── 跨页面：一把共享的「飞行中」开关 ────────────────────────────────────
// 同一个共享元素在列表页和详情页各有一个真身，用同一把 id 一把开关：飞行
// 期间两个真身一起藏（一个在底层、一个在顶层，视觉上都不可见），落地时由
// 飞行的发起方打开。手势 / 浏览器后退不经过飞行，开关是开着的，底层真身
// 全程可见——普通淡出自然落位，这就是登记过的降级路径。
//
// 同页面场景不用它：那两个状态（缩略图藏 / 收起）活在同一个组件里，用
// 本地 ref，页面销毁时一起销毁，不会留下卡死的开关。
const flags = new Map<string, Ref<boolean>>();

export function heroHidden(id: string): Ref<boolean> {
  let flag = flags.get(id);
  if (!flag) {
    flag = ref(false);
    flags.set(id, flag);
  }
  return flag;
}
