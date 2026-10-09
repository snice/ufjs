---
name: ufjs-debug
description: 把 ufjs 应用跑起来并调试：dev server、模拟器/真机连接、看日志、求值、dump 元素树、CDP 断点。当页面跑不起来、要验证改动效果、要查运行时报错、或需要检查真实元素树时用这篇。MCP 的 dev_status / get_logs / eval / dump_tree 是首选通道。
---

# ufjs 运行与调试

## 跑起来

| 目标 | 命令 | 端口 |
|------|------|------|
| dev server（App 连接） | `fjs dev` | 38900 |
| 浏览器开发 | `fjs dev --web` | 5173 |
| 小程序 dev | `fjs dev --mp` | 38900（产物在 dist/mp） |
| 起模拟器/真机并连 dev | `fjs run android` / `fjs run ios` | 自动连 38900 |
| 免装调试客户端 | 装一次 fjs-go，扫二维码/局域网发现连任意 `fjs dev` | 38900 |

端口常量表：dev **38900**；局域网发现（UDP 广播）**38901**；CDP relay
**38902**（HTTP+WS）、VM **38903**；web dev 5173；preview 4173。

模拟器里的回环地址：Android 模拟器用 `10.0.2.2:38900`，iOS/macOS 模拟器用
`127.0.0.1:38900`。

## MCP 运行时工具（首选，要求本机有 `fjs dev` 在跑）

改完代码后的标准验证循环：

1. `dev_status` —— dev server 活着吗？有几个端连着？项目名对吗？
2. `get_logs {durationMs}` —— 收一段 console 输出（`minLevel: "warn"` 只看警告以上）；
3. `eval {expression}` —— 在运行中的 VM 里求值（`eval '1+1'` 验证通道，
   `eval 'typeof __fjsDevtools'` 探 devtools）；
4. `dump_tree` —— 当前页面的真实元素树（缩进文本），验证节点结构/props 是否
   符合预期。页面结构不对时先看这里，别猜。**只在 App 端可用**：web 构建
   刻意不带 devtools 数据面（浏览器有自己的 DevTools），此时用 `eval` 检查。

错误都有明确原因：连不上 = dev server 没起或端口不对（注意 `fjs dev --web`
的端口是 5173 不是 38900）；eval 超时 = 端忙或没端连接；dump_tree 报
devtools 未注入 = 当前是 web 构建，或 release/无 `--devtools` 的 App 构建。

## 深度调试：CDP 断点

`fjs debug` 起 CDP relay，Chrome 打开 `http://127.0.0.1:38902` 得到完整
DevTools：断点、单步、scope、Console、Elements（活树）、Network。引擎是
PrimJS 时原生支持 inspector。sourcemap 走 `fjs-map:` 重写，SFC 源码可直接断。

## release 差异

release/字节码构建默认**剥离** devtools 数据面（`fjs build --devtools` 可保留
数据面供 `fjs debug` 用）。日志级别、warnOnce 在两端构建都在。调试一律先在
dev 模式复现——release 里只有现象，没有检查通道。

## 小程序端

`fjs dev --mp` 只做 watch + 重发 dist/mp，由微信开发者工具自己应用变更；调试
用微信开发者工具的面板，不走 CDP 通道。
