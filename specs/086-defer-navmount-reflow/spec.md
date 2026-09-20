# Spec: navMount 期间推迟同步 layout

- **ID**: 086-defer-navmount-reflow
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

从首页推进 vant-form，`[nav] mounted` 大约 250ms，push 转场被冻住。
iPhone 17 模拟器、debug、chunk 已预热后拆账：

| 片段 | 耗时 |
|---|---:|
| Vue `app.mount`（506 节点） | 39ms |
| CSS flush + encode + applyFrame | ~49ms |
| **一次 `fjs.ui.rect` → `flushLayout`（573 dirty）** | **158ms** |
| 其余微任务 | ~1ms |

那一次量尺寸发生在 `dispatchEvent(navMount)` 的 pump 里：某个 vant 控件
`onMounted` / `nextTick` 读了 `offsetWidth` / `getBoundingClientRect`，
`geometry.dart` 的 `_reflow` 把刚插进树的整页（外加 Navigator 里还在的上一页）
同步 layout。Widget **build 只要 1ms**；卡的是 layout，而且卡在 JS 调用栈上，
Navigator 转场画不了下一帧。

页面代码没写错。几百个节点是常态。GC / 改阈值 / 缩 JS 树都不打中这笔。

## 2. 不做什么（Non-goals）

- 不取消页面**已经挂上之后**的强制同步重排。vant collapse 同一 tick 里取消
  `display:none` 再读 `offsetHeight`（specs/073）必须仍拿到真实高度，既有
  `vant_layout_test` 两条 rect 用例不能回退。
- 不改 op 协议、不改 natives 表、不改事件类型。
- 不改 QuickJS GC 阈值（001）、不上 JIT、不做 scroll-view sliver、不动
  页面级 vant CSS（085 已回滚）。
- 不把 158ms 的 layout 本身变快（上一页一起 dirty、debug vs release、
  子树延迟 layout）——那是后续刀。本 spec 只把这次 layout **移出** navMount
  的同步窗口。
- 不保证 vant 在 `onMounted` 里读到的尺寸是最终值。那一拍允许全零；手势 /
  下一帧再读仍走强制重排。

## 3. 用户可见的行为

页面源码不用改。从首页点进 vant-form：

- `[nav] mounted` 不再包含那次 ~160ms `flushLayout`（模拟器 debug、chunk
  预热后应落到 Vue+CSS+applyFrame 那一档，约 90ms 量级）。
- Navigator 的 push 转场不再被这段 JS 调用冻住；内容仍在随后的 Flutter 帧
  里 layout/paint。
- 挂载期间 `el.getBoundingClientRect()` / `offset*` 对**尚未 layout 的新节点**
  返回全零（和 `docs/ui-api.md` 已写的「未布局时全零」一致）。
- 页面已在屏上之后，同一 tick 里改树再读 rect，行为与 073 相同（强制重排，
  读到新高度）。

```vue
<!-- 不用改；van-slider 若在 onMounted 里 useRect，第一拍可能是 0。
     拖动时会再读，那时页面已 layout，走强制重排。 -->
<van-slider v-model="slider" />
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `navMount` 当次 `JS_Call`+pump 内 `fjs.ui.rect` 不调用 `_reflow`；未 layout 的节点全零。页面已挂上后的读取仍强制重排（073） | 浏览器 `getBoundingClientRect` 始终可强制重排；没有「navMount 窗口」 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | App 端仅在 navMount 窗口内推迟重排；web 无此窗口。登记 `docs/web.md` | 见左 |

做不到两端「读 rect 的时机」逐毫秒一致：web 没有 Flutter 那次 500 节点
`flushLayout`。差异是性能路径，不是标签/事件契约。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过。
3. `cd packages/flutter_fjs && flutter test` 通过，且：
   - 既有「同一 tick 改树再读 rect」两条（073）仍绿；
   - 新增：在 defer 窗口内对尚未 build 的节点读 rect 得到 null/全零；窗口
     结束后同一节点强制重排读到真实高度。
4. iPhone 17 模拟器、`fjs run ios` debug、chunk 预热后点 vant-form：
   `[nav] mounted` 明显低于改前的 ~250ms（目标：不再含 ~160ms layout，
   落到 ~90ms 量级）。转场不再冻一拍。

## 7. 待澄清

- 无（第 1 刀的取舍已在会话里拍板：navMount 内推迟 `_reflow`，允许第一拍量到 0。）

## 8. 模拟器逐页报告（086 后）

口径：iPhone 17 模拟器、`fjs run ios` debug、chunk 已预热。一次冷启动后从首页
依次 push（basic → feedback → form → more → nav），每次返回再开下一页。
每页都是**本会话第一次**打开该 chunk；后开的页会吃到 076 的 matchCache
retire（同类 `van-*` 签名），所以 feedback 会明显短于 basic，不是测量误差。

`[nav] mounted`（`_mountWhenReady` 墙钟，chunk 已在、几乎只剩 `dispatchEvent`）：

| 页面 | 086 后 | 086 前（同机同口径） | 备注 |
|---|---:|---:|---|
| vant-basic | **40 ms** | 未逐页重测 | Button/Tag/Cell/Grid |
| vant-feedback | **13 ms** | 未逐页重测 | 弹层入口少，且排在 basic 之后 |
| vant-form | **91 ms** | **249–267 ms** | 最重；拆账里那次 158ms `flushLayout` 已不在这行 |
| vant-more | **62 ms** | 未逐页重测 | Collapse/Skeleton/NoticeBar |
| vant-nav | **55 ms** | 未逐页重测 | Tabs/Search/Swipe/Tabbar |

对照：同一进程里另一次单独点 form（前面没开过别的 vant 页）是 **98 ms**，
与上表 91 ms 同量级。086 前只对 form 做了带 layout 打点的拆账（249–267 ms
里 158 ms 是一次 `fjs.ui.rect` → `flushLayout`）；basic / more / nav 在
075 之前的旧表里是 196 / 341 / 228 ms，那是 CSS 线性匹配年代，不能直接减。

观感：五页 push 都不再被 navMount 冻一拍。form 仍是最慢的（Vue 40ms + CSS
~40ms + applyFrame ~8ms），那是节点数，不是 layout 叠在 JS 栈上。Slider
首屏 `slider = 30` 仍对（CSS 百分比，不依赖 mount 时那次量尺寸）。
vant-more 的 CountDown / NoticeBar 会在挂载后继续动，不影响 mounted 日志。
