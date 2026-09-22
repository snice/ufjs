# Plan: 094-devtools-vue-sourcemap

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 豁免 | 调试器不是页面能力；web 用浏览器 DevTools。登记 web.md |
| II 边界即契约 | eval 文件名 | 只改 Dart 传给 `fjs_vm_eval_source` 的 filename 字符串，ABI 不变 |
| III 同步单线程零序列化 | 否 | map 在 dev 机器上读，不进 UI op |
| IV 外观照 WeUI | 否 | |
| V 静默失效是 bug | 是 | map 读失败时留下原 URL，DevTools 退回编译脚本，不断开调试 |
| VI 注释记录权衡 | 是 | 插件头注释写清为什么自己拼 mappings、为什么 data URL |
| VII JS 能包就不要下 Dart | 是 | map 在 CLI；Dart 只改 eval 文件名，避免和源路径撞车 |
| VIII 变更落到文档 | 是 | debugger.md、toolchain.md、roadmap.md |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/bundler/vue-plugin.ts` | script + template map 拼回 .vue |
| CLI / 构建 | `packages/fjs/src/bundler/build.ts` | dev `sourcemap: 'external'`，追加 `fjs-map:`；单元包装后 mappings 下移一行 |
| CLI / 构建 | `packages/fjs/src/dev/server.ts` | dev 构建打开 sourcemap |
| CLI / 调试 | `packages/fjs/src/debug/cdp-server.ts` | `fjs-map:` 读文件改成 data URL |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | eval 文件名与源路径错开 |
| 文档 | `docs/debugger.md`、`docs/toolchain.md`、`docs/roadmap.md`、`docs/web.md` | 去掉「没有 source map」 |

引擎 C++ 不动。PrimJS 已经把 `//# sourceMappingURL=` 抄进 `scriptParsed`。

## 3. 方案

见仓库外的实现计划。落地时有一处和初稿不同：esbuild 0.23 的
`onLoad` **拒绝** `map` 字段。插件把拼好的 SFC map 记在进程内，
`stampDebuggerMap` 再把它套到 esbuild 自己的 map 上（esbuild 的
「原文」是编译后的模块，套完才是 `.vue`）。

被否掉的备选：把整份 map 以 data URL 写进手机上的脚本（设备内存和
scriptParsed 帧都会膨胀）；让 DevTools 自己 fetch dev server
（`Network.*` 被中继桥接，目标没有 `loadNetworkResource`）；升级
esbuild 只为了 `onLoad` 的 map 字段。

## 4. 风险

- 单元文件在 esbuild 之后多包一层函数，map 若不下移一行，断点会偏一行。
- 单元 eval 文件名如果仍是 `src/foo.vue`，和 map 的 source 相同，DevTools
  会把原文和产物当成同一个脚本。
- `FindDebuggerMagicContent` 拒绝 URL 里的空格。路径要百分号编码。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli run typecheck
pnpm --filter @ufjs/cli test
```
