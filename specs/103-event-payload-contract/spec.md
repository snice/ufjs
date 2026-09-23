# Spec: 事件首参契约——fjs 标签交付裸载荷，非 fjs 标签交付事件对象

- **ID**: 103-event-payload-contract
- **状态**: done
- **日期**: 2026-09-23
- **来源**: 用户在 Android 模拟器上报告「widthFix/heightFix 加载空白」。
  `fjs run android` 的 flutter run 控制台把根因钉死：不是图片尺寸问题，是
  Flutter 端事件首参被包成了 DOM 事件对象，页面 handler 收到
  `{detail,target,…}` 后 `JSON.parse` 抛错、错误载荷回流渲染层，把 mode 面板
  和 load/error 面板整个炸成空白（specs/102 的对拍只覆盖 web↔小程序，
  没跑 Flutter 端，所以漏过了这条 09-19 引入的回归）。

## 1. 要解决什么

### 现象（Android 模拟器，`com.example.hello_fjs`，renderer 实测）

1. **图片页顶部的 mode 面板和 load/error 面板整个不渲染**——页面从「本地图
   import / public」开始，上面本该有的 14 个 mode 按钮和图片区块是空白。
   用户视角就是「widthFix/heightFix 那块加载空白」。
2. 缺失本地文件面板显示 `error [object Object]`；本地图已经画出来但 desc
   永远停在「等待加载」。
3. `flutter run` 控制台（`/tmp/fjs-run-android.log`）：

```
[js:error] [fjs/dispatch-event] SyntaxError: unexpected character
    at parse (native)
    at onLocalLoad (bundle.js:18578)      ← JSON.parse(payload)，payload 是对象
    at onLoad (bundle.js:14213)           ← patchProp 包的包装层
    at <anonymous> (bundle.js:10991)      ← __fjsDispatchEvent
[js:info] [vue-error] TypeError: not a function
    at replacer (bundle.js:1833)          ← toDisplayString → JSON.stringify
    at <anonymous> (bundle.js:18633)      ← {{ loadPayload || errorPayload || … }}
    at <anonymous> (bundle.js:18780)      ← 同一表达式（load/error 面板）
```

插槽渲染一抛错，Vue 中止该组件的 patch，面板就停在未挂载/半挂载状态——
**空白是渲染崩溃的结果，不是图片没加载**（同页的远程 compare 图、本地图
都渲染正常）。

### 根因

- native → JS 的载荷一直是字符串（`native/src/vm.cpp` `fjs_vm_dispatch_event`
  → `new_string_len`），`ui/element.ts` 的 `__fjsDispatchEvent` 也直传；
- 但 `fjs-runtime/src/vue/renderer.ts` 的 `patchProp` 给**所有** `on*` prop
  包了一层 `asDomEvent(el, payload)`，把首参换成 `{detail, target,
  currentTarget, clientX…}` 对象——这是 specs/070 为了让 vant Field 的
  `event.target.value` 能跑加的；
- **web 端没有这层**：`fjs/src/bundler/vue-plugin.ts` 的 `webIsNativeTag`
  把 FJS_TAGS 与 FJS_COMPONENT_TAGS 全部排除出原生标签，fjs 标签在 web 上
  编译成 Vue 组件，事件是组件 emit 的**裸载荷**（`web/components/basic.ts`
  `emit('error', encodeImageError())`、`form.ts` `emit('input', target.value)`、
  `scroll` emit JSON 串……），只有**非 fjs 的 HTML/SVG 标签**（vant 的
  `div`/`span`）才是真 DOM 事件。
- 于是同一页在 web 上好好的（`docs/ui-api.md` 承诺的也是「载荷是 JSON 串」），
  到 Flutter 就变成对象：`image.vue`、`radio.vue`、`picker.vue`、
  `picker-view.vue`、`textarea.vue`、`web-view.vue` 的 `JSON.parse(payload)`
  全部抛错；`components/list-view.ts:116` 内部的 `typeof payload === 'string'`
  判定也恒为 false。这条回归自 7ed4fac（2026-09-19，specs/068–072）起就在
  Flutter 端静默生效，属于宪法 I/I 的两端静默偏差。

