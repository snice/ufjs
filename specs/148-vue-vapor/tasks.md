# Tasks: Vue Vapor 渲染路径（阶段 0）

对应 plan：`./plan.md`

## 0. 基线

- [x] main 上 `examples/bench` 的 `[flat]` page-rules 挂载 / 卸载（3.5，VDOM；带包装计时 80 ms，扣掉后约 68 ms）

## 1. 契约层

- [x] 确认不涉及：op 协议 / natives / 事件类型不动

## 2. 实现

- [x] `examples/bench/package.json`：加 `vue36`
- [x] `packages/fjs-runtime/src/vue/renderer.ts`：导出 nodeOps（不改行为）
- [x] `examples/bench/vapor/dom-shell.ts`：DOM 外壳 + 模板串解析
- [x] `examples/bench/vapor/build.mjs`：3.6 编译 + 钉版本的 esbuild 构建
- [x] `examples/bench/vapor/main.ts`：VDOM / Vapor 两版同口径挂载 / 卸载

## 3. 测试

- [x] Vapor 版与 VDOM 版帧字节对照（差异只在 v-for 的 fragment 锚点：173274 / 175166 B）
- [x] `pnpm run typecheck`、`pnpm test` 通过（运行时只多一个导出）

## 4. 结论

- [x] spec §8 记录数值，对照门槛（挂载总计少 ≥ 15 ms）给出进 / 不进阶段 1
- [x] `docs/performance.md` 记一行

## 5. 补充场景（用户要求：Vapor 的更新优势与原生克隆上限）

- [x] `examples/bench/vapor/FlatLive.vue`：4050 格，文本读响应式数组；VDOM / Vapor 两版分别改 1 / 200 / 2000 格
- [x] 原生克隆上限：量出外壳克隆自身与逐元素 op 编码（create / insert）的成本，给出「有原生克隆时」Vapor 挂载的估算
- [x] spec §8 补结果

# 阶段 1

## 6. 升级

- [x] workspace 与 create 模板钉 Vue 3.6.0-rc.9；bench 去掉 `vue36`（fjs-runtime 另加 `@vue/runtime-vapor` 依赖、`@vue/runtime-dom` devDependency）
- [x] typecheck / test / flutter test 通过，`bench:mount` 与 `[bench]` 不回退超过 5%

## 7. 运行时

- [x] `src/vapor/dom.ts`：外壳（元素 / 文本 / 注释 / 模板解析 / 事件 / style / 属性 / ref 转发）
- [x] `src/vue/runtime-dom-shim.ts`：runtime-vapor 需要的 DOM 专属导出
- [x] `src/vue/vue-shim.ts` 导出 runtime-vapor
- [x] 互操作：Vapor 组件在 VDOM 里（插件 + 宿主→外壳）、VDOM 组件在 Vapor 里（nodeOps 解包）

## 8. CLI

- [x] `vue-plugin.ts`：`<script setup vapor>` 编译、node_modules `.vue` 自动 Vapor（`fjs.vapor.libs`）、runtime-dom 钉扎、runtime-vapor 注入
- [x] Vite 插件（dev）同步
- [x] web 构建能编 Vapor SFC

## 9. 测试

- [x] `vapor-dom.test.ts` / `vapor-mount.test.ts`：挂载、v-if / v-for 增删移、文本 / class / style 绑定、事件、互操作
- [x] bench 改用运行时外壳，数值与阶段 0 一致

## 10. 验收

- [x] hello-fjs flat-4050 Vapor 版：真机显示 + 局部更新（VDOM 3 次显示、Vapor 2 次，读数稳定即停）
- [x] 同页 `fjs dev --web` 一致
- [x] Vapor 页嵌 vant 组件能显示、点击（fjsrun 下 demo/bench/vapor-check.ts；真机未单独点）
- [x] 文档
