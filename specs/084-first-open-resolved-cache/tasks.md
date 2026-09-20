# Tasks: 首开剩余——FjsStyleEntry 解析驻留 + compute miss 再瘦

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 无——三张契约表零变更（spec 第 5 节已勾"都不涉及"）。

## 实现

- [x] T010 `packages/flutter_fjs/lib/src/mirror_tree.dart`：`FjsStyleEntry`
      增加 interned view / overlay 槽（`Object?`，与 `MirrorNode.view` 同
      一层：mirror_tree 不 import `style.dart`，避免 op 解码器拉进 painting）。
      注释写清为什么挂在 entry 上、`DEFINE_STYLE` 换对象即失效。
- [x] T011 `packages/flutter_fjs/lib/src/render/style.dart`：`FjsStyle.of`
      走 entry.view；interned 路径 `props` 空。decorateNode 热路径派生值
      lazy 记在共享 view 上（null 用 resolved 旗区分）。
- [x] T012 `packages/flutter_fjs/lib/src/render/decoration.dart` +
      `style.dart`：`keepsBox` 从 `FjsStyle` 挪到 `decorateNode` /
      `transitionNode` 参数。
- [x] T013 `packages/flutter_fjs/lib/src/render/renderer.dart`：
      `tracksPress || tracksHover` 传给装饰层；`stateOf` 未按下返回 base
      view，按下/悬停按 overlay entry id 缓存在 `base.overlays`。
- [x] T014 `packages/fjs-runtime/src/css/style.ts`：`INHERITABLE` 热路径
      改冻结数组迭代（Set 留下给 `has`）。
- [x] T015 `packages/fjs-runtime/src/css/style.ts`：compute miss 把
      inherit 与 merged 合成一个对象，defaults/decls/inline 用 `for-in`
      覆盖；注释写清 076 当时为何没做。

## 两端对齐

- [x] T020 Web 侧无对应实现（浏览器原生 CSS / 布局）；既有 `css.test.ts`
      与 widget 对拍原样全过即口径不变。

## 测试

- [x] T030 `packages/flutter_fjs/test/resolved_style_test.dart`：共享
      styleId 的 padding/boxBorders identical；`DEFINE_STYLE` 换 id 后
      不是旧对象且值为新；active overlay 不写穿 base。
- [x] T031 `packages/fjs-runtime/test/css-compute-diet.test.ts`：无自带
      声明的子元素仍继承 color/fontSize；既有 custom 共享用例不改。
- [x] T032 `pnpm test` 全绿。
- [x] T033 `pnpm run typecheck` 通过。
- [x] T034 `cd packages/flutter_fjs && flutter test` 通过。
- [x] T035 `flutter test --dart-define=FJS_BENCH=true test/render_bench_test.dart`
      不回退。

## 文档

- [x] T040 `docs/vant-mount-perf.md`：本轮 A/B（first-paint / CSS
      attributed / match miss）落账。
- [x] T041 `docs/performance.md`：热点清单更新。
- [x] T042 `specs/084-first-open-resolved-cache/spec.md` 状态改 `done`。

## 验收

- [x] T050 spec 第 6 节逐条核对，真实输出贴进会话。
- [x] T051 模拟器同口径：vant-form first-paint ≤ 30 ms、CSS attributed
      ≤ 15 ms、match miss = 275（达不到 30 就落账，不拿 GC 凑数）。
      实测 first-paint 61 ms、css-flush 37.8 ms、match miss 275；未达 30/15，已落账。