## 2. 不做什么（Non-goals）

- **不改 native 边界**：`vm.cpp` / `element.ts` / `EventType` 三张表零变更，
  载荷本来就一直是字符串，坏的是 JS 渲染层这一环。
- **不改 web 端行为**：web 就是参照物（组件 emit 裸载荷 + 非 fjs 标签真
  DOM 事件），一行不动。
- **不把页面 handler 改成 `e.detail` 风格**：那是拿页面去迁就实现，
  与 `docs/ui-api.md` 全部载荷条目和两端既有页面写法相反。
- **不处理 demo 端 vant Field 的 web 侧隐患之外的新 vant 改造**：
  vanilla vant 的 `onInput` 读 `event.target.composing/value`，在 fjs 标签
  = 组件的前提下它两端拿到的都是裸字符串——app 构建由
  `demo/vite/vant.ts` 的锚点补丁兜底（本 spec 给它加 input/stepper 的载荷容忍类补丁），
  **demo 的 web 构建仍保持「vanilla 不动」的既有立场**，其输入框行为
  作为已知差异登记，不在本 spec 修。
- **不处理远程图片偶发解码失败**（`ImageDecoder$DecodeException
  'unimplemented'`，疑似 picsum 并发限流吐非图片字节）：那是示例数据源/
  网络问题，修复后页面只会显示 error 文案而不是整块消失；在验收里观测
  是否复现，复现则另开 spec。
- 不动 `widthFix`/`heightFix` 的尺寸逻辑（specs/102 已定，与本 bug 无关）。

## 3. 用户可见的行为

修完后 Android 上打开 `#/comp/basic/image`（hello-fjs），页面代码一行不改：

```vue
<!-- 1. mode 面板、load/error 面板重新出现（当前是整块空白） -->
<Panel title="mode" :desc="`当前：${mode}`"> … 14 个按钮 + 图片 … </Panel>

<!-- 2. 载荷按 docs 是字符串，JSON 解析成功 -->
<image :src="missing" @error="(p) => (localMissingPayload = `error ${p}`)" />
<!-- 改前：error [object Object]；改后：error {"errMsg":"image load failed"} -->
<image :src="local" @load="(p) => onLocalLoad(p)" />
<!-- 改前：SyntaxError 被 dispatch 吞掉、desc 停在「等待加载」；
     改后：desc 变 load 240 x 160 -->

<!-- 3. 同契约修复辐射到所有载荷 handler（当前在 Flutter 端全部抛错） -->
<radio-group @change="(v) => (picked = JSON.parse(v))" />
<picker @change="(v) => (spec = JSON.parse(v))" />
<scroll-view @scroll="(p) => read(JSON.parse(p))" />
<web-view @message="(p) => read(JSON.parse(p))" />
```

- 即便某张远程图加载失败，面板也完整存在、错误以文案呈现（现在是面板
  整体消失）。
- 只在 vant（demo 项目）里用的、绑在**非 fjs 标签**上的事件保持事件对象：
  `<div @click>` 的 `clientX`、touch 系载荷、Field 的 input 载荷容忍，
  行为与今天在设备上验收过的状态一致（specs/070、072）。

## 4. 两端约定（宪法 I）

**总则：事件首参的形状以 web 端为准。** 分类依据是 SFC 编译期的标签判定
（`fjs/src/bundler/vue-plugin.ts` 的 `webIsNativeTag`，事实源在
`fjs-runtime/src/tags.json` + `component-tags.json`）：

