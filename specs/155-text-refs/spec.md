# Spec: 文字写入走引用（TEXT op + 帧旁字符串表）

- **ID**: 155-text-refs
- **状态**: done
- **日期**: 2026-09-29

## 1. 要解决什么

specs/153 之后 flat-4050 VDOM 挂载（离线 20.5 ms）里写动态文字约 4 ms——比克隆本身还贵。一次
`OpWriter.setText` 1.36 µs（PrimJS 解释器）：`drawableText` 的正则 0.45 µs、op 头 0.27 µs、逐字节写字符串
0.64 µs（字符串只有 1–2 个字符，开销全在解释器的循环上）。文字更新（改 2000 格）同样付这笔。

## 2. 不做什么（Non-goals）

- 不改 Dart：Dart 收到的仍是原来的 SetText 字节，一字不差。
- 没有 libfjs-style 的环境（web、vitest、`__fjsNativeStyle = false`、旧 host）照旧逐字节编码。

## 3. 用户可见的行为

页面零改动。可观察的只有耗时：

```text
# examples/bench（fjsrun，PrimJS）
pnpm run native:on    flat-4050 VDOM 挂载 20.3 → ≤ 18.5 ms
pnpm run vapor        改 2000 格 VDOM / Vapor 都变快
```

## 4. 做法

- 新字节 op `TEXT`（0x4c，Dart 不可见）：`u32 id, u32 index`，字符串按下标放进随帧的 `fjsText` 数组
  （`OpWriter.textRefs` 打开时 `setText` 这样写：一次数组 push + 9 字节）。
- natives（`js_ui_ops`）把 `fjsText` 转成 C 字符串表交给 `fjs_style_process_frame`；libfjs-style 在字节流里
  原位展开成 SetText（顺序不变：同一元素的 Create 之前不会出现、同一帧多次写入保序），并按字节滤掉
  `drawableText` 滤的控制字符（都是 ASCII，不会落在 UTF-8 多字节序列里）。
- 被拒帧、实例 detach 后的 strip 路径（`fjs_style_strip_texts`）也展开；显式 `styleDetach` 之后进 strip。
- 开关：host 声明 `__fjs.fns.styleTextRefs` 且 `attachNative` 成功才打开；`globalThis.__fjsTextRefs = false`
  保留旧编码（A/B）。

## 5. 契约变更（宪法 II）

- [x] 样式输入字节 op（Dart 不可见）：`TEXT` 0x4c，`fjs_style.h` + `ops.ts` 同步
- [x] natives 表：`styleTextRefs`，`native-global.d.ts` 同步
- [ ] 事件类型

## 6. 验收标准

1. `fjs-style-test`（新增 TEXT：原位展开、控制字符、中文、strip、越界下标）、`fjs-test` 两 flavor、
   `pnpm test`（新增 `ops-text-refs.test.ts`）、typecheck 通过。
2. 交给 Dart 的帧不变：同一 bench 开 / 关引用，fjsrun `[frames]` 的 op 数与字节数相同（PrimJS / QuickJS）。
3. verify：flat-4050、demo 16 页、hello-fjs 66 页 0 不一致。
4. §3 的耗时。

## 7. 待澄清

无。

## 8. 结果（2026-09-29）

离线 fjsrun，同一构建开 / 关引用（`__fjsTextRefs`）A/B，中位数 ms：

| | 关 | 开 |
|---|---:|---:|
| flat-4050 VDOM 挂载（PrimJS） | 20.3 | 17.7 |
| flat-4050 VDOM 挂载（QuickJS） | 19.5 | 17.7 |
| flat-4050 Vapor 挂载（PrimJS） | 36.6 | 32–35 |
| 改 200 / 2000 格 VDOM | 12.2 / 22.6 | 11.9 / 20.1 |
| 改 200 / 2000 格 Vapor | 2.1 / 21.2 | 1.8 / 18.5 |

- 交给 Dart 的帧：flat-4050 bench 139 帧 460484 op 5577940 字节，开 / 关完全相同（两 flavor）；demo 16 页
  开 / 关相同；hello-fjs 66 页 op 数相同，字节数在同一构建的多次运行间本就浮动 ±4（页面上有计时文字）。
- verify：flat-4050、demo 2359 次、hello-fjs 17745 次，0 不一致。
- `fjs-style-test`、`fjs-test`（PrimJS / QuickJS）、`pnpm test` 通过。
