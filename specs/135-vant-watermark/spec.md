# Spec: demo 支持 vant Watermark

- **ID**: 135-vant-watermark
- **状态**: done
- **日期**: 2026-09-25

## 1. 要解决什么

demo 要支持 vant 的 `<van-watermark>`（https://vant.pro/vant/#/zh-CN/watermark）：
文字/图片/自定义内容水印，全页或局部平铺，两端一致。

vant 4.10 的实现机制（`vant/es/watermark/Watermark.mjs`）：隐藏 wrapper 里渲染一个
SVG（`foreignObject` 包旋转内容，或 `<image href=base64>`），读 `svgElRef.innerHTML`
序列化 → `new Blob` + `URL.createObjectURL` → 根节点
`background-image: url(blob)` + `background-repeat: repeat` 平铺。这条管线在
App 端三处都不存在：

1. 读渲染结果的 `innerHTML`——fjs 元素没有 innerHTML（影子树不回吐标记）；
2. `Blob` / `URL.createObjectURL`——QuickJS 环境没有；
3. CSS 位图 `background-image`——App 端只支持渐变背景（css-compat「视觉效果」行）。
   即使前两步垫出来，最后一步也画不出来。

按 [third-party-components.md](../../docs/third-party-components.md) 分级：**机制层
是 D**（依赖真 DOM 无法模拟，不硬模拟），但**视觉效果**用 runtime 已有面可以完整
复刻——`transform: rotate`（旋转中心两端同为盒中心，css-compat ✅）、
`position: fixed`（overlay 宿主）、`pointer-events: none`（specs/069）、`z-index`
（overlay 宿主排序）、`overflow: hidden`、`opacity`，加上 JS 侧算格数。全部是
CSS/JS 已有能力，**宪法 VII：JS 能包不下 Dart**，runtime 零改动。

### 落法

demo 本地实现 `VanWatermark.vue`（props / `#content` 插槽与 vant 对齐），在
`plugins/vant.ts` 以 `van-watermark` 名注册（vant 自带的 Watermark 不注册），
**两端同一份实现**——没有 vite 补丁、没有 dom-env 增量、页面无平台分支。
复用 vant 的水印 CSS（同名 `van-watermark` 类：absolute/fixed 铺满、
`pointer-events: none`、`--van-watermark-z-index`）。

### 渲染结构（两端一致）

```
.van-watermark (--full)        vant CSS：absolute/fixed 铺满、pointer-events:none；
                               行内补 zIndex prop 与 overflow:hidden（右/下边缘半格出裁）
  __cell × cols×rows           absolute 平铺，格 (width+gapX)×(height+gapY)，overflow:hidden
    __inner                    width×height，transform: rotate(rotate deg)，opacity
      content 文本 / #content 插槽 / <image src=image>
```

几何对齐 vant：内容贴格左上（vant 的 foreignObject `x=0,y=0`），绕内容盒中心旋转
（vant 的 `transform-origin: center`；两端默认 origin 同为盒中心，无需显式声明），
格盒出裁（vant 的 SVG 视口裁剪）。格数按根节点 `getBoundingClientRect()` 实测
ceil（App 端 `window.innerWidth` 恒为 0、dom-env 有意如此，不能用）——挂载后
rAF 有界重试至多 10 帧（Tabs 下划线补丁同一纪律：真隐藏的元素不会无限重试），
`width/gapX/height/gapY/fullPage` 变化或 resize 时重测；格数封顶 64×64 防病态
容器。

### 与 vant web 的已知差异（登记进 vant-adaptation.md）

- 机制：CSS 平铺 → DOM 格子平铺。视觉等效（同 props 同布局），不是同一份光栅；
  超大格子数由 64×64 封顶兜底。
- 水印文字默认字号显式 pin 14px（vant 的 span 继承文档默认字号，fjs 两端的
  text 默认字号不一致，pin 死才能对拍）。
- 图片模式直接 `<image :src>`，不做 vant 的 canvas→base64 转码（那是为绕
  canvas 跨域污染，这里不存在）。

## 2. 验收标准

- [x] `pnpm --filter demo run typecheck` 通过（vue-tsc strictTemplates 按 vant
      GlobalComponents 的 Watermark 类型检查页面用法，props 兼容即过）。
- [x] `pnpm --filter demo run build:release` 成功；`fjsrun` 冒烟无异常
      （`demo/bench/wm-smoke.ts`，mount/unmount 干净、op 帧产出、有界重试不悬挂）。
- [x] web 端 /vant-watermark 页：文字 / 图片 / 插槽 / 间距 / 旋转 / 透明度各示例
      平铺正确；全页开关生效；**水印开着时页面按钮可点**（点穿验证，计数递增，
      elementFromPoint 命中按钮本身）；全页水印上再开 Popup，弹层在水印之上。
- [x] App 端（模拟器，fjs-go）同页对拍：平铺位置、旋转角度、间距、透明度与
      web 截图一致（间距 5x3 / 旋转 7x3 / 插槽 3x3 @ 371x150，±22° 旋转一致）；
      点穿与弹层层级同 web；全页水印 文字/图片 切换两端一致。
- [x] 页面源码无平台分支；`demo/vite/vant.ts` 补丁零新增；dom-env 零改动。

## 3. 过程修正（实施中发现的）

- 模板 ref 在 fjs 标签上拿到的是 Fjsview 包装组件实例，测量前需 `host.$el ?? host`
  解包（vant-float 页同款）。
- web 构建里 `<image>` 标签被同名 prop `image` 吞掉（编译器优先 setup 绑定，
  tag 编译成 prop 值即 URL）——改 `<component :is>` + `resolveDynamicComponent`
  （runtime picker 先例）；App 构建 `image` 是 native tag 不受影响。
- 测量收敛条件从「首个非零 rect」加强为「rect 连续两帧不变」（页面转场滑入
  途中的 rect 非零但偏小，曾把旋转示例冻在 1×1）。
- `#dcdee0 @ 0.6` "看不见"是客观对比度（~4%）而非渲染缺陷，红色探针验证
  opacity 对文字正常生效；保留 vant 默认色并在页面注明。
- 追加：全页水印 文字/图片 切换（图片 606×194 → tile 125×40 按原始比例，
  否则 `<image>` 拉伸）。

## 4. 不做

- 不动 runtime 与 flutter_fjs（不需要任何新 CSS/DOM 能力）。
- 不模拟 vant 的 blob-URL 管线（`innerHTML` / `Blob` / 位图背景都不垫）。
- 不做 watermark 的 canvas 绘制路径（`<canvas>` 盒子会参与命中，做不了点穿）。
- 不改 vant 其余组件的注册与样式清单。
- fixed 元素的 overlay 宿主级别控制（页面级 / app 级，如 `overlay="app"`
  属性或 CSS 属性）另案 spec：现行为是页面级宿主 + app 级 toast 宿主
  （specs/133/134），显式控制属 runtime 能力，涉及 hoist 路由与宿主生命周期。

