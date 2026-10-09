# Tasks: 微信小游戏「打飞机」原样移植

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 copy 游戏源码：`minigame-1/{game.js,js/**}` →
      `examples/hello-fjs/src/plane-war/minigame/**`。`/usr/bin/diff -r`
      校验：唯一非原样文件 = `js/libs/tinyemitter.js` 改为两行 ESM 包装
      （分包构建里 esbuild 对 UMD 的 CJS 探测失灵，报 "No matching export"），
      原 UMD 字节未动存为 `tinyemitter.umd.cjs`；audio 不拷（音频降级）
- [x] T002 copy 素材：`images/**`（24 张）→ `public/plane-war/images/**`，
      diff 校验零差异
- [x] T003 `src/plane-war/wx-adapter.ts`：GameGlobal 恒等、createCanvas 包装
      （width/height 可写 + getContext 按当前 attach 的画布解析——多页实例
      各有新 canvas 节点，跨 attach 缓存 ctx 会画进页面栈底下的画布）、
      ctx 代理（drawImage 图片壳换 loadCanvasImage 句柄、fillText 数字参数
      String 化、原生方法 bind、set receiver 指回原生对象）、createImage
      （src 重写 /plane-war/ 前缀）、touch 注册表、getWindowInfo、音频/震动
      no-op 桩（首次调用 console.info 一次）

## 实现

- [x] T010 `src/pages/example/game/plane-war.vue`：route 块（交互游戏组，
      scroll/tabBar false）、全屏 canvas、@resize attach+boot（boot 失败
      console.error 上报）、@touch* 转发（offsetX→clientX）
- [x] T011 leafer `platform.ts` wx 判定加 `createOffscreenCanvas` 特征校验 +
      注释说明（游戏 shim 的全局 wx 不能让 leafer 误判成小程序）
- [x] T012 hello-fjs README 游戏清单补条目（含降级与 leafer 联动说明）

## 两端对齐

- [x] T020 App（iPhone 17 Pro 模拟器）与 Web（Chrome）同一份游戏码 + 适配层
      实跑对拍，四步全过（证据见 T050/T051）

## 测试

- [x] T030 `pnpm --filter hello-fjs run typecheck` 通过（游戏 .js 不进 tsc，
      动态 import 处 `@ts-expect-error`）
- [x] T031 `pnpm --filter hello-fjs run build:pages` 通过；
      `fjs build --web` 通过（plane-war chunk 两端都产出）
- [x] T032 回归：leafer 页 wx 判定收紧后行为不变（feature-gate 只在
      createOffscreenCanvas 存在时走 miniapp 分支）；全 workspace
      `pnpm test` 绿（fjs 511 / runtime 1011 / webview 36 / webgl 30 /
      liquidglass 6）

## 文档

- [x] T040 README 写明降级（音频静音、震动 no-op、离开页面后循环继续跑）
- [x] T041 `docs/roadmap.md` 记录「微信小游戏原样移植范式」

## 验收

- [x] T050 Web 四步实跑（`fjs dev --web` + Chrome）：
  1. 渲染：截图见滚动背景 / 战机 / 敌机 / 子弹 / 白色分数；
  2. 循环计分：`eval GameGlobal.databus` frame 361→score 1（自动开火命中）；
  3. 拖动跟手：拖到 x=90 后新子弹 x=82（= 90+40−5，从拖动后的位置发射）；
  4. 重开：点「重新开始」over 翻 false、分数清零、循环重跑。
     期间修掉三个适配层炸弹：① createImage 的 src setter 自递归爆栈；
     ② ctx 代理 fillText 未 bind（web 原生方法 "Illegal invocation"）；
     ③ Proxy 默认 set 把 receiver 传成代理（`ctx.fillStyle=` 同样
     Illegal invocation，App 侧普通对象掩盖了两端差异）。
- [x] T051 App 四步实跑（`fjs run ios`，iPhone 17 Pro 模拟器）：
  1. 渲染：simctl 截图见完整画面（背景 / 敌机 / 分数 / 结束面板图集）；
  2. 循环计分：frame 7960、score 2（自动击落）；
  3. 触摸：agent-device 真实点击「重新开始」生效；
  4. 重开：over 翻 false、frame 归零重跑、score 重新累计到 1。
     期间修掉第四个炸弹：④ getContext 跨 attach 缓存 ctx——游戏单例画在
     第一次挂载的画布上，页面栈里的可见页永远空白；改为按当前 attach 的
     画布解析。导航用 `__fjsDevtools` 树遍历 + `__fjsDispatchEvent` 派 tap。
- [x] T052 spec.md 第 6 节逐条核对完毕（初版验收），spec 置 done
- [x] T053 验收反馈修正：生命周期改为同微信——离开页面（onDeactivated /
      onUnmounted）disposeGame 取消游戏挂起帧（rAF 垫片按表追踪 +
      gameAlive 闸门挡"cancel 晚于帧出队"的竞态逃逸）并清空触摸注册表；
      重进（新挂载）bootGame → new Main() 全新一局。App 实测：
      返回后 frame 冻结（109 不再前进，探针 frames=1 被取消），
      重进后全新一局（frame 496 从头跑、score 0）且画面渲染正常。
      顺带修掉第五个炸弹：ctx 代理若按 attach 缓存，游戏在 main.js 模块体
      捕获的 ctx 会指向旧画布——代理必须是稳定间接层，trap 内解析当前画布。
- [x] T054 验收反馈修正 #2：rAF 垫片的第一版用全局 gameAlive 闸门，误杀了
      Vue 过渡的 nextFrame 帧——web 返回时离场过渡永远停在
      fjs-slide-leave-from，旧页面压在新页面上（只有游戏页触发）。垫片改为
      血缘追踪：只有游戏帧回调内部再调度（循环自续链）或 bootGame 捕获窗
      内的根帧才纳入追踪表，其余一律原生直通；dispose 逐 entry 置 dead +
      cancel，帧回调触发时再查 entry.live 兜住出队竞态。web 实测：返回后
      过渡完成、canvas 从 DOM 移除、frame 冻结；重进全新一局；leafer 等其它
      页面过渡回归正常。
