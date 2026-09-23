# Plan: 事件首参契约——fjs 标签交付裸载荷

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | ✓ | 坏的就是这条：web（组件 emit 裸载荷）与 Flutter（asDomEvent 包装）首参形状分叉。修 Flutter 侧 `vue/renderer.ts` 让首参按**编译期同一份标签判定**（`tags.json` ∪ `component-tags.json`，与 `webIsNativeTag` 同源）分类；web 端零改动。demo vant 的消费差异（Field/Stepper 读 `event.target.*`）由 demo 项目自带的 `demo/vite/vant.ts` 锚点补丁在 app 构建兜底——补丁本来就是「项目自带适配器」的既定形状 |
| II 边界即契约 | ✗ | 三张表全不涉及：`EventType`/`fjs.h` 编号不变，`vm.cpp` 传的本来就是字符串，ops/natives 不动。坏的是 JS 层转交方式 |
| III 同步单线程零序列化 | ✗ | 不加桥、不加异步；首参在 `patchProp` 注册的闭包里就地决定 |
| IV 外观照 WeUI | ✗ | 不碰默认样式 |
| V 静默失效是 bug | ✓ | 未知 handler prop 的既有 warn 不动；`demo/vite/vant.ts` 补丁锚点丢失时构建期 warnOnce（既有机制）；设备验收要求 flutter run 控制台**零** `[vue-error]` / `[fjs/dispatch-event] SyntaxError` |
| VI 注释记录权衡 | ✓ | renderer 的分类处写清「为什么按 raw 标签而不是事件名分（web 的组件/原生分界就是标签）」；vant 补丁条目写清「为什么容忍字符串（fjs input 是组件，两端 emit 的都是值）」 |
| VII JS 能包就不要下 Dart | ✓ | 全部改动在 JS 渲染层 + demo 构建插件；Dart/native 零改动 |
| VIII 变更落到文档 | ✓ | `docs/ui-api.md` 事件小节补「首参形状」两行；`docs/roadmap.md` 记一条回归修复 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Web 适配层 | `packages/fjs-runtime/src/web/…` | **零改动**（参照物） |
| Vue 渲染层（Flutter 路径） | `packages/fjs-runtime/src/vue/renderer.ts` | `createElement` 记录 raw 标签是否 fjs 标签；`patchProp` 的 `on*` 分支按该标记决定首参是裸载荷还是 `asDomEvent` 包装 |
| 标签事实 | `packages/fjs-runtime/src/tags.ts`（`tags.json` + `component-tags.json`） | 只读引用，不改内容 |
| demo 适配器 | `demo/vite/vant.ts` | 新增 Field / Stepper 的「input 载荷容忍」锚点补丁（app 构建） |
| 测试 | `packages/fjs-runtime/test/`（新增 renderer 首参分类用例；沿用 `flutter-form.test.ts` 的 flutter-renderer 挂载范式） | 见 §5 |
| 文档 | `docs/ui-api.md`、`docs/roadmap.md` | 首参形状两行 + 一条记录 |
| CLI / native / Dart | — | 零改动 |

## 3. 方案

### 3.1 分类规则（选定）

**按 raw 标签分，不按事件名分**——因为 web 的「组件 emit 裸载荷 vs 原生
DOM 事件」这条分界线就是 `webIsNativeTag` 的标签判定：

- `createElement(rawTag)` 时判定：`rawTag ∈ (FJS_TAGS ∪ FJS_COMPONENT_TAGS)`
  → 该元素的事件首参 = 裸载荷（字符串/数字/无参/本就是对象的 touch 载荷
  原样直传）；否则（`div`/`span` 等非 fjs 标签）→ 维持 `asDomEvent` 包装。
- 判定结果记在 renderer 模块内的 `WeakSet<HostNode>` 里（元素是每次渲染
  新建的对象，不需要持久 id）；`once`、`aliasEvent`、CANONICAL 拼写等既有
  包装逻辑全部保留，只换「交给 handler 的第一个参数」。
