# Plan: vant List 加载行 spinner 与文字垂直对齐

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter 改 `node_adapters.dart`；web 浏览器原生支持 `vertical-align: middle`，无需改。小程序端该 CSS 透传（wxss），不动 |
| II 边界即契约 | 否 | 不动 op / natives / 事件；`verticalAlign` 已经随样式下发（`style.dart` 已有 getter） |
| III | 否 | — |
| IV 外观照 WeUI | 否 | 对齐 vant 数值，不涉及 WeUI |
| V 静默失效是 bug | 是 | `vertical-align: middle` 此前被静默忽略；lint 同步放行并改文案 |
| VI 注释记录权衡 | 是 | 新分支写明为什么只在「全部 middle」时才居中 |
| VII JS 能包就不要下 Dart | 是 | 排布在 Dart 的 `Wrap` 里，JS 侧没有行盒；纯 CSS 补丁（给 `.van-loading` 加 flex）只能修这一个组件，修不了同类的 NutUI/其它 inline-block+middle |
| VIII 文档 | 是 | `docs/css-compat.md` 的 `vertical-align` 行与 inline-block 行 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/commands/lint.ts` | `vertical-align: middle` 不再报 drop |
| JS runtime | `packages/fjs-runtime/src/css/support.ts` | `VERTICAL_ALIGN_VALUES` 加 `middle` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/node/node_adapters.dart` `_buildBlockFlow` | run 中所有行内盒 `verticalAlign == 'middle'` → `WrapCrossAlignment.center` |
| 文档 | `docs/css-compat.md` | 更新 `vertical-align` 与 inline-block 说明 |
| Demo | `demo/src/pages/vant/scroll.vue` | 还原临时 15s 延迟 |

## 3. 方案

选定：见上。被否：
- 在 demo 里给 `.van-loading` 加 `display:flex; align-items:center`：只修这一页，vant 其它 loading 行（Button loading、Toast）仍错；
- 全局把 Wrap 改成 center：会破坏 van-card 价格 / 标签底边对齐（注释里的既有行为）；
- 严格实现基线/`middle` 公式：没有行内格式化上下文，过度。

## 4. 风险

只在 run 内每个盒都 middle 时才居中，混合 run 保持 end，回归面窄。文字 run（无盒）不计入判定。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli run build && pnpm --filter demo run typecheck && pnpm test
# iOS：延迟临时拉长后看加载行，再还原
```
