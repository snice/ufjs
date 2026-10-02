# Spec: enableVapor web 壳的页面缓存与 VDOM 壳一致（只留历史栈上的页面）

- **ID**: 183-vapor-web-page-stack
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

enableVapor 的 web 壳（`app/web-vapor.ts`，specs/166/173）按「访问过的页面」做 LRU 缓存（默认 16 页）：pop 掉的页面
不销毁，只是隐藏；再 push 同一路径看到的是上次离开时的状态（计数器、滚动位置、表单内容）。VDOM 壳（`app/web.ts`）
与 Flutter Navigator 的语义是：**只有历史栈上的页面活着**，pop / replace 掉的页面销毁，再进来是新页面。用户要求两者一致。

## 2. 不做什么

- 不改 Flutter 端（Navigator 本来就是栈语义）。
- 不改转场、`data-nav`、`onPageSettled` 的行为（specs/178）。

## 3. 用户可见的行为（照搬 VDOM 壳）

| 导航 | 行为 |
|---|---|
| push | 新页入栈；旧页留在栈上（隐藏、`onDeactivated`），返回时恢复状态与滚动位置（`onActivated`） |
| pop（返回 / 浏览器后退 / `router.back()`） | 被弹出的页面在离场动画结束后销毁（`onUnmounted`），其滚动记录清掉；之后再 push 同一路径是全新页面 |
| replace | 被替换的页面销毁；tab → tab 的 replace 例外：离开的 tab 页停放保留，离开 tab 组时一起销毁 |
| `keepAlive` 选项 | 与 VDOM 壳同型：`true`（默认，栈上全留）/ 数字（再加 LRU 上限）/ `false`（只留当前页） |

## 4. 两端约定

web 两种壳一致；Flutter 端本来就是这个语义。

## 5. 契约变更

- [x] 都不涉及

## 6. 验收标准

1. `test/vapor-page-stack.test.ts`：push→pop 后被弹页面已卸载、再 push 为新实例；push→push 后返回保留状态；replace 销毁被替换页；tab 切换停放与离组销毁；`keepAlive: false`。
2. demo / vapor-app web：返回后再进入页面状态重置（与 VDOM 模式一致）。
3. `pnpm test`、`pnpm run typecheck` 通过。

## 7. 待澄清

- 无（用户要求与 VDOM 一致）

## 8. 实现记录

- `app/web-vapor.ts`：壳维护与 VDOM 壳相同的 `stack` / `tabs`（按 `current.kind` 的 initial / push / replace / pop 更新；
  pop 到栈里没有的地址时压到栈顶）；切页后把不在栈上的页面销毁，正在播离场动画的页面等动画结束再销毁（期间被导航回来则保留）。
  `keepAlive` 改为 `boolean | number`，默认 `true`（栈上全留），数字为额外的 LRU 上限。
- 测试：`test/vapor-page-stack.test.ts`（pop 销毁与重建、栈下页面保留、replace、tab 停放、`keepAlive: false`、带转场时离场结束才销毁）；
  `vapor-page-transition.test.ts` 的 pop 用例改为断言被弹页面已销毁。
- demo web 实测：进 vant/vapor 页点两次计数、返回后页面数 2 → 1，再进入计数为 0。

