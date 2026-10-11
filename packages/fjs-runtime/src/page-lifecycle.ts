// 页面级 show / hide / unload 的 web / Flutter 等价物。mp 端由 wx 运行时
// 原生提供（wx/vue.ts，同名同语义），'fjs' 在 mp 构建里解析到 wx vendor，
// 两份表面因此同名对齐——应用代码统一 `import { onShow, onHide } from 'fjs'`。
//
// 语义对齐 mp：
//   onShow   —— 首次显示 + 每次切回。web / Flutter：挂载 + keep-alive 回切；
//               首次挂载时 mounted 与 activated 同一轮 flush 都会触发，去重。
//   onHide   —— 页面被盖住 / 切走：keep-alive 的 deactivated。
//   onUnload —— 页面销毁：unmounted。
// Flutter 的 tab park 若不是 Vue KeepAlive，activated / deactivated 不会
// 触发，此时只剩 mounted / unmounted 生效——跟随其页面模型逐步对齐。
import { onActivated, onDeactivated, onMounted, onUnmounted } from '@vue/runtime-core';

export function onShow(fn: () => void): void {
  // 同一轮挂载里 mounted / activated 只派发一次：首个钩子置位，本轮
  // 微任务结束后复位，之后的每次 activated 正常派发
  let inMountFlush = false;
  const fire = (): void => {
    if (inMountFlush) return;
    inMountFlush = true;
    queueMicrotask(() => {
      inMountFlush = false;
    });
    fn();
  };
  onMounted(fire);
  onActivated(fire);
}

export function onHide(fn: () => void): void {
  onDeactivated(fn);
}

export function onUnload(fn: () => void): void {
  onUnmounted(fn);
}
