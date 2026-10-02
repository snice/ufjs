# Spec: hello-js 增加纯 element API 版 flat-4050 压测屏

- **ID**: 186-hello-js-flat-4050
- **状态**: ready
- **日期**: 2026-10-02

## 1. 要解决什么

hello-fjs 的 `example/interaction/flat-4050` 页量的是「Vue（VDOM / Vapor）+ 样式引擎 +
桥 + Flutter」整条链路；它的三段拆账（JS / 上屏 / 最慢帧）里「其余」那一格混着
Vue 的 vnode 重建与 diff。要优化 fjs 底层 element API 本身，需要一个**没有 Vue**
的对照组：同一棵 4050 元素的树（50 行 × 40 格，每格 view + text）、同一套按钮和
量法，直接用 `create / insert / setText / setProps` + StyleEngine 搭出来。
hello-js 就是干这个的（theme-bench 先例），现在缺 flat-4050 这一屏。

## 2. 不做什么（Non-goals）

- 不改 `fjs-runtime` / `flutter_fjs` / `@ufjs/cli` 的任何代码——纯 example 改动。
- 不做 VDOM / Vapor 模式切换（那是 hello-fjs 页的职责，两边对着读）。
- 不引入新依赖。
- 不做 Android / OHOS 冒烟（后续有需要再说）；web 侧能力由 element API 自身
  两端同源保证（宪法 I），不单独验收。
- 不动 theme-bench / gallery 两屏的现有逻辑。

## 3. 用户可见的行为

hello-js 多一个 tab「4050 压测」（放第一位，冷启动只挂 110 个元素的静态部分，
比默认进 theme-bench 快）。页面与 hello-fjs 的 flat-4050 同构：

- 顶部常驻 5×10 格（每格 view + text）。
- 「同屏显示4050个元素 / 隐藏」按钮：挂载 / 卸载 50×40 网格。
- 「改 1 格 / 改 200 格 / 改 2000 格」：对格子文本做 setText 局部更新
  （未显示时置灰）。
- 三格读数 JS / 上屏 / 最慢帧，含义与 hello-fjs 页相同：
  - JS：tap 到 drain（两次微任务 + `flush()`）——含样式引擎重算、op 编码、
    同步过桥 applyFrame；
  - 上屏：tap 到挂载后第二个 rAF；
  - 最慢帧：挂载后 30 帧里最长的一帧。
- 一行拆账：`过桥 x ms/yKB  样式 flush … mark …  其余 …ms`——这里的「其余」
  就是纯 element 层（create/insert/setText + 编码），与 hello-fjs 页的
  「其余」（Vue + element 层）对着读，差额即 Vue 的账。
- `console.log('[flat-4050] element …')` 每次测量打一行，与 hello-fjs 页
  同前缀可 grep。
- `globalThis.__flat4050 = { show, hide, bump }`（返回测量数字），供离线
  fjsrun 驱动跑分，同 theme-bench 的 `__themeBench` 先例。

```ts
// 页面代码全部走底层 API，没有 Vue：
const node = create('view');
engine.ensure(node.id, 'view');
engine.setClasses(node.id, 'cell');
insert(parent, node);
engine.recomputeSubtree(node.id);
```

## 4. 两端约定（宪法 I）

不新增能力，只消费既有 element API / StyleEngine（两端本就同源）。
新增的只有 hello-js 内的一个屏，无协议、无标签、无事件变更。

| | Flutter | Web |
|---|---|---|
| 行为 | element API / StyleEngine 既有行为 | 同左（`fjs dev --web` 可跑） |
| 已知差异 | 无新增 | 无新增 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter hello-js run build` 成功。
2. `fjs run ios`（iOS 模拟器，debug 冒烟）：三屏切换正常；4050 屏点
   「同屏显示4050个元素」网格出现、读数三格有值；「改 200 格」后对应格子
   文本变化；「隐藏」后网格消失。
3. 每次测量 console 输出 `[flat-4050] element …` 一行，含 js / firstFrame /
   worst 与拆账。
4. `git status` 确认改动只落在 `examples/hello-js/` 与本 spec 目录。

## 7. 待澄清

- 无（量法与树形完全照抄 hello-fjs 的 flat-4050 页，模式切换按 Non-goals 砍掉）。
