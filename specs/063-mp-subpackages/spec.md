# Spec: mp 编译支持分包（subPackages）

- **ID**: 063-mp-subpackages
- **状态**: in-progress（实现与构建验证完成，剩 DevTools 真机预览确认）
- **日期**: 2026-09-16

## 1. 要解决什么

hello-fjs 跑 `fjs build --mp` 后在微信开发者工具点预览/上传直接失败：
`错误码 80051, source size 2101KB exceed max limit 2MB`。mp 产物（约 3.1MB）
全部在一个主包里——`packages/fjs/src/mp` 的 emit 没有分包概念，app.json 从不写
`subPackages`。体积大头是只有 example 页面才用的东西：npm vendor 单包 1.15MB
（animejs / @vueuse/motion / @antv/f2 / @ufjs/spine / @leafer-ui/miniapp）、
游戏 public 图片约 440KB（wm 276K + fb 100K + spineboy 64K）、example 页面
TS 源码约 630KB。`docs/miniprogram.md` 早已把"主包 2MB 上限"列为已知约束，
每加一个重示例都会更糟；echarts / three / pixi 示例正是因此被 `mp.exclude`
排除，分包之前没有资格加回来。

## 2. 不做什么（Non-goals）

- **独立分包**（independent）：我们的页面依赖主包 runtime，用不上，也不做配置面。
- **主包引用分包资源**：微信禁止；构建期对这种配置报错（见验收 5），不是支持。
- **分包级组件归属**：`components/`、runtime 组件四包全部留在主包。它们很小
  （hello-fjs 合计 <150KB），而子包 require 主包 JS 合法；做"只被一个包用的
  组件搬进子包"需要完整的组件闭包归属分析，收益不成比例。
  （修订：`fjs/shared/` 本地模块**后来做进了归属分析**，见 §3——hello-fjs 把
  三方库适配层收进 `src/adapters/` 后，"全留主包"会让 f2/leafer 的 vendor 被
  拽回主包，分包等于白分。）
- **public data（base64 模块）搬分包**：`fjs/public-data.js` 注册表在主包 app.ts
  全局注册，注册表 require 分包文件不合法。数据文件的 base64 模块留在主包
  `fjs/public/`，只把注册表 key 改写成新 URL（spine 的 87KB 因此留在主包）。
- **wxss / 页面样式里的 url() 改写**：fjs 样式引擎不支持背景图，产物里不会出现。

## 3. 用户可见的行为

页面源码**一行不改**（两端同源不变）。只在 app 的 package.json 里声明分包：

```jsonc
// hello-fjs/package.json
"fjs": {
  "mp": {
    "exclude": [ ...原样... ],
    "subpackages": [
      { "root": "game",  "pages": ["example/game/"], "public": ["wm", "fb"] },
      { "root": "canvas", "pages": ["example/canvas/", "example/animation/"], "public": ["spine"] }
    ]
  }
}
```

- `pages` 片段的匹配语义与 `mp.exclude` 一致（路由 path 全等 / includes / 页面名
  全等）。一个页面命中两个分包 → 构建报错；tab 页（`meta.tab`）命中分包 → 报错。
- `root` 是 miniprogram/ 下的目录名，`pages`/`components`/`images`/`assets`/
  `workers`/`fjs` 是保留名；root 之间互为前缀 → 报错。
- `public` 里的目录跟着分包走：`public/wm/**` 物理复制到
  `miniprogram/<root>/wm/**`，产物里该分包模块中以 `/wm/` 开头的字符串字面量
  （含模板串头部与模板 `${}` 表达式内的字面量，如 `` `/wm/${name}.png` ``）与
  wxml 属性统一改写为 `/<root>/wm/...`。被主包或其它分包的产物引用到 → 构建
  报错（禁止静默断图）。
- npm 依赖与本地模块按**可达性归属**拆分：只被一个分包可达的 npm 库 / 本地
  模块进 `<root>/fjs/npm|shared/`；被主包或多个包引用的留主包（子包 require
  主包合法，全仓库单实例）。每个包的 `fjs/npm/<spec>.js` shim 原样保留，
  只是指向所在包（或主包）的 vendor。
- import 进来的静态资源（`import img from '@/x.png'`）跟着引用它的页面进包。
- app.json：主包 `pages` 不含分包页面，新增 `subPackages: [{root, pages}]`；
  没配 `subpackages` 时产物与今天逐字节同形（不输出该键）。
- `routes.ts` 路由表保持全量；`router.push` 跳分包页面由微信自动下载分包，
  业务无感。每条路由带 `mpPage`（页面在小程序包内的真实路径），wx 运行时的
  `mpUrl` / `isTabPagePath` 按它导航与判定——修第二轮真机发现的
  `navigateTo:fail page ... is not found`。
- **分包预下载**：`fjs.mp.preloadRule` 按 fjs 路由路径声明（`"/example":
  { "network": "all", "packages": ["game"] }`），编译期翻译成 app.json
  `preloadRule` 的真实页面路径 key；`packages` 引用 `subpackages` 的 root
  （`__APP__` = 主包），未知路由 / 未知 root / 非法 network 构建报错。
- 产物根目录不再写 `package.json`（依赖已全部 vendor，文件在 miniprogramRoot
  之外不上传，只会诱发 DevTools 无关的 npm 构建提示）。

```vue
<!-- 页面里照旧写，mp 产物里的 URL 会被构建期改写 -->
<script setup>
const img = loadCanvasImage(`/wm/${name}.png`); // 产物: /game/wm/${name}.png
</script>
<template>
  <image src="/fb/background.png" />  <!-- wxml 产物: /game/fb/background.png -->
</template>
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 不涉及（无分包概念） | 不涉及 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | mp 独有的产物布局特性；页面源码零改动即两端同源成立 | 同左 |

这是纯构建目标（产物打包方式）的差异，不引入任何标签/样式/事件差异。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及——只动 `@ufjs/cli` 的 mp emit 层

## 6. 验收标准

1. hello-fjs 按第 3 节配置后 `pnpm --filter hello-fjs run build:mp` 成功；
   `dist/mp/miniprogram/app.json` 含 `subPackages`，主包 `pages` 不再含
   example/game、example/canvas、example/animation 页面，tabBar 四页仍在主包。
2. 产物结构：`game/pages/<name>/*`、`canvas/pages/<name>/*` 存在且 app.json
   分包条目一一对应；`game/wm/f1.png`、`game/fb/background.png`、
   `canvas/spine/spineboy.png` 就位；主包不再有 `wm/`、`fb/` 目录。
3. vendor 拆分：主包 `fjs/npm/vendor.js` 不含 leafer/anime/f2/spine 标识串；
   `game/fjs/npm/vendor.js`、`canvas/fjs/npm/vendor.js` 存在且各含自己的库。
4. 主包体积（du 排除两个分包目录）从 ~3.1MB 降到 ~0.8MB 以内（源码口径）。
5. 错误路径均构建期报错且信息可定位：tab 页配入分包；页面命中两个分包；
   `public` 目录被主包产物引用；root 非法 / 保留名 / 互相前缀；主包零页面。
6. demo（未配置 subpackages）`fjs build --mp` 产物与改动前同形：app.json 无
   `subPackages` 键，vendor 单包。
7. `pnpm --filter @ufjs/cli test` 通过（含新增分包单测）；`pnpm run typecheck`
   通过。

## 7. 待澄清

- 无。设计取舍（组件/本地模块/ public data 留主包、共享库进主包 vendor）
  已在第 2 节和 plan 里定死。
