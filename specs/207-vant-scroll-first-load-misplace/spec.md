# Spec: vant scroll 页首次进入 List「加载中」展示错位（iOS App）

- **ID**: 207-vant-scroll-first-load-misplace
- **状态**: in-progress
- **日期**: 2026-10-04

## 1. 要解决什么

打开 `demo/src/pages/vant/scroll.vue`（iOS 模拟器，`fjs run ios`），底部
「PullRefresh + List（0 条）」块在首次加载（`@load` 的 500ms 内）展示错位：

- 「加载中...」文字与它的 spinner 没有排成一行：spinner 掉到文字下方偏左，
  而 web 端是 spinner + 文字同行居中。
- 块内上方没有 `pull-refresh` 头部的占位，列表区域是一大块空白（scroll-view
  高度 `scrollHeight=420`），web 端该块高度由内容撑开。
- 数据加载完成（10 条出现）后是否自行恢复、以及用户主动下拉刷新那一次是否
  也错位，尚未确认（见 §7）。

Web 端（`fjs dev --web`）同一页面无此现象。

## 2. 不做什么（Non-goals）

- 不重做 spec 206 的 refresh 自定义头部模式（手势/几何/收口）。
- 不改 vant 源码、不给 `van-list` 打补丁；差异收在 demo 包装组件或引擎层。
- 不处理 Android / 鸿蒙（本次只在 iOS 复现，修完另验）。

## 3. 用户可见的行为

改完后页面代码不变：

```vue
<pull-refresh v-model:refreshing="refreshing" @refresh="onRefresh">
  <van-list v-model:loading="loading" :finished="finished" @load="onLoad">
    <van-cell v-for="i in items" :key="i" :title="`条目 ${i}`" />
  </van-list>
</pull-refresh>
```

首次进入页面，List 的「加载中...」行 spinner 与文字同行居中（与 web 同款），
加载完成后 10 条数据正常显示，之后下拉刷新各阶段（下拉刷新 / 松开刷新 /
加载中... / 刷新成功）的头部与列表位置不错位。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `refresh` 标签 + 嵌套 scroll-view；List 的 loading 行由 vant 的 `van-loading` 渲染 | `van-pull-refresh` 原样 |
| 事件载荷 | `statuschange` 为 JSON 字符串（沿用 206） | 不涉及 |
| 已知差异 | 根因未定（待 plan 阶段定位：van-loading 的 flex 排布？还是 refresh 首帧布局时机？），定位后补在这里 | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 暂定都不涉及（若根因在 Dart 侧布局，plan 阶段再勾）

## 6. 验收标准

1. `fjs run ios` 打开 vant: scroll 页，首次进入截图：List「加载中...」行 spinner
   与文字同行居中，与 `fjs dev --web` 同页对比一致。
2. 加载完成后 10 条数据显示，无空白错位；`finished-text` 到 30 条后正常。
3. 手动下拉触发刷新：头部四个阶段与列表位置无错位，收口后无残留空隙。
4. 从其它页进入再返回该页（二次进入）同样正常。
5. `pnpm --filter demo run typecheck`、`pnpm test` 通过。
6. 若改了 `lib/src/` 或 `fjs-runtime/src/web/`，docs（`ui-api.md` / `css-compat.md`）同步（宪法 VIII）。

## 7. 根因与决议

- 复现（iOS 模拟器，加载延迟临时拉长）：问题不在 PullRefresh 首刷，而是
  List 的「加载中...」行：`div.van-loading`（font-size:0）里
  `span.van-loading__spinner`（16px）与 `span.van-loading__text`
  （line-height:50px → 50px 高盒）都是 `inline-block; vertical-align: middle`。
- App 端块级流把一串行内盒收成 `Wrap(crossAxisAlignment: end)`
  （`node_adapters.dart _buildBlockFlow`，「底边对齐 ≈ 基线」），16px 的 spinner
  于是贴在 50px 文字盒的底边，比文字中心低约 17px；web 的
  `vertical-align: middle` 让两者中线对齐。引擎没有读 `vertical-align: middle`。
- 待澄清三问用户已授权直接做：以 web 为准；块高固定 `scrollHeight` 的差异不动。
- 决议：行内盒 run 里所有盒都声明 `vertical-align: middle` 时，Wrap 交叉轴
  改为居中（走引擎，修所有 vant/NutUI 的 loading 行）；lint 放行 `middle`。
