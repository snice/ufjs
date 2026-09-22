# Web 与小程序是怎么成立的

同一份 `.vue`，App 端靠自定义渲染器 + Flutter，另外两端靠什么？

## Web：同一个模板，标签换成组件

| 层 | App | Web |
|---|---|---|
| 渲染器 | fjs 自定义渲染器 → op 帧 → Widget | Vue 官方 runtime-dom |
| `<view>` `<swiper>` … | Dart 侧 Widget | `@ufjs/runtime/web` 里的 Vue 组件 |
| `<style scoped>` | fjs CSS 引擎 | 真 CSS |
| 路由 | 原生 Navigator | vue-router（默认 hash 模式） |
| `toast()` | 原生浮层 | DOM 浮层 |
| Worker | Dart isolate + 独立 JS 引擎 | 真 Web Worker |

**切换点在 SFC 编译**：App 构建给 `@vue/compiler-dom` 的 `isNativeTag` 声明「内置标签是元素」，模板里的 `<view>` 编译成 `createElementVNode('view')`，原样交给渲染器；Web 构建声明「内置标签是组件」，同一个 `<view>` 编译成对应 Vue 组件的引用，由 DOM 适配层渲染。

注意 `text`、`image`、`switch`、`button`、`input` 这些本来就是 HTML / SVG 标签名，不显式声明的话在 Web 上会被编译成真 DOM 元素，永远走不到适配层 —— 这也是 Volar 需要 `@ufjs/runtime/volar` 插件才能给出正确类型的原因。

### 保证两端一致的几个机制

- **事件载荷**：Web 组件照搬 Dart 侧的约定，所有载荷都是字符串，格式逐字符相同
- **数字样式补单位**：`:style="{ fontSize: 16 }"` 在 CSS 里是非法值。适配层把长度属性的数字补上 `px`；`<style>` 里无单位的长度在构建期补上
- **fjs 独有的样式键改写**：`flex-grow: 1` → `flex: 1 1 0%`，`direction: horizontal` → `overflow-x: auto`
- **基础样式表**：所有容器 `display: flex; flex-direction: column; box-sizing: border-box; flex-shrink: 0`，把浏览器的默认值拉到和 Flutter 一致
- **同一套路由语义**：Web 端用 `<KeepAlive>` 按历史栈缓存页面，pop 掉的页面销毁，和 Flutter 的「出栈即 dispose」对齐

Vite 插件（`@ufjs/cli/vite` 的 `fjs()`）和 CLI 内置的 `fjs build --web` 走的是同一套 alias 和改写逻辑。

## 小程序：编译期直译成 WXML

小程序是第三条路径，机制和前两者完全不同：**不打包 Vue 运行时，不走 element API，也没有 op 帧**。

| 路径 | 模板去向 | 运行时 |
|---|---|---|
| `fjs build` | render 函数 | element API + op 协议 |
| `fjs build --web` | render 函数 | vue-router + DOM 组件 |
| `fjs build --mp` | **WXML** | `@ufjs/runtime/wx` 薄壳 |

### 模板 → WXML

`packages/fjs/src/mp/wxml.ts` 遍历 Vue 模板的 AST，逐节点翻译：

- `v-if` / `v-for` → `wx:if` / `wx:for`
- <span v-pre>`{{ expr }}` 和绑定属性 → 小程序 `{{}}` 数据绑定；</span>WXML 表达式语言算不了的（函数调用、对象形式的 `:class` / `:style`、内联事件处理器）被抽取成生成的 setup 代码
- 事件统一走一个方法 `__fjsCall`：模板在 `data-*` 里带上目标处理器名和 `v-for` 作用域值，运行时把原始 wx 事件转换成和另两端一致的载荷
- 内置标签 → 同名组件、带 class 的 `view`，或 runtime 提供的自定义组件（`fjs-checkbox`、`fjs-modal`……），并补上和另两端一致的默认外观

### 响应式 → setData

`import { ref } from 'vue'` 被 alias 到 `@ufjs/runtime/wx`：里面只有 `@vue/reactivity`（`ref` / `computed` / `watch`，没有 vdom），外加一层胶水 —— 执行 `setup()`，监听它返回的响应式状态，变化时计算最小差量调用 `setData`。

### 页面、外壳与路由

- 路由页面 SFC 直接注册成小程序页面（`Component({ isPage: true })`），它的 WXML 是 <span v-pre>`<shell route="{{route}}">页面内容</shell>`</span>，和另两端 `createFjsApp` 包 Shell 的方式一致
- `fjs/pages` 编译成 `fjs/routes.ts`，`useRouter().push()` 映射到 `wx.navigateTo` 等
- 组件用 `virtualHost`，不产生额外宿主节点，flex 布局链和另两端一致

### 产物是 TypeScript 源码

每个 SFC 发射成一个可读的 `.ts` 模块，TS 编译交给微信开发者工具（`useCompilerPlugins: ["typescript"]`）。本地模块发射到 `fjs/shared/<源路径>`，依靠微信的模块缓存保证全局单实例。npm 依赖由 esbuild 打进一个 `fjs/npm/vendor.js`（没有用开发者工具的「构建 npm」：它只打包 `main` 入口，子路径导入和纯 ESM 包过不去）。

```text
dist/mp/
  project.config.json
  miniprogram/
    app.{ts,json,wxss}
    fjs/runtime.ts          wx 运行时 + @vue/reactivity
    fjs/routes.ts           路由表
    fjs/shared/…            本地模块
    fjs/npm/vendor.js       npm 依赖
    components/<name>/…     编译后的组件
    pages/<route>/…         页面
```

### 小程序端的边界

- 用不了的能力（WebGL、部分画布库）通过 `fjs.mp.exclude` 排除页面
- 主包 2MB 限制：用 `fjs.mp.subpackages` 分包，npm vendor 和本地模块会按「只被哪个分包引用」自动归属
- 模块的 Flutter Widget 在小程序端需要模块自己提供一份原生组件（`widgets.<tag>.mp`）

完整的标签映射表和已知差异见仓库文档 [miniprogram.md](https://github.com/snice/ufjs/blob/main/docs/miniprogram.md)。
