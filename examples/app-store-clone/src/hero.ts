// Shared-element helpers, copied from hello-fjs/src/hero.ts (specs/101) minus
// the cross-page registries: the Today card expands into an overlay on the
// SAME page, so the origin card stays mounted and can simply be re-measured
// when the overlay flies back (no offstage-page measuring problem).
//
// Measuring is getBoundingClientRect on web and the synchronous fjs.ui.rect
// host call in the App; both give viewport logical pixels. Flying is a
// position: fixed box + geometry transition: no protocol change, no Dart.

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
