# Plan: 186-hello-js-flat-4050

## 改动层与文件

只动 example 层，两处：

1. **新增 `examples/hello-js/src/flat4050.ts`**
   - 结构镜像 `theme-bench.ts` 的引擎段：`parentOf / childrenOf / elements`
     三张表 + `StyleEngine` 回调走 `setStyle`；`el() / text() / destroy()`
     三个助手照抄（含插入时 `recomputeSubtree`、卸载时 `engine.forget`）。
     不抽公共模块：这份样板本身就是测量路径的一部分，每个压测屏自包含，
     读数时不用跨文件核对账目（theme-bench 顶部注释同款理由）。
   - 树与样式照抄 `examples/hello-fjs/src/pages/example/interaction/flat-4050.vue`
     与 `components/flat4050/GridVapor.vue`：`.row / .cell / .tiny` 数值逐条抄，
     去掉 scoped；无 `.modes`（VDOM/Vapor 切换不进本屏）。
   - 测量照抄该页 `measure()`：`setOpSink` 包过桥（字节 + ms）、
     `engine.resetStats()`、`act()` → drain（两次微任务 + `flush()`）→ JS 格，
     两个 rAF → 上屏格，30 帧取最慢 → 最慢帧格；拆账
     `过桥 / 样式 flush+mark / 其余`，console 行
     `[flat-4050] element <label> js=… firstFrame=… worst=… | …`。
   - `globalThis.__flat4050 = { show, hide, bump }`，返回读数，供离线跑分。
   - rAF 采样循环里查 `disposed`，切屏后立即停。
2. **`examples/hello-js/src/main.ts`**
   - `SCREENS` 首位插入 `{ name: '4050 压测', mount: mountFlat4050 }`，
     头部注释两屏改三屏。

## 顺序

1. 写 `flat4050.ts` → 2. 改 `main.ts` → 3. `pnpm --filter hello-js run build`
→ 4. 启 iOS 模拟器，`fjs run ios` 冒烟 + 点按验证读数 → 5. 勾 tasks。

## 风险

- `fjs run ios` 走 debug 模式，Flutter debug 下 4050 元素本身就慢——冒烟只验
  功能与读数非空，性能结论一律以 release/profile 为准（屏上 tip 写明）。
- 字节码：不改 native / tags.json，无需重编 fjsc 或 CLI dist。
