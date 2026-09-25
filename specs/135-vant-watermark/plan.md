# Plan: 135-vant-watermark

只动 demo（runtime / flutter_fjs / vite 补丁 / dom-env 零改动）。

1. `demo/src/plugins/vant/VanWatermark.vue`（新增，本地复刻组件）
   - props 与 vant `watermarkProps` 同名同默认：`gapX=0 / gapY=0 / image / width=100 /
     height=100 / rotate=-22 / zIndex / content / opacity / fullPage=true /
     textColor=#dcdee0`；具名插槽 `#content`（vant 的自定义内容走 `slots.content`，
     插槽优先级同 vant：插槽 > 图片 > 文字）。
   - 根节点类 `van-watermark`（+ `--full`），行内 `zIndex`（有 prop 才写）与
     `overflow: hidden`；平铺格 absolute（left/top = 序号×格尺寸），格内
     `__inner`（width×height、rotate、opacity）贴左上，`<text>` 颜色 textColor
     且 scoped CSS pin `font-size: 14px`。
   - 计数：onMounted 起 rAF 读根节点 `getBoundingClientRect()`，量到非零即
     ceil 出 cols/rows，至多重试 10 帧；watch 尺寸类 props（nextTick 后重测）；
     `window.resize` 重测（web 真事件，App 端 dom-env 转发）；unmount 取消 rAF
     与监听；格数封顶 64×64。
   - 顶部注释写明为什么本地复刻（blob-URL 管线三处不可用，spec 135）。
2. `demo/src/plugins/vant.ts`
   - import 本地组件并 `app.component('van-watermark', VanWatermark)`；
   - 样式清单加 `vant/es/watermark/style/index.mjs`（`.van-watermark` 定位、
     `pointer-events: none`、`--van-watermark-z-index` 都在这份 CSS 里）；
   - 不从 vant import Watermark。
3. `demo/src/pages/vant-watermark.vue`（新增对拍页，六块照 vant 官方 demo）
   - 文字（局部 relative 容器）/ 图片（vant logo，opacity 0.2）/ 间距
     （gap 30/10）/ 旋转（rotate 22）/ 全页开关（按钮切换 + 点穿计数按钮 +
     Popup 压层级）/ `#content` 插槽自定义水印。
4. `demo/src/pages/index.vue` 加 `/vant-watermark` 入口按钮。
5. 文档 `docs/vant-adaptation.md`：总账（spec 数 30、组件 46+1 本地、对拍页 7、
   本地适配行数）、接入面表加一行、已知差异加 Watermark 机制与几何差异。

验证顺序：typecheck → build:release + fjsrun 冒烟 → web dev 截图（含点穿）→
模拟器对拍 → 文档。
