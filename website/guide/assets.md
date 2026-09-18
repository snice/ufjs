# 静态资源

图片、字体、JSON、给 `<web-view>` 打开的本地网页……本地文件有三种放法。三种最终都是**根绝对路径**，所以同一份源码在浏览器和 App 上取到同一个文件。

## 三种放法

| 写法 | 打包器怎么处理 | 页面里怎么用 |
|---|---|---|
| `import png from '@/assets/logo.png'` | 加哈希重命名，产物 `/assets/logo-<hash>.png` | `<image :src="png" />` |
| 放进 `public/images/logo.png` | 原样拷贝 | `<image src="/images/logo.png" />` |
| 放进 `html/guide.html` | 原样拷贝 | `<web-view src="/html/guide.html" />` |

```vue
<script setup lang="ts">
import logo from '@/assets/logo.png';
</script>

<template>
  <image :src="logo" mode="aspectFit" />
  <image src="/images/banner.jpg" mode="widthFix" class="banner" />
  <image src="https://example.com/a.png" lazy-load />
</template>
```

- **`import` 适合代码里用到的资源**：文件名带哈希，改了内容缓存自动失效；没被引用的文件不会进包
- **`public/` 适合按路径访问的资源**：比如接口返回的相对路径、`fetch('/data/cities.json')`
- **`html/` 只给 `<web-view>` 用**，目录名留在 URL 里，不会和 `public/` 撞名

::: warning 不要写相对路径
`images/x.png`、`./x.png` 在浏览器里会按当前路由解析（`/comp/image` 页会去要 `/comp/images/x.png`）。一律写 `/` 开头。
:::

## App 端从哪取

| 场景 | 来源 |
|---|---|
| 连着 `fjs dev` | 向 dev server 请求，改了立即生效 |
| release 包 | 读 Flutter asset `assets/fjs/public/<路径>` |
| `https://...` | `cached_network_image`，带内存 + 磁盘缓存 |
| `data:image/...;base64,...` | 内存解码 |

`fjs build --release` 会把 `public/`、`html/` 和 import 进来的资源一起拷进 Flutter 宿主的 `assets/fjs/public/`，并在 `pubspec.yaml` 里逐级登记目录（Flutter 的 asset 声明不递归，手写很容易漏）。

::: tip 控制包体
`public/` 是**整个目录**进 App 包的，包括只有 Web 用得到的文件。大文件如果只有 Web 需要，别放 `public/`。
:::

## 编辑器补全与构建检查

工具链会把 `public/` 和 `html/` 扫描成 `src/fjs-assets.d.ts`：写 `<image src="/` 时编辑器列出项目里的图片，`<web-view src="/` 列出 `html/` 下的页面。

写死的本地路径指向不存在的文件时，`fjs build` 会告警并给出最接近的候选。

## 格式注意

- `.svg` 只有 Web 端能显示，App 端会告警并派 `@error`。图标推荐用模块 [`@ufjs/iconmind`](https://github.com/snice/ufjs/tree/main/packages/fjs-iconmind)，它在 App 上由 Flutter 绘制
- 图片 `mode` 与小程序一致：`scaleToFill`（默认）、`aspectFit`、`aspectFill`、`widthFix`、`heightFix` 以及九个裁剪对齐方式

## 应用图标

```bash
npx fjs icon icon.png      # 覆盖 Android mipmap + iOS AppIcon
```

给一张 1024×1024 的方形 PNG。iOS 图标不能有透明通道，命令会提醒。
