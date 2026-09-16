# Plan: mp 编译支持分包（subPackages）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不涉及 | 页面源码零改动；分包只重排 mp 产物文件位置与 URL 前缀 |
| II 边界即契约 | 不涉及 | 纯 CLI 构建层 |
| III 同步单线程零序列化 | 不涉及 | 构建期字符串处理 |
| IV 外观照 WeUI | 不涉及 | |
| V 静默失效是 bug | **涉及** | 三类错配全部构建期报错：tab 页/歧义页面配入分包、public 目录被包外引用、root 非法；URL 改写漏网会让真机断图——用"改写字面量 + 包外引用报错"而不是运行时映射（见 §3） |
| VI 注释记录权衡 | 涉及 | subpackage.ts 头注记录"为什么改写字面量而不是运行时映射"；vendor 拆分注释记录"为什么共享库进主包" |
| VII JS 能包就不要下 Dart | 不涉及 | |
| VIII 变更要落到文档 | 涉及 | docs/miniprogram.md emit 章节 + 2MB 约束更新；build.ts 头部产物形状注释 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/project/config.ts` | `FjsConfig.mp.subpackages` 类型 |
| CLI / 构建 | `packages/fjs/src/mp/subpackage.ts`（新） | 配置校验与页面归属；产物 URL 前缀改写/扫描（字符串字面量 walker） |
| CLI / 构建 | `packages/fjs/src/mp/build.ts` | 页面 emit 目录按归属分流；Emitter 带 root 归属；vendor 按包拆分；public 目录搬迁 + 改写 + 守卫；appJson 透传 |
| CLI / 构建 | `packages/fjs/src/mp/project.ts` | `appJson` 支持 `subPackages` 键（主包 pages 只列主包页面） |
| 测试 | `packages/fjs/test/mp-subpackage.test.ts`（新） | 归属/校验/改写/appJson/vendor 归属单测 |
| 文档 | `docs/miniprogram.md` | emit 章节加分包小节；2MB 约束改为指向分包 |

runtime / web / Dart / C++ 全部不动。

## 3. 方案

**归属规则**（一次性算好，构建全程确定）：

- 页面归属：`mp.subpackages[].pages` 片段匹配，语义与 `mp.exclude` 完全一致
  （path 全等 / includes / name 全等）。多包命中 → 报错；tab 页命中 → 报错；
  被 `exclude` 掉的页面先过滤再分配。
- npm 依赖归属：**按引用方集合**。只被一个分包的模块引用 → 该包
  `<root>/fjs/npm/vendor.js`；被主包引用、或被 ≥2 个包引用 → 主包 vendor。
  子包 require 主包合法，shim（每包一份 `fjs/npm/<spec>.js`）指向 spec 实际
  所在的 vendor——所以共享库单实例，不需要任何回写。Emitter 在 resolve 时记录
  `(owner, spec)`，vendor 与 shim 在 writeNpm（所有模块 emit 完之后）统一产出，
  时序天然成立。banner/plugin 里的 `require('../runtime.js')` 按各 vendor 到
  `fjs/runtime.ts` 的相对路径动态计算。
- **本地模块归属（实现期修订，原计划"全留主包"作废）**：hello-fjs 已把三方库
  适配层收进 `src/adapters/`，全留主包意味着 f2 / leafer 的 import 链经过
  主包 shared 模块 → vendor 被拽回主包，分包失效。改为与 npm 同一条可达性
  规则：编译全部 SFC 之后、emit 之前，对本地模块图做**逐包 BFS**
  （`computeLocalModuleOwners`，种子 = 页面按其包 + 全部非页面组件按主包），
  只被一个分包可达 → `<root>/fjs/shared/`，否则主包。归属在 emit 前定死，
  import 目标无需回写。
- import 静态资源归属：引用它的模块在哪个包，文件就复制到哪个包的
  `assets/`，URL 常量带 `/<root>` 前缀。resolve 时即知，无事后处理。
- public 目录归属：**配置声明**（`public: ["wm"]`），不是自动扫描——页面里是
  `` `/wm/${name}.png` `` 这类模板串，精确匹配完整 URL 不可行，自动扫描前缀
  误报难兜底。声明式 + 包外引用报错。

**URL 改写为什么在构建期改字面量，而不是运行时映射表**：wxml 里静态的
`<image src="/fb/background.png">` 不过任何 JS，运行时拦不到。把产物里的
字符串字面量（ts 的字符串/模板串头部，用与 rewriteImports 同款的词法 walker，
跳过注释）和 wxml 文本（`/dir/` → `/<root>/dir/` 全量替换，wxml 是生成物，
无非字符串上下文）改成真实文件路径后，canvas / fetch / `<image>` 三条消费
路径自然成立。守卫：改写只作用于归属包的产物文件；其余任何产物文件出现
`/dir/` 字符串前缀 → 报错并列出文件（宪法 V）。

**留在主包不搬的**（spec §2）：components/、runtime 组件、public data 的
base64 模块（registry key 改成新 URL，模块仍由主包懒 require）、workers。子包
页面跨包 require 主包这些文件，全部合法。

**否掉的备选**：

- 运行时 URL 重映射表：`<image>` 静态 src 拦不到，否（见上）。
- 自动扫描源码归 public 目录：模板串拼 URL 无法精确匹配，误报/漏报都断图，否。
- 组件闭包归属分析把分包专属组件搬进子包：要做传递闭包 + 多包共享判定，
  hello-fjs 里 components/ 总共 48KB，收益撑不起复杂度，v1 不做（spec §2）。

## 4. 风险

- **真机断图**：URL 改写覆盖 ts 字符串/模板串头部 + wxml；漏掉的形态是"URL 拼
  在更长字符串中段"（如 `'go /wm/x'`）。产物守卫抓不到这种（它确实含前缀，
  也确实被改写漏了——walker 按"字面量以下划线开头"判定）。缓解：改写规则覆盖
  hello-fjs 全部已知形态（模板串头部、完整字面量、wxml 属性）；守卫保证
  包外引用不静默；文档写明限制。
- **DevTools 行为差异**：模拟器对跨包文件路径宽松、真机严格。分包页面里的
  URL 全部指向本包内文件（守卫保证），主包页面只引用主包文件，不依赖宽松行为。
- **回归**：未配置 subpackages 的项目必须与现在逐字节同形（验收 6），
  appJson/Emitter 的所有新分支都以"配置为空"为前置。

## 5. 验证路径

```bash
cd packages/fjs && pnpm build            # 或 dev 跑 TS 直出
pnpm --filter @ufjs/cli test             # 单测含新增 mp-subpackage
pnpm run typecheck

# hello-fjs 实构建 + 结构/体积核对
pnpm --filter hello-fjs run build:mp
node -e "const j=require('./examples/hello-fjs/dist/mp/miniprogram/app.json'); console.log(Object.keys(j.subPackages||{}).length, j.pages.length)"
du -sh examples/hello-fjs/dist/mp/miniprogram/*  # 主包 vs 分包
grep -c leafer examples/hello-fjs/dist/mp/miniprogram/fjs/npm/vendor.js || echo "main vendor 无 leafer"

# demo 回归：无 subpackages 配置，app.json 不得出现 subPackages 键
pnpm --filter demo exec fjs build --mp && ! grep -q subPackages demo/dist/mp/miniprogram/app.json
```

真机预览（用户手动）：DevTools 打开 `examples/hello-fjs/dist/mp` → 预览，
确认 80051 消失、example/game 与 example/canvas 页面可进、游戏图正常显示。
