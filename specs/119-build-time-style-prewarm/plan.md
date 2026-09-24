# Plan: 构建期样式预热

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否（纯性能） | 渲染结果不变；web 走浏览器 CSS、小程序走 skyline，都没有这个引擎。spec §4 写明 |
| II 边界即契约 | 否 | op 协议 / natives / 事件类型都不动。内部约定 `registerStyles(scope, css, hash)` 两处同步：`fjs/src/bundler/vue-plugin.ts`（生成）↔ `fjs-runtime/src/vue/renderer.ts`（接收） |
| III 同步单线程零序列化 | 是 | 导入是 VM 内一次 `JSON.parse` + 填 Map，同步、不过桥 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 快照校验不过 → 放弃并在 `__DEV__`/debug 下 warnOnce 原因；构建期某页抓取失败 → 构建告警（不失败）。快照格式带版本号，版本不符拒绝 |
| VI 注释记录权衡 | 是 | 键为什么这样重建、为什么按「参与匹配的样式表」校验、为什么 Node 里跑、rawText 检查的由来 |
| VII JS 能包就不要下 Dart | 是 | 全部在 JS（runtime）与 Node（CLI），不下 Dart |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`（build 多一步、开关）、`docs/vant-mount-perf.md`（实测）、`docs/performance.md`（一段）、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime · CSS | `packages/fjs-runtime/src/css/style.ts` | `register(scope, css, hash?)` 记样式表日志（哈希、是否 scoped），规则带 `sheet`；`exportSnapshot()` / `importSnapshot()`；defaults 身份改为「按 JSON 内容」可复现；计算缓存命中检查加 `rawText` |
| JS runtime · renderer | `packages/fjs-runtime/src/vue/renderer.ts` | `registerStyles(scope, css, hash?)` 透传 |
| JS runtime · router | `packages/fjs-runtime/src/router/flutter.ts` | `mount()` 前导入该页快照（`globalThis.__fjsStyleSnapshots[path]`，按 matchEpoch 去重）；`captureStyleSnapshots()`：无宿主时逐个静态路由 `replace` + 等补挂 + 导出 |
| JS runtime · app | `packages/fjs-runtime/src/app/flutter.ts` | `createFjsApp().mount()`：见到 `globalThis.__fjsCaptureStyles` 就改跑抓取 |
| CLI · 生成 | `packages/fjs/src/bundler/vue-plugin.ts` | 两处 `registerStyles` 生成加第三参数：`sha1(scope + css)` 前 12 位 |
| CLI · 预热 | `packages/fjs/src/bundler/style-snapshot.ts`（新） | `captureSnapshots(bundlePath)`：Node `vm` 执行 bundle（补 `requestAnimationFrame`），收结果；`appendSnapshot(file, path→json)`：追加一行赋值 |
| CLI · 构建 | `packages/fjs/src/bundler/build.ts` | `BuildOptions.styleSnapshot`；单包：esbuild 之后、字节码之前对 bundle 自身抓取并追加；分包：另打一个临时单包抓取，按页追加到各 chunk；统计行 |
| CLI · 命令 | `packages/fjs/src/bundler/build.ts`（`buildCommand`）、`packages/fjs/src/commands/run.ts` | app 目标默认开；读 `fjs.styleSnapshot === false` 关；dev 不设 |
| 测试 | `packages/fjs-runtime/test/style-snapshot.test.ts`（新）、`packages/fjs/test/style-snapshot.test.ts`（新） | 见 §5 |
| 基准 | `demo/bench/mount-core.ts` + 新入口 `demo/bench/mount-prewarm.ts` | 同一 VM 内先抓后导入，报冷态 |
| 文档 | 见 VIII | |

## 3. 方案

### 3.1 快照格式（v1，JSON）

```ts
{
  v: 1,
  flags: [hasStructural, hasSiblingRules, hasPseudo],   // 决定签名格式与 MatchResult 形状
  media: [[conditionJson, matched], …],                 // 抓取时每个不同 @media 条件的结果
  sheets: [hash, …],      // 参与了本页任何匹配（或提供 :root 变量）的样式表，注册顺序
  globals: [hash, …],     // 抓取时注册的全部全局（非 scoped）样式表
  objs: [ … ],            // 去重后的对象表（decls / 计算样式 / custom / pseudo）
  chains: [[parentChain, suffix, match], …],            // parentChain = -1 表示父无状态（链 id 0）
  matches: [[decls, custom, active, hover, before, after, placeholder], …],  // objs 下标，-1 = 无
  computes: [[chain, parentCompute, style, active, hover, custom, pseudo, defaultsJson, rawText], …],
}
```

**链键重建**：运行时链键是 `${父链id}\u0003${自身签名}`，链 id 是运行时计数器，
不能直接存。快照存「父条目下标 + 签名后缀」这棵树，导入时按拓扑序重放：父条目的
链 id 已知 → 拼出键 → `chainIds` 里有就复用、没有就分配 → `matchCache.set`。之后
运行时元素拼出的键与之相同，自然命中。

**计算结果重建**：`byParent` 以父元素的 computedId 为键，也是运行时计数器。同理
按树重放：父计算节点导入时分配的 styleId 就是子节点的键。只导出「可 memo 且父也在
快照里（或无父）」的节点；带内联样式的元素照常冷算，它下面的子树也照常冷算。

**defaultsId**：现在按 defaults 对象身份发号，跨进程不稳定。改为第一次见到某个
defaults 对象时按 `JSON.stringify` 内容查号（每种 HTML 标签一次），快照里存 JSON，
导入时用同一张表取号。

**rawText**：计算结果与 `rawText` 有关（textDecoration/textOverflow 传递给文本 run），
但签名里没有它。现在命中检查只比 defaultsId，是「谁先算谁进缓存」；预热会改变「谁先」。
`ComputeResult` 加 `rawText`，命中检查一并比较，不一致视作未命中——顺带修掉这个
潜在的错配。

### 3.2 有效性校验（导入前，任一不过即整份放弃）

1. `v === 1`；`flags` 与当前引擎相同。
2. `media`：每个条件在当前视口下的结果与快照相同。
3. `sheets` 里每张表当前都已注册，且相对顺序一致（级联平局看注册顺序）。
4. 当前注册的每张**全局**表都在 `globals` 里（多出来的全局表可能匹配本页元素；
   多出来的 scoped 表只匹配自己作用域，无害）。没有哈希的表（手写 `registerStyles`）
   视作未知：未知全局表 → 放弃。

`:root` 变量表（`rootCustom`）影响所有计算：提供过 `:root` 声明的表算作「参与」。

### 3.3 导入时机

`router/flutter.ts` 的 `mount(entry)`：页面 chunk 已执行（它的 scoped 表已注册，
`register()` 已清过缓存）→ 导入 → `app.mount`。每页记下导入时的 `matchEpoch`，
epoch 没变就不重复导入（再次打开本来就热）。快照字符串挂在
`globalThis.__fjsStyleSnapshots[path]`，第一次导入时 `JSON.parse`。

导入的链进入 retired 队列（引用计数 0），与卸载后保留的链同一套上限与淘汰规则。

### 3.4 构建期抓取

在 Node `vm` 里执行 **Flutter 目标的单包 bundle**（已验证可跑，只需补
`requestAnimationFrame`；引擎行为与 PrimJS 一致，match miss 数逐页相同）。
执行前设 `globalThis.__fjsCaptureStyles = (results) => …`：`createFjsApp().mount()`
见到它就不 `start()`，而是对每个静态路由（跳过含 `:` / `*` 的）：
`router.replace(path)`（无宿主时原地挂载，与真机同样套 Shell、同样的根）→ 等微任务
与 `setTimeout(0)` 各两轮（`<defer>` 补挂、Vue nextTick）→ `styleEngine.exportSnapshot()`
→ 下一页（`replace` 会拆掉上一页）。单页抛错只记下来跳过。

- 单包构建：直接用输出的 `bundle.js` 抓取，再把全部快照追加到它末尾，然后才编字节码。
- 分包构建：另打一个临时单包（同入口、不压缩无所谓、无字节码）抓取，按页追加到
  各自 chunk，然后编字节码。
- 追加的是一行：`(globalThis.__fjsStyleSnapshots ??= {})["/vant-form"] = "<json>";`
  ——字符串而不是对象字面量：字节码里对象字面量每次执行 chunk 都要构造，字符串
  只在真的打开这页时才 `JSON.parse`。（es2019 目标没有 `??=`，用等价写法。）

**否掉的备选**：
- *用 fjsrun 抓*：CLI 只随包分发 fjsc（编译器），用户机器上没有 fjsrun；Node 必然有。
- *只预热匹配*：只省 12 ms（容器），计算段的 25 ms 才是大头。
- *存规则下标而不是结果*：规则下标取决于运行时注册顺序（分包下随导航顺序变），
  存折叠后的声明更稳，也省掉导入时再折叠一遍。
- *快照放单独的 asset 文件*：多一次宿主读文件；而页面 chunk 本来就在打开时加载。
- *按内容哈希在运行时算样式表 id*：vant 80 KB CSS 在解释器里哈希要几毫秒，构建期
  算好传进来零成本。

## 4. 风险

- **结果必须与冷算相同**：对拍（op 流逐字节）+ 单测（逐元素计算样式相等）。
  rawText 修正见 3.1。
- **校验漏项**：新增影响匹配的全局状态（例如将来的 `:dir`、容器查询）必须进 flags /
  校验，否则快照静默出错。在 `exportSnapshot` 旁注释列出「缓存键之外影响结果的输入」。
- **Node 与 PrimJS 差异**：对象键序、数字格式化（`String(1.5)`）一致；es2019 目标。
  对拍覆盖。
- **包体积**：每页快照几十 KB，构建输出统计行报出；太大时再考虑压缩字段名。
- **构建时间**：demo 11 页，单列报出。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
pnpm --filter @ufjs/cli run build
pnpm --filter demo run build:pages        # 统计行；chunk 末尾有快照
pnpm --filter demo run build:web          # 不受影响
(cd packages/flutter_fjs/native && cmake --build build-native -j)
pnpm --filter demo run bench:mount        # 含 prewarm 模式
# 对拍：prewarm 与不预热两个 bundle 的 --hex 输出 md5 相同
```