- raw 路径保留 `asDomEvent` 里对文本值的记录副作用
  （`textValues.set(el.id, payload)`——`element.value` 的 live 读取依赖它），
  否则去掉包装会顺手打断输入框 value 的回读。

- **否掉：按事件名分类（载荷类事件直传，input/click 类包装）**——
  `@input` 在 hello-fjs 页面要字符串、在 vanilla vant 要 event，二者绑在
  **同一个标签**（fjs `input`）上，按事件分只能二选一；按标签分则与 web
  的实际交付完全同构（web 上 fjs input 就是组件 emit 字符串）。
- **否掉：首参=载荷、第二参=事件**——vanilla vant 的 handler 只读第一参，
  等于把 specs/070 修好的 Field 再打坏；而且 web 没有第二参，两端又不一致。
- **否掉：String 对象混血（new String(payload) + 挂事件属性）**——
  `typeof`/`===` 与 web 的原始字符串分叉（`components/list-view.ts:116`
  的 `typeof payload === 'string'` 仍然 false），是第三种形状而不是契约。
- **否掉：改页面 handler 走 `e.detail`**——与 `docs/ui-api.md` 的全部载荷
  条目、web 既有交付、仓库里6 个页面的写法相反（拿页面迁就实现）。

### 3.2 demo vant 的适配补丁

fjs `input`/`textarea` 是组件，两端 emit 的都是**值**；vanilla vant 的

- `Field.mjs` `onInput`：`event.target.composing` / `event.target.value`
- `Stepper.mjs` `onInput` / `onBlur`：`event.target` + 回写 `input.value`

在首参为字符串时会抛错。`demo/vite/vant.ts` 已有「字面量锚点替换 + 锚点
丢失构建 warn」机制，照该形状加3 条载荷容忍补丁（app 构建）。
**demo 的 web 构建维持「vanilla 不动」的既定立场**：它今天收到的就已经是
组件裸字符串，潜在问题属既有已知差异，登记不修（spec §2）。
Uploader / IndexBar 也读 `event.target`，但 demo 页面未使用——不打补丁，
写进 §4 风险，将来用到时按同形状补。

## 4. 风险

- **漏分类的消费方**：任何在 fjs 标签上读 `event.target.*`/`clientX` 的
  代码都会在修复后拿到裸载荷。已清点 vanilla vant：Field、Stepper（demo
  在用，打补丁）、Uploader/IndexBar（demo 未用）、Dialog（绑在非 fjs
  的 root 上，仍走包装，不受影响）；仓库内页面全部是 `JSON.parse(payload)`
  /忽略参数的写法 ✓；runtime 内部 `list-view.ts:116` 反而是被修复方。
- **`textValues` 副作用迁移**：raw 路径若漏抄 live value 记录，
  Flutter 端输入框 `element.value` 回读会静默失效（Field 清空/回显类
  操作）——实现时保留同一行，验收里在设备上输一遍 Field 确认。
- **远程图偶发解码失败**（spec §2 观测项）：修复后面板不再消失，
  以 error 文案呈现；`ImageDecoder$DecodeException` 计数写进观测记录。
- **hot 路径开销**：每事件多一次 `WeakSet.has`，可忽略。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test                    # 新增 renderer 首参用例 + 既有套件
cd packages/flutter_fjs && flutter test && cd -

# Android 模拟器（fjs run android 的 flutter run 控制台挂在 /tmp/fjs-run-android.log）
pnpm --filter hello-fjs run run:android
# 验收：图片页 mode / load-error 两个面板回来；missing 图 desc =
# error {"errMsg":...}；本地图 desc = load 240 x 160；
# radio / picker / scroll-view 页各操作一次，JSON.parse 正常回显；
# 控制台无 [vue-error]、无 [fjs/dispatch-event] SyntaxError；
# 记录 ImageDecoder$DecodeException 次数（spec §6.6 观测项）

pnpm --filter demo run typecheck    # demo 构建期锚点补丁无 warn
# demo 的 vant Field / Stepper 在设备上输入（app 构建）
```
