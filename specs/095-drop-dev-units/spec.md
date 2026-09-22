# Spec: 去掉 dev units，热更新只留页面与整包两档

- **ID**: 095-drop-dev-units
- **状态**: in-progress
- **日期**: 2026-09-22

## 1. 要解决什么

`fjs dev` 的 units（spec 037）只在一种改动上看得见效果：两个以上页面
引用、且入口碰不到的展示组件。demo 在 iPhone 17 模拟器上对过：

- 只改某一个页面：本来就是 `reload pages:`，不经过 units，人留在当前页。
- 改两页共用的展示组件：units 热替换，文案换上，Pinia 和路由留着。
- 改 `counter.ts`（`+1` 改成 `+10`）：日志走了 units，人留在当前页，但
  Pinia 按 id 交回旧 store，再点仍是 `+1`。
- 改 `Shell.vue`：入口直接引用，整包 `reload`，回到首页。

为这一种组件维护注册表、协商、`units/<id>.js` 和调试脚本名，不值得。

## 2. 不做什么（Non-goals）

- 不给 shell、共享 ts、共享组件做新的热替换。换不上新逻辑就整包 reload。
- 不改 release / 字节码产物形状。units 本来就不进那条链路。
- 不改页面级热更新（`reload pages:`）的语义：该页重挂，其它页和 VM 不动。
- 不重写已完成的历史 spec（037、074）。文档只改「现在是什么样」。

## 3. 用户可见的行为

`fjs dev --pages` 只剩两档：

| 改动 | 推送 | 设备 |
| --- | --- | --- |
| 某个页面及其私有模块（只被这一页 import 的 `.vue` / `.ts`） | `reload pages:<chunk>` | 重 eval 该页，重挂该页 |
| 其它一切：shell、入口、被多页或入口引用的 ts/组件、插件、路由、配置 | `reload` | VM 重建，回到首屏 |

dev server 不再提供 `/units.js`、`/units/<id>.js`、`/pages/<chunk>.deps.json`，
manifest 不再带 `units: true`。旧的 `reload units:…` 推送按整包 reload 处理。

共享 app 模块回到 `shared.js`。dev 的 source map 覆盖这份 prelude 里的
项目文件（shell、store、插件），`node_modules` 仍然不进 map。

## 4. 两端约定（宪法 I）

热更新是 dev 通道，不是页面能力。web（`fjs dev --web`）收到任何变更仍是
整页刷新，与改之前相同。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] dev WS 文本协议收成两档：`reload` 与 `reload pages:`。`reload units:`
      不再发送；收到则当作整包 reload。

## 6. 验收标准

1. `packages/fjs/test/dev-reload.test.ts`：纯页面指纹仍是 `reload pages:`；
   shared / bundle 变化是 `reload`；`reload units:` 不再由 `changeMessage` 产生。
   split 构建的页面 chunk 通过 `__FJS_SHARED` 读共享模块，不出现
   `__fjsRequireUnit`。`sourcemap: true` 时 page chunk 与 `shared.js` 都有
   `fjs-map:`，map 含项目 `.vue` / `.ts`，不含 `node_modules` 与 stub。
2. `pnpm --filter @ufjs/cli test` 与 `pnpm --filter @ufjs/cli run typecheck` 通过。
3. `pnpm --filter @ufjs/runtime test` 与 typecheck 通过（`dev-units` 模块删除）。
4. `packages/flutter_fjs` 的 dev client 测试：`reload units:…` 解析为整包
   reload；手动 `reloadDev` 只拉 shared + bundle，不再请求 `/units.js`。

## 7. 待澄清

无。shell 与共享 ts 做不到安全热更新，按用户决定整包 reload。
