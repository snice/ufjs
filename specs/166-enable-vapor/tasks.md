# Tasks: 166-enable-vapor

## 0. 版本回退

- [x] T1 应用侧 `vue` / `@vue/runtime-core` → 3.5.43:demo、hello-fjs、racing、fjs-webview;
  fjs-runtime 运行时依赖 ^3.5.43;create 模板 ^3.5.43;两处 specs/164 注释过时版本话术
- [x] T2 CLI:`@vue/compiler-sfc/core/shared` → 3.5.43,+ devDep `@vue/compiler-vapor@3.6.0-rc.9`
  (树里唯一 rc,构建期);fjs-runtime devDep 同步

## 1. 自研 vapor SFC 编译器

- [x] T3 `fjs-runtime/src/vapor/sfc-compiler.ts`:parse(3.5,vapor 属性走 scriptSetup.attrs)
  + compileScript(3.5,无模板)+ compiler-vapor `compile()`(inline+bindingMetadata+isNativeTag
  +scopeId)拼接;`__sfc__.__vapor = true` 统一戳(裸 options / defineComponent / Object.assign
  三形状);`__returned__` 尾巴替换;cssVars → useVaporCssVars(短 id)
- [x] T4 `fjs-runtime/src/vapor/sfc-tags.ts`:isNativeTagFor / sfcParseOptions /
  vaporCompilerOptions / isAutoVapor(node_modules 判定改正则,不引 node:path);
  vue-plugin.ts re-export 保持 import 面不变
- [x] T5 esbuild vueSfcPlugin vapor 分支 + compileVaporSfcModule(vite)改走 compileVaporSfc;
  `__sfc__` 转换/最终 export 所有权归 sfc-compiler
- [x] T6 `useVaporCssVars`(vapor/css-vars + runtime 挂载栈):cssVars 注册按挂载组件分桶,
  block 建成后 renderEffect 应用到块根,scope stop 随组件销毁;后端 seam `setCssVars`
  (flutter=styleEngine.setInlineCustomProps,web=style.setProperty)
- [x] T7 测试迁移:test/helpers/sfc.ts vapor 分支走 compileVaporSfc(VDOM 分支保留
  isNativeTag+hoistStatic);vapor-once-inline 直编改走 compileVaporSfc;
  runtime 877 / cli 447 全绿;typecheck 全绿

## 2. vapor 回归(编译器更换后)

- [x] T8 bench `pnpm run vapor`(TS 模式,更新 1/200/2000 格数字与 specs/161 同量级)+
  `pnpm run native:on`(native 克隆路径)
- [x] T9 demo:`fjs build` 全量 + fjsrun;`vapor-check`(vant 互操作:button 3 / cell 2 /
  switch 1 / stepper 1,点击计数生效);`nav-vapor`(真路由挂 vapor 页,无 js error)

## 3. enableVapor runtime

- [x] T10 flutter:`FlutterRouterOptions.enableVapor` + `vaporComponents`;
  `mount()` vapor 分支(createVaporApp 进 flutterRoot,entry.app 收敛为 `{unmount}`),
  `useRoute` 的 activeNativeRoute 回退;createFjsApp 组内置组件表(canvas/list-view/form/
  picker/rich-text/textarea/defer)+ options.components
- [x] T11 web:`router/web.ts` useRoute 无实例回退;`app/web-vapor.ts` 纯 vapor 壳
  (createVaporApp 起根,页 host 缓存 LRU,滚动快照,进场过渡);app/web.ts 分派
- [x] T12 单测:enableVapor flutter(fjsrun 级断言在 runtime vitest:路由 vapor 挂载/返回/
  响应);enableVapor web 壳(happy-dom:导航/缓存/卸载)

## 4. enableVapor CLI

- [x] T13 `usesEnableVapor(root, entry)`(静态扫描 + 缓存);wrapper plugin/vite resolveId
  关闭;非 vapor SFC 警告;web 别名 `vue` → vue-shim(webPinPlugin 让位)
- [x] T14 包体断言(enableVapor web bundle:无 runtime-dom / fjs-vapor-root / KeepAlive)

## 5. 验收

- [x] T15 `pnpm run typecheck` + `pnpm test`(runtime/cli);flutter test
- [x] T16 纯 vapor 示例(example):flutter(fjsrun 断言)+ web(vite build 产物检查 + dev 冒烟)
- [x] T17 文档:vue3.md(enableVapor、编译器拆分、边界)、toolchain.md(依赖面)
