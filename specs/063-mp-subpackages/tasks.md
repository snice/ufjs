# Tasks: mp 编译支持分包（subPackages）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 归属与校验（先做，后面都依赖它）

- [x] T001 `config.ts`：`FjsConfig.mp.subpackages` 类型（root/pages/public）
- [x] T002 `mp/subpackage.ts`：root 校验（保留名、互相前缀、字符集）+ 页面归属
      （exclude 同款匹配；多包命中、tab 页命中报错）
- [x] T003 `mp/subpackage.ts`：字符串字面量 walker（`transformLiterals`：跳过
      注释、字符串、模板串，模板 `${}` 表达式按代码递归）之上的
      `rewritePathPrefixes` 与 `findPathPrefixes`

## 实现

- [x] T010 `build.ts`：页面按归属 emit 到 `<root>/pages/<name>/`，app.json 分包
      条目对应；`appJson` 支持 subPackages（project.ts），配置为空时输出与
      现状逐字节同形
- [x] T011 `build.ts` Emitter：resolveFor 携带归属（fromDir → root）；import
      静态资源落 `<root>/assets/`；npm shim 按包落位
- [x] T012 `build.ts` writeNpm：vendor 按归属集合拆包（共享/主包引用 → 主包
      vendor），banner 与 runtime external 按各 vendor 相对路径计算，shim 指向
      spec 实际所在 vendor，outRoot package.json 列全量依赖
- [x] T012b（实现期新增）`computeLocalModuleOwners`：本地模块逐包 BFS 可达性
      归属，只被一个分包可达的进 `<root>/fjs/shared/`（否则 adapters 把大库
      vendor 拽回主包），见 plan §3 修订
- [x] T013 `build.ts` public 目录搬迁：主包 images 拷贝跳过已声明目录；目录复制
      到 `<root>/`；public-data registry key 改写为 `/<root>/...`（模块留主包）；
      WX_PATH_EXTENSIONS 文件落到 `<root>/`
- [x] T014 `build.ts` 产物改写 + 守卫：分包产物 .ts/.wxml 前缀改写；包外任何
      产物出现已搬目录前缀 → 报错并列出文件（hello-fjs 上以探针实测触发）
- [x] T015 build.ts 头部产物形状注释补分包两行

## 实现（第二轮：真机发现的路由导航 bug）

- [x] T055 `fjs-runtime/src/wx/router.ts`：路由记录新增可选 `mpPage`（页面在
      小程序包内的真实路径），`mpUrl` 优先用它、`isTabPagePath` 改为按
      mpPage/默认形状精确匹配（原来的 `split('/')[1]` 取名对分包路径失效）；
      `build.ts` 的 routes.ts 为每个页面 emit `mpPage`。新增
      `fjs-runtime/test/wx-router.test.ts`（分包/主包/带 query 导航 +
      isTabPagePath 精确匹配）。

## 实现（第三轮：用户反馈）

- [x] T056 删除 writeNpm 产出的产物根 package.json：依赖已全部 vendor，文件在
      miniprogramRoot 之外不上传，只会诱发 DevTools 的 npm 构建提示；
      `writeNpm()` 去掉 outRoot 参数，docs/miniprogram.md 与 build.ts 头注同步
- [x] T057 分包预下载：`config.ts` 增 `mp.preloadRule`（fjs 路由 key）；
      `subpackage.ts` 增 `translatePreloadRule`（路由→真实页面路径翻译 +
      未知路由/root/network 报错）与 `mpPageOf`；`appJson` 产出 `preloadRule`
      键（空配置不输出）；hello-fjs 配置"进示例 tab 预下载 game+canvas"；
      新增 translatePreloadRule / mpPageOf / appJson preloadRule 单测

## 测试

- [x] T030 `test/mp-subpackage.test.ts`：归属（命中/歧义/tab/保留名/前缀冲突/
      public 目录双claim）
- [x] T031 同文件：rewritePathPrefixes（完整字面量、模板串头部、表达式内字面量、
      注释不触发、非目标前缀不触发、不重复改写）、findPathPrefixes、appJson
      subPackages 形状与空配置同形
- [x] T032 同文件：Emitter npm 归属（单包 spec → 包内 vendor + `./vendor.js`
      shim；主包+分包共用 spec → 主包 vendor，各包 shim 指主包）

## 文档

- [x] T040 `docs/miniprogram.md`：产物结构树 + emit 章节后新增「分包（specs/063）」
      小节（配置形状、归属规则、守卫、已知限制）
- [x] T041 同文件 2MB 约束段落改为指向分包；`docs/roadmap.md` 小程序track
      「分包」移出待续、补 ✅ 行

## 验收

- [x] T050 `pnpm test`（fjs 258 全过）+ `pnpm run typecheck`（全 workspace）
- [x] T051 hello-fjs 实构建核对 spec §6.1–6.4：app.json 主包 39 页 +
      subPackages（game 6 页 / canvas 5 页）、tabBar 4 页留主包；主包无
      `fjs/npm/`（vendor.js 不复存在）、无 wm/fb 目录；game vendor 212KB
      （leafer）、canvas vendor 944KB（f2+spine+anime+motion）；主包源码
      ~1240KB（原 3.1MB）
- [x] T052 demo 回归：无 subpackages 配置，app.json 无 subPackages 键，
      vendor 单包（6 页 + pinia/vendor 同形）
- [x] T053 spec §6.5 错误路径：歧义/tab/保留名/前缀冲突/public 目录双claim
      由 T030 单测覆盖；包外引用守卫在 hello-fjs 上探针实测（报错列出
      pages/example/example.ts）
- [ ] T054 用户在微信开发者工具打开 `examples/hello-fjs/dist/mp` 预览：
      80051 消失、example/game 与 example/canvas 页面可进、游戏图正常显示
