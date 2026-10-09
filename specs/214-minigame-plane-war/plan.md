# Plan: 微信小游戏「打飞机」原样移植

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 游戏只画在一块 `<canvas>` 上，走 canvas 两端契约；适配层不区分平台（`loadCanvasImage`/触摸/rAF 两端同形）；验收两端实跑 |
| II 边界即契约 | 否 | op/natives/事件零变更；只动 hello-fjs demo 层 |
| III 同步单线程零序列化 | 否 | 游戏循环在 JS 侧 rAF；canvas 命令走既有 op 通道 |
| IV 外观照 WeUI | 否 | 游戏素材/外观来自原微信项目 |
| V 静默失效是 bug | 是 | 音频/震动降级要在适配层 `console.info` 一次（不是无声无息）；图片加载失败有 `failed` 提示路径 |
| VI 注释记录权衡 | 是 | 适配层头部注释记录「为什么包装 canvas（width 只读）/为什么代理 ctx（图片句柄换身份）/为什么收紧 leafer 判定」 |
| VII JS 能包就不要下 Dart | 是 | 全部 JS 侧 canvas，零 Dart/C++ 改动——本 spec 正是该条款的正面案例 |
| VIII 变更落到文档 | 是 | hello-fjs README 增补该页；spec 214 记录降级与限制 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 示例页 | `examples/hello-fjs/src/pages/example/game/plane-war.vue` | 新：全屏 canvas 页 + 生命周期 + 触摸转发 + 动态 import 游戏入口 |
| 示例页 | `examples/hello-fjs/src/plane-war/wx-adapter.ts` | 新：wx/GameGlobal 适配层（核心） |
| 示例页 | `examples/hello-fjs/src/plane-war/minigame/**` | 新：原样 copy（game.js + js/** 874 行，零字节修改） |
| 示例页 | `examples/hello-fjs/public/plane-war/images/**` | 新：copy（24 张图 ~1MB；audio 不拷，音频降级） |
| 示例页 | `examples/hello-fjs/src/adapters/leafer/platform.ts` | 改：wx 判定加 `createOffscreenCanvas` 特征校验（spec §5） |
| 文档 | `examples/hello-fjs/README.md` | 改：游戏清单/说明补一行 |
| 运行时 / Dart / C++ | — | 零改动 |

## 3. 方案

**适配层（`wx-adapter.ts`，install 后挂到 `globalThis`）**

- `GameGlobal = globalThis`（恒等）。render.js 里 `GameGlobal.canvas = wx.createCanvas()`
  随之把裸全局 `canvas` 定义出来，main.js 的 `canvas.getContext('2d')` 按标识符
  解析自然命中——import 顺序（main.js 首行 `import './render'`）在 ESM 下保持。
- `wx.createCanvas()` 返回**包装对象**而不是 fjs canvas：fjs 的
  `canvas.width/height` 是只读 getter，而 render.js 会 `canvas.width = screenWidth`
  赋值（ESM 严格模式对只读属性赋值会抛 TypeError）。包装对象持有可写的
  width/height（attach 时从真实 canvas 同步，`@resize` 时更新），`getContext()`
  返回 ctx 代理。
- **ctx 代理**：`get` 拦截 `drawImage`——游戏传进来的第一个参数是适配层
  `wx.createImage()` 的壳对象，替换成内部 `loadCanvasImage` 的真实句柄再调用；
  未解码完成（句柄未就绪）时本次调用直接跳过（等价「什么都没画」，下一帧重画
  时图片已就绪——canvas-compat §7 语义）。其余方法/属性透传。
- `wx.createImage()`：壳对象带可写 `.src`；赋值时把 `images/...` 相对路径重写为
  `/plane-war/images/...`（public 目录，与 flappy-bird 的 `/fb/` 同一模式）再
  `loadCanvasImage`。web 侧返回的是浏览器 Image，重复赋 src 不能发生在它身上，
  所以壳与句柄分离。
- `wx.getWindowInfo()` / `wx.getSystemInfoSync()`：返回 attach 时记录的画布
  逻辑像素宽高（`screenWidth/screenHeight` 字段）。
- `wx.onTouchStart/Move/End/Cancel`：回调注册表。页面把 fjs 的 `FjsTouchEvent`
  转成 `{ touches: [{ clientX: t.offsetX, clientY: t.offsetY }] }` 喂进去。
- `wx.createInnerAudioContext()`：no-op 桩（`loop/autoplay/src/currentTime/play()`），
  首次调用 `console.info` 一次说明音频降级。
- `wx.vibrateShort()`：no-op，同样提示一次。
- 页面 `onMounted` 安装全局（幂等），动态 `import('../plane-war/minigame/game.js')`
  引导游戏；keep-alive 下二次进入不重复 boot（模块缓存即天然单例）。

**leafer 判定收紧**：`hasWx = typeof wx !== 'undefined' && !!wx &&
typeof (wx as {createOffscreenCanvas?: unknown}).createOffscreenCanvas === 'function'`，
注释说明「游戏移植的 wx shim 没有离屏画布，不能让 leafer 误判成小程序」。

**页面**：route 块 `{"title": "飞机大战（微信移植）", "scroll": false,
"tabBar": false, "group": "交互游戏", "desc": "微信小游戏原样移植：wx 适配层
+ 零改动游戏代码"}`；模板与 flappy-bird 同构（`.cv { width:100%; height:100%;
touch-action: none; }`）。

**被否备选**：改写游戏码为 TS/类内聚（违背需求方指定的零改动）；全局 rAF 拦截
实现 keep-alive 暂停（要劫持全局函数、殃及其它页面，且需求以跑起来为先——
本期接受离开页面后游戏在后台继续跑，记入已知限制）。

## 4. 风险

- **fjs canvas width 只读**：已用包装对象规避；若游戏其他地方直接拿真实
  canvas 赋值会抛错——已核对全部源码，只有 render.js 一处赋值，走包装对象。
- **fillText(score, …) 传 number**：DOM 会字符串化，App 侧 context-2d 需确认
  同样容忍（验收时观察分数是否显示，异常则在适配层 ctx 代理里 String 化参数）。
- **每敌机 init 重新 initFrames（19 张图 × 对象池复用）**：图片句柄/解码在
  App 侧是宿主调用，比微信的内部缓存重；如掉帧明显，二期在适配层加
  loadCanvasImage 的 src 级缓存（不改游戏码也能做）。v1 观察。
- **音频缺失**：静音是行为差异，页面 desc 与 README 写明。
- **keep-alive 后台运行**：离开页面游戏循环继续（分数继续涨）。已知限制，
  不在 v1 处理。

## 5. 验证路径

```bash
# 静态
pnpm --filter hello-fjs run typecheck
pnpm --filter hello-fjs run build:pages

# Web 实跑
cd examples/hello-fjs && npx fjs dev --web   # 浏览器开 /example/game/plane-war
#   → 截图 + MCP eval 'GameGlobal.databus.score' 随时间增长
#   → 模拟触摸拖动 → 飞机位移；撞机 → 结束画面 → 点击重开

# App 实跑（fjs-go / 宿主）
cd examples/hello-fjs && npx fjs dev          # fjs-go 或 fjs run 连接后同上四步
```
