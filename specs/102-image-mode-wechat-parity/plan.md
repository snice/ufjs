# Plan: image mode 对齐微信小程序

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | ✓ | 位置类 mode：web `object-fit: none` ↔ Flutter `BoxFit.none`；heightFix 宽优先规则两端各自实现、同一个判定语义（声明/用宽），事件载荷不动 |
| II 边界即契约 | ✗ | op 协议、natives、事件类型零变更（mode 只是组件 prop） |
| III 同步单线程零序列化 | ✗ | 不碰 JSI 与 op 编码 |
| IV 外观照 WeUI | ✗ | 不新增内置组件外观 |
| V 静默失效是 bug | ✓ | 未知 mode 仍告警降级；heightFix 拿不到 intrinsic 尺寸时维持既有 `warnOnce` 路径，不静默换成另一种盒子 |
| VI 注释记录权衡 | ✓ | `mode.ts` 的位置类分支、`basic.ts` 的 heightFix 钉高、`image_mode.dart` 的宽优先分支各写一条「为什么是微信这个语义」的注释，密度对齐现有文件 |
| VII JS 能包就不要下 Dart | ✓ | 两端改动都在既有 mode 解析/渲染路径里，不新增 Dart 能力、不新增 JS 组件 |
| VIII 变更落到文档 | ✓ | `docs/ui-api.md` mode 表 + fix 段落、`docs/web.md` image 小节、`docs/roadmap.md` 补一行 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime（共享解析） | `packages/fjs-runtime/src/image/mode.ts` | 9 个位置类 mode 的 `objectFit` 由 `cover` 改 `none`（类型联合加 `'none'`），注释换成微信语义与出处 |
| Web 适配层 | `packages/fjs-runtime/src/web/components/basic.ts` | 位置类自动跟着 mode.ts 走；heightFix 不再写 `width: auto`，改为 `align-self: flex-start` + 拿到 intrinsic 后量用宽、把 `height` 钉成 `w * nh / nw`（src/mode 变化时清空重算） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/image_mode.dart` | 位置类 `BoxFit.cover` → `BoxFit.none`（10 个 case） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/image.dart` | heightFix 分支改宽优先：`style.width != null` → `SizedBox(w, w/ratio)`（与 widthFix 同一支），否则 `style.height != null` → `SizedBox(h*ratio, h)` |
| 测试 | `packages/fjs-runtime/test/image-mode.test.ts`、`web-image.test.ts`、`packages/flutter_fjs/test/image_test.dart` | 见 §5 |
| 文档 | `docs/ui-api.md`、`docs/web.md`、`docs/roadmap.md` | mode 表语义列、fix 段落、新增一行 |
| CLI / 构建、C++ 引擎 | — | 不涉及 |

小程序端零改动（native 组件即参照物）。

## 3. 方案

### 3.1 位置类 mode：直接换拟合函数

- **选定**：`objectFit: 'none'` / `BoxFit.none`，`objectPosition` / `Alignment`
  沿用 spec 010 的 positions 表（方向语义不变，只有缩放变了）。
- **否掉**：给位置类 mode 造一个「按原图像素开窗」的自绘层（web 用
  background-image、Flutter 用 Stack+ClipRect）——`object-fit: none` 与
  `BoxFit.none` 就是这个语义的原生表达，已经在浏览器里验证过 `none` 是
  1:1 开窗且裁剪在盒内（红底探针无溢出），包一层只会多一个概念。
- **否掉**：按盒子/原图大小动态在 cover 和 none 之间切换——微信文档没有
  这种条件语义，实测（原图 600×400 > 盒 281×171）也是 none。

### 3.2 heightFix：宽优先，但 web 侧要「量」而不是「猜」

微信规则：**width 声明了就以宽为准（heightFix 退化成 widthFix），否则以
height 为准**。判定「width 是否声明」两端的依据不同：

- **Flutter**：`FjsStyle.width` 就是声明值，直接 `!= null` 判定，
  `style.width != null` 时走 widthFix 同一支。
- **web**：页面宽度常写在 class 里，render 时只拿得到 inline style，拿不到
  「类里声明过 width」。**选定**：不覆盖 width，先用
  `align-self: flex-start` 取消 column flex 的拉伸，等 intrinsic 尺寸到了
  再量**布局用宽** `w`，把 `height` 钉成 `w * nh / nw`：
  - 声明了 width（280）：量到 280 → 钉 186.67 ✓ 与微信一致；
  - 没声明 width（`.local-portrait`，只有 height:64）：浏览器本来就用
    `height × ratio` 推宽，量到 32 → 钉 `32 × 240/120 = 64`，是恒等式，
    等于不干预 ✓ 与微信一致；
  - 只有拉伸的场景：flex-start 先取消拉伸，退化成上一种 ✓。
  量-钉是自洽的（钉完再量仍得同一值），不会来回抖。
- **否掉**：临时把 inline `width: auto !important` 量一次对比来判定「类里
  有没有声明 width」——多一次强制重排，而且声明宽恰好等于容器宽时照样判不出来；
  量用宽的方案在同样场景下也不需要判定。
- **否掉**：让 heightFix 永远等同 widthFix（简单但错）——`.local-portrait`
  只声明 height 的场景实测是 32×64，两边都对不上。

钉高的触发点：`onMounted`、`@load`（intrinsic 到手）、`mode` / `src` 变化
（先清空钉高回到样式声明值，再在新图 load 后重算）。

### 3.3 文档

`docs/ui-api.md` mode 表的位置类行、heightFix 行与表下那段 fix 说明全部按新
语义改写；`docs/web.md` 的「image 的缓存与 lazy-load」小节里 widthFix /
heightFix 的 web 写法说明跟着改；`docs/roadmap.md` 在 image mode 那节补一条
对齐记录。

## 4. 风险

- **web 钉高的一帧抖动**：load 后才钉高，之前是样式声明的占位盒（170 →
  186.7 跳一次）。小程序同样要等 metadata 才能算，两端都跳、时机接近；
  现有 spec 010 的「占位盒先撑住」策略保持不变。
- **量宽的时机**：`getBoundingClientRect().width` 读到的是含
  `max-width: 100%` 的结果，容器窄于声明宽时钉出的高度跟着缩——比小程序
  （没有 max-width 默认）更保守，记为已知差异，不额外处理。
- **Flutter 位置类换成 `BoxFit.none` 后的溢出**：`RenderImage` 按 fit 画进
  自身 bounds，需要实机/单测确认没有画出盒子外；widget 测试里用
  `expectLater(find.byType(Image), ...)` 的尺寸断言覆盖盒子，视觉上跑
  hello-fjs image 页确认。
- **回归面**：`rich-text` 的 `widthFix` / `heightFix` 是另一条解析路径
  （`rich-text-layout.test.ts`），本 spec 不动它，跑 `pnpm test` 确认没被
  mode.ts 的类型改动带崩。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test
cd packages/flutter_fjs && flutter test && cd -     # 看到 "All tests passed"，
                                                    # 不是 "No tests ran"（native 未编）

pnpm --filter hello-fjs run dev:web                 # 对拍复验：
# 1) 重跑 /tmp/mp-auto 的 web 截图（14 个 mode）+ measure2.js + sim.js：
#    位置类 MAD 进 11–24 底噪带、heightFix 盒子 281×188、widthFix 不劣化
node /tmp/mp-auto/shoot-web.js                      # （脚本在 /tmp/mp-auto/）
node /tmp/mp-auto/measure2.js && node /tmp/mp-auto/sim.js
# 2) 人工：微信开发者工具打开 dist/mp 的 image 页，与 web 逐 mode 对照
```
