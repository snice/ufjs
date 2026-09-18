# 多端差异

ufjs 的第一原则是**两端同源**：任何面向用户的能力（标签、样式、事件），Flutter 和 Web 两端都要实现，行为一致，事件载荷逐字符相同。小程序端再多一份映射。

但各端底子毕竟不同。这一篇告诉你：同一份代码在各端分别变成了什么、差异在哪里、需要时怎么按平台分叉。

## 同一份代码，三条路径

| | App（Flutter） | Web | 微信小程序 |
|---|---|---|---|
| 构建 | `fjs build` / `fjs run` | `vite build` / `fjs build --web` | `fjs build --mp` |
| 模板去向 | render 函数 | render 函数 | **编译期直译成 WXML** |
| Vue 运行时 | `@vue/runtime-core` + fjs 渲染器 | 官方 `vue`（DOM） | **不打包**，只有 `@vue/reactivity` + setData 胶水 |
| 内置标签 | Dart 侧 Flutter Widget | fjs 的 DOM 组件 | 小程序同名组件 |
| `<style>` | fjs 自己的 CSS 引擎 | 真 CSS | WXSS |
| 路由 | Flutter `Navigator` 原生页面栈 | vue-router | 小程序页面栈 |
| 发布产物 | QuickJS 字节码 | 静态站点 | TS 源码，微信开发者工具编译 |

## 按平台分叉

### 整个页面只在某一端

```vue
<route>
{"platforms": ["app"]}
</route>
```

或用文件名后缀：`scan.app.vue`、`share.web.vue`。被排除的页面不会出现在那一端的路由表里，代码也不会进产物。

小程序端用 `package.json` 排除页面：

```json
{ "fjs": { "mp": { "exclude": ["example/webgl", "comp/canvas"] } } }
```

### 插件只在某一端

`src/plugins/` 里的插件文件可以加后缀：`analytics.app.ts`、`analytics.web.ts`。

### 代码里判断

```ts
import { hasNativeHost } from 'fjs';

if (hasNativeHost) {
  // App：有 Dart 宿主，可以 invokeHost
} else {
  // Web / 小程序
}
```

模块的写法通常是：有宿主就调原生，没有就用浏览器 API 兜底，这样页面不用关心自己跑在哪。

## 常见差异清单

| 场景 | 差异 | 建议 |
|---|---|---|
| `flex-direction: row` 的交叉轴默认值 | Flutter `center`，CSS `stretch` | 显式写 `align-items` |
| `:active` 里的继承属性 | Flutter 不向子节点传递 | 用 `background-color` / `opacity` |
| `stopPropagation` / `preventDefault` | Flutter 上空实现 | 用 `touch-action` |
| 页面缓存 | Web 默认 `<KeepAlive>` 缓存栈上的页 | 两端都是「出栈即销毁」，行为一致 |
| 下拉刷新 `refresh` | Web 只有触摸端简化版 | 桌面浏览器上拉不出来 |
| `<canvas>` | Web 是浏览器原生 2D，App 是同名实现 | 以 fjs 类型为准，别用浏览器独有的方法 |
| `.svg` 图片 | App 不支持 | 用图标模块或位图 |
| `invokeHost` | Web / 小程序没有 Dart 宿主 | `hasNativeHost` 判断 |
| dev 热更新 | Web 是 Vite HMR；App 是页面级 / 模块级热替换 | — |

完整差异见仓库文档：[Web 平台](https://github.com/snice/ufjs/blob/main/docs/web.md#已知差异)、[小程序](https://github.com/snice/ufjs/blob/main/docs/miniprogram.md)。

## 小程序端的特别说明

小程序端走的是一条完全不同的编译路径：模板在构建时被翻译成 WXML，不带 Vue 的虚拟 DOM。所以：

- `import { ref } from 'vue'` 会被替换成 `@ufjs/runtime/wx`（只有响应式，没有 vdom）
- 用到的 npm 包必须写在项目 `package.json` 的依赖里，会被打进一个 `vendor.js`
- **主包有 2MB 上限**。three、echarts 全量这类大库要用分包挪出主包：

```json
{
  "fjs": {
    "mp": {
      "subpackages": [
        { "root": "game", "pages": ["example/game/"] }
      ]
    }
  }
}
```

- 渲染器通过 `app.config.ts` 的 `wxmp.renderer` 选择 `webview`（默认）或 `skyline`

原理见[Web 与小程序是怎么成立的](/advanced/web-and-mp)。
