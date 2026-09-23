# Tasks: image mode 对齐微信小程序

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 解析层（两端都依赖它）

- [x] T001 `packages/fjs-runtime/src/image/mode.ts`：9 个位置类 mode 的
  `objectFit` 改为 `'none'`（`ResolvedImageMode.objectFit` 联合类型加
  `'none'`），注释写清微信「不缩放、1:1 开窗」语义与本次对拍依据。
- [x] T002 `packages/flutter_fjs/lib/src/render/image_mode.dart`：位置类
  10 个 case 的 `BoxFit.cover` → `BoxFit.none`，注释同步（`center` 那条
  spec 010 特意点名的注释保留、语义改写）。

## Web 适配层

- [x] T010 `packages/fjs-runtime/src/web/components/basic.ts` `FjsImage`：
  heightFix 不再写 `width: auto`，保留 `align-self: flex-start`；新增钉高
  状态 `fixHeight`，在 `onMounted` / `@load` / `mode`·`src` 变化后量
  用宽并钉 `height = w * nh / nw`，mode 离开 heightFix 或 src 变化时先清空。
- [x] T011 确认位置类 mode 落到 `object-fit: none` 后裁剪在盒内（浏览器红底
  探针复跑一次，或直接靠 T030 的对拍量测）。

## Dart 宿主

- [x] T020 `packages/flutter_fjs/lib/src/widgets/image.dart`：heightFix 改
  宽优先——`style.width != null` 时走 `SizedBox(w, w / ratio)`（与 widthFix
  同一支），否则保持 `SizedBox(h * ratio, h)`；占位盒阶段同规则（宽声明了
  就先按宽撑住）。

## 测试

- [x] T030 `packages/fjs-runtime/test/image-mode.test.ts`：9 个位置类 mode
  断言 `objectFit: 'none'`（保留 objectPosition 断言）。
- [x] T031 `packages/fjs-runtime/test/web-image.test.ts`：heightFix 断言不再
  出现 `width: auto`、出现 `align-self: flex-start`；widthFix 断言不变。
- [x] T032 `packages/flutter_fjs/test/image_test.dart`：位置类 mode 断言
  `BoxFit.none`；新增 widget 尺寸断言——同给 width 280 / height 170 的
  heightFix 得 `280 × 186.67`，只给 height 64 的 heightFix 得 `32 × 64`。
- [x] T033 `pnpm run typecheck`、`pnpm test` 通过。
- [x] T034 `cd packages/flutter_fjs && flutter test` 全绿（不是 `No tests ran`）。

## 文档

- [x] T040 `docs/ui-api.md`：mode 表位置类两行、heightFix 行、表下 fix 段落
  改成新语义并注明对齐微信实拍。
- [x] T041 `docs/web.md`「image 的缓存与 lazy-load」小节的 widthFix/heightFix
  web 写法说明更新。
- [x] T042 `docs/roadmap.md` image mode 那节补一条「位置类 / heightFix 对齐
  小程序（spec 102）」。

## 验收

- [x] T050 spec 第 6 节第 4 条对拍复验：web 重截14 个 mode，
  位置类 MAD 进 11–24 底噪带、heightFix 盒子 281×188、已对齐四个不劣化。
- [x] T051 spec 第 6 节第 5 条页面操作验收（web ↔ 微信开发者工具逐 mode 目视）。
- [x] T052 spec.md 第 6 节逐条核对，状态改 `done`。
