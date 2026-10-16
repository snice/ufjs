# Plan: CSS `filter: blur()` 两端同源

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Web 原生 CSS（本来就有）；Flutter 补渲染；其余 filter 函数 App 端告警忽略并登记 |
| II 边界即契约 | 否 | `filter` 是既有 style 键（引擎透传），Dart 只多读一个 key；已在设备上确认到达 Dart |
| III 同步单线程零序列化 | 否 | 纯渲染包装 |
| V 静默失效是 bug | 是 | 非 blur 函数 `fjsWarnOnce` + `fjs lint` warn，不再静默丢；`backdrop-filter` 仍在 DROPPED_PROPERTIES |
| VI 注释记录权衡 | 是 | `filterNode` 写明 decal 的原因、与 transform 的顺序、为什么没有包装就不加 |
| VII JS 能包就不要下 Dart | 破例（有理由） | 高斯模糊需要 Flutter 的 `ImageFilter` 绘制能力，JS 侧无从实现 |
| VIII 文档 | 是 | `css-compat.md`、`ui-api.md`、`miniprogram.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/style_parse.dart` | `FjsFilter` + `parseFilter`（带 `_memo`）：取 `blur(<长度>)`，其余函数记入 `ignored`；`blur(0)` / `none` / 无函数 → null |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/style.dart` | `FjsStyle.filter` getter |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/decoration.dart` | `filterNode(style, content)`：`ImageFiltered(ImageFilter.blur(sigma, TileMode.decal))`；忽略的函数 `fjsWarnOnce` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/renderer.dart` | 在 `transitionNode` 的 child 处包 `filterNode`（filter 在 transform 之内，同 CSS 顺序） |
| Dart 测试 | `packages/flutter_fjs/test/filter_blur_test.dart`（新） | 6 个用例 |
| JS runtime | `packages/fjs-runtime/src/css/support.ts` | `DROPPED_PROPERTIES` 去掉 `filter`；新增 `FILTER_FUNCTIONS_ON_APP`；`backdrop-filter` 的提示改成指向 `<glass-surface>` |
| CLI | `packages/fjs/src/commands/lint.ts`、`packages/fjs/test/lint.test.ts` | `filter` 里非 blur 的函数报 warn；blur 不报；`backdrop-filter` 仍 drop |
| 文档 | `docs/css-compat.md`、`docs/ui-api.md`、`docs/miniprogram.md` | 见 spec §5 |

## 3. 方案

`filterNode` 放在 `transitionNode` 内侧：CSS 里 filter 先于 transform 生效，节点自己的缩放 / 位移不会被模糊半径放大。
无 blur 时不加任何 widget，所以绝大多数节点零成本。`ImageFiltered` 对整棵子树做一次离屏合成再模糊，布局与命中测试不变
（命中仍按原盒子，和浏览器一致）。

**被否的备选**：
- 借 `@ufjs/liquidglass` 的 `<glass-surface>` 做背景模糊（217/221 起初的做法）：它画的是「背后」，要把某个节点自己糊掉做不到，
  且把一个通用 CSS 能力绑到一个可选模块上；用户明确否决。
- 在 JS 侧截图再模糊：没有这条通路，违背宪法 III。
- 给 `filter` 加 transition：App 端 `border-radius` 同类，先不做，逐帧写样式即可。

## 4. 风险

1. `ImageFiltered` 与 `RepaintBoundary` / 滚动子树叠加的成本：大半径 + 整页内容在低端机上可能掉帧。设备上只看到逐帧写入能用；耗时需要真机 profile。
2. 在 Web 上 `filter` 会让元素成为其 `position: fixed` 后代的包含块——这是浏览器行为，不是本 spec 引入的；示例里已把 `CardExpand` 放在被模糊的容器之外，并写在注释里。
3. 把 `filter` 从「drop」降成「warn」会改变 `fjs lint` 的输出：有页面写了 `filter: blur` 现在不再被报，写了其他函数的才报。

## 5. 验证路径

```bash
cd packages/flutter_fjs && flutter test test/filter_blur_test.dart
pnpm --filter @ufjs/cli test && pnpm --filter @ufjs/runtime test
pnpm run typecheck && pnpm test
cd examples/app-store-clone && fjs run ios     # 拖动故事页，背景 Today 页被模糊
```
