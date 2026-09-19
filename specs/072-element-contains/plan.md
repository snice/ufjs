# Plan: host element 补 DOM `contains()`

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter 路径改 `packages/fjs-runtime/src/vue/renderer.ts`；Web 路径不改——`packages/fjs-runtime/src/web/index.ts` 用 runtime-dom，元素是真 DOM，`Node.contains` 原生可用。两端对同一页面的行为一致（spec §4 登记 `label-disabled` 差异，根源是无深层 target，不是本改动）。 |
| II 边界即契约 | 否 | 三张表都不动：纯 JS 侧读已有的 `parentOf` 影子簿记，不发 op、不调 native、不加事件号。 |
| III 同步单线程零序列化 | 否 | 同步沿 Map 上溯，O(树深)，无桥调用。 |
| IV 外观照 WeUI | 否 | 不涉及外观。 |
| V 静默失效是 bug | 是 | 这次的 bug 正是「缺方法 → `not a function` → 点击静默无效」。修复即补齐；非元素参数返回 false（DOM 同义），不抛。 |
| VI 注释记录权衡 | 是 | 在实现处注释：为何放渲染器而非 element 层（element 层不持有树）、为何用共享函数 + `this` 而非每元素闭包、与 hoist 到 overlay 的交互。 |
| VII JS 能包就不要下 Dart | 是 | 完全在 JS 侧：所需信息（父子关系）JS 已有。不下 Dart。 |
| VIII 变更落到文档 | 是 | `docs/ui-api.md`：DOM 形事件对象段落补 `contains()`；「与浏览器的差别」补 `label-disabled` 差异。`docs/custom-renderer.md` §2「复用影子簿记」补一句：抽 `ui/tree.ts` 时 `contains` 随迁。 |

无破例。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动 |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | 新增模块级 `hostContains(this, other)`；`nodeOps.createElement` / `createText` / `createComment` 创建时挂到元素上；`ensureOverlayHost` 的 host 同样挂上（它也在影子树里） |
| JS runtime 测试 | `packages/fjs-runtime/test/vue_contains.test.ts`（新） | 照 `vue_overlay_pseudo.test.ts` 的 harness：三层树的真假值、null/非元素、卸载后、DOM 事件处理器里 `e.target.contains` 不抛 + vant Checker 式 toggle 生效 |
| Web 适配层 | `packages/fjs-runtime/src/web/…` | 不动（原生 DOM） |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | — | 不动 |
| 文档 | `docs/ui-api.md`、`docs/custom-renderer.md` | 见宪法 VIII |

## 3. 方案

```ts
/** DOM Node.contains over the renderer's shadow tree … */
function hostContains(this: HostNode, other: unknown): boolean {
  let id = (other as { id?: unknown } | null)?.id;
  if (typeof id !== 'number' || !elementsById.has(id)) return false;
  while (id != null) {
    if (id === this.id) return true;
    id = parentOf.get(id);
  }
  return false;
}
```

- 在 `createElement` / `createText` / `createComment` 里 `el.contains = hostContains`。
  所有元素共享同一个函数对象，靠 `this` 取自身——不给每个元素分配闭包
  （一页几千个节点，几乎没有一个会被调到）。
- `elementsById.has(id)` 先挡掉非本渲染器的对象与已卸载节点（`forgetSubtree`
  会删 `elementsById`），与 DOM「不在同一棵树 → false」一致。
- 类型：`HostNode` 是 `Element`；在 renderer 内以
  `HostNode & { contains?: … }` 局部扩展，不改 `ui/element.ts` 的 `Element`
  接口（该接口是框架无关层的契约，它现在拿不出树）。

**否掉的备选**

- **B：下沉到 element 层（`ui/element.ts` 的 `makeElement`）**。element 层
  `appendChild` 直接写 op、不记父子，要先按 docs/custom-renderer.md 把
  `parentOf/childrenOf` 抽到 `ui/tree.ts` 并让 StyleEngine 改取来源——改动面
  远超修 bug。用户已拍板 A；抽取随 React 适配一起做。
- **每元素闭包 `el.contains = (o) => …`**：功能相同，但每个节点多一个闭包，
  白白占内存。
- **在 `asDomEvent` 里给 target 加 `contains`**：只修事件对象路径，
  `iconRef.value.contains(...)` 这种从 ref 拿到的元素照样没有，不成立。
- **把 `target` 做成深层命中节点**：能让 `label-disabled` 也对齐，但需要
  Dart 侧回报命中路径，属于事件协议变更，spec 已划出范围。

## 4. 风险

- **hoist 到 overlay 的 fixed 元素**：影子树里它的父亲是 overlay host，
  逻辑父元素 `contains` 它会返回 false。Web 上 vant 的弹层走 Teleport 到
  body，DOM 里同样不在逻辑父下，结果一致；非 Teleport 的 fixed 元素两端有差异，
  目前无已知调用方，注释登记。
- **伪元素镜像子节点**：`::before/::after` 在影子树里是真实子节点，
  `contains` 会把它算作后代；DOM 里伪元素不是节点。页面代码拿不到这些镜像
  节点的引用，不可观察。
- 需两端对拍：vant-form 的 Checkbox / Radio（iOS 模拟器 vs Web）。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test
pnpm --filter fjs-runtime exec vitest run test/vue_contains.test.ts
cd demo && tail -f /dev/null | fjs run ios     # 后台跑；vant-form 点「乙」「选项二」
pnpm --dir demo exec vite --port 5175         # Web 对拍 http://localhost:5175
```