| raw 标签 | web 端首参（现状=参照） | Flutter 端首参（修复后） | 例 |
|---|---|---|---|
| FJS_TAGS ∪ FJS_COMPONENT_TAGS（`view`/`image`/`input`/`scroll-view`/`radio`/`picker`/`form`/`textarea`/…） | 组件 emit 的**裸载荷**（字符串/数字/无参） | **裸载荷**（去掉 asDomEvent 包装） | `@load` `{"width":600,"height":400}`、`@input` 文本、`@scroll` JSON、`@tap` 无参 |
| 非 fjs 的 HTML/SVG 标签（vant 的 `div`/`span`/…） | 原生 DOM 事件对象 | `asDomEvent` 模拟的事件对象（`detail`/`target`/`clientX…`，现状不变） | Slider 轨道 `@click` 的 `clientX` |
| touch 系（15–18，载荷本来就是对象） | 对象（`ui/touch.ts` 解码） | 对象，原样直传（现状不变） | `@touchstart` |

- 事件载荷仍是字符串跨边界（宪法 II v1 ABI，三张表零变更）。
- `once` / `aliasEvent` / canonical 拼写等包装层逻辑保留，只换「交给 handler
  的第一个参数」。
- 已知差异：demo 项目 vanilla vant 的 Field 在 **web 构建**里收到的是组件
  裸字符串、`event.target.composing` 路径失效——登记进本 spec 的 non-goal，
  app 构建由 `demo/vite/vant.ts` 补丁兜底。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` `EventType` + `fjs.h` `FJS_EVENT_*`）
- [x] 都不涉及

坏的是 JS 渲染层对同一事件的「转交方式」，不是事件的编号或载荷编码。

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过；新增 renderer 单测：同一事件在 raw 标签（`image`）上
   handler 收到**原始载荷字符串**（`JSON.parse` 可解析、`typeof ===
   'string'`），在非 fjs 标签（`div`）上仍收到含 `detail`/`target`/`clientX`
   的事件对象；`.once` 语义不变。
3. `cd packages/flutter_fjs && flutter test` 全绿（不是 `No tests ran`）。
4. Android 模拟器（`pnpm --filter hello-fjs run run:android`，flutter run
   控制台无 `[vue-error]`、无 `[fjs/dispatch-event] SyntaxError`）：
   - 图片页 mode 面板与 load/error 面板**重新出现**，14 个 mode 可点、
     widthFix/heightFix 盒子按 specs/102 尺寸渲染；
   - 缺失本地图片 desc 显示 `error {"errMsg":"image load failed"}`（不是
     `[object Object]`），本地图 desc 变 `load 240 x 160`；
   - `form/radio`、`form/picker`、`container/scroll-view` 三个页面在设备上
     各操作一次：选中值/滚动载荷经 `JSON.parse` 正常回显（当前会静默抛错）。
5. demo 项目 `pnpm --filter demo run typecheck` 通过；其 vant Field 在
   **Android 设备**上输入文字、v-model 更新（补丁锚点存在由
   `demo/vite/vant.ts` 构建期 warn 兜底）。
6. 远程图片解码失败是否复现：记录 flutter run 日志中
   `ImageDecoder$DecodeException` 的出现次数与对应节点；复现则写进
   spec 尾部「观测记录」，不在本 spec 内修。

### 观测记录（2026-09-23，Android 模拟器，图片页）

进入 `#/comp/basic/image` 时日志有一条
`ImageDecoder$DecodeException: unimplemented`（`FlutterImageDecoderImplDefault`）。
对应 picsum 的 progressive JPEG：系统 `ImageDecoder` 拒绝这种编码并打错误日志，
引擎随后用 Skia 解开，图片正常显示。按本 spec 不修。

## 7. 待澄清

无。分类总则（以 web 为参照、按编译期标签判定）直接由宪法 I 与
`webIsNativeTag` 的现状给出；vant 的 web 侧 Field 输入行为按既定立场
（web 构建不动）登记为已知差异，不阻塞本 spec。
