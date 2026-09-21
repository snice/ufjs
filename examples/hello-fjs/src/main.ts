// hello-fjs — 组件示例大全（小程序 / hello uni-app 风格）。
//
// 同一份代码跑两个平台：
//   pnpm build / pnpm dev        → Flutter（每个路由是一个原生 Navigator 页面）
//   pnpm build:web / pnpm dev:web → 浏览器（vue-router + DOM 标签适配）
// 路由表由 src/pages 自动生成，见 fjs/pages。
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import { plugins } from 'fjs/plugins';
import Shell from './Shell.vue';

createFjsApp({
  plugins,
  routes,
  transition: 'fjs-slide',
  shell: Shell,
  setup(app) {
    app.config.errorHandler = (err: unknown, _i: unknown, info: string) => {
      console.log('[vue-error]', info, String(err));
      const stack = (err as Error)?.stack;
      if (stack) console.log('[vue-stack]', stack);
    };
  },
}).mount();

// spec 088 断点调试的目标代码：每 2s 跳一次，给 `fjs debug` + Chrome
// DevTools 一个稳定可命中的断点位置（Sources → bundle.js 搜 "debug-probe"）。
// console.debug 走日志通路；调试器附加期间它由引擎转成 CDP 的
// consoleAPICalled 直送 DevTools。
let probeCount = 0;
setInterval(() => {
  probeCount++;
  console.debug('[debug-probe] tick', probeCount);
}, 2000);
