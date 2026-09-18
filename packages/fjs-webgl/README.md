# @ufjs/webgl

给 fjs 的 `<canvas>` 补上 WebGL：`getContext('webgl' / 'webgl2')`。App 端经
ANGLE 渲染进 Flutter，web 端直接用浏览器原生的 context，three.js / PixiJS /
LeaferJS 这类库不需要改动就能两端跑。

仓库里的 `examples/racing`（three.js 赛车）和 `examples/hello-fjs`（three.js
跳一跳、PixiJS 消消乐等）就是这么用它的。

## 使用者要做的事

```bash
npm i @ufjs/webgl
```

包里的 `"fjs": { "module": true }` 会触发 fjs 的 autolink：Flutter 宿主的
依赖和 `FjsWebgl.register(engine)` 注册调用自动生效，不需要手工配置。

```ts
const canvas = document.createElement('canvas')
const gl = canvas.getContext('webgl')
```

调用的是这套包导出的 `FjsWebGLRenderingContext`：接口形状照 WebGL 1.0/2.0
裁剪，命令编码成 op 协议帧发给宿主，宿主经 ANGLE 上屏。不支持的调用会
`console.warn` 指明是哪一条，而不是静默吞掉。

## 平台说明

- **App（Flutter）**：ANGLE 依赖在宿主侧，最低 Flutter 3.38（Dart 3.10），
  见 flutter_fjs 的 CHANGELOG。鸿蒙走 `flutter/ohos` 里的 EGL 后端。
- **Web**：直接返回浏览器原生 `WebGLRenderingContext`，本包只做类型对齐。
- **小程序**：经 `fjs build --mp` 的 canvas 桥接走 wx 的 WebGL 上下文。
