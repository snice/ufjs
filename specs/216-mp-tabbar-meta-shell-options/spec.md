# Spec: createFjsApp shell 对象形式 + mp 原生 tabBar 图标/配色声明式配置

- **ID**: 216-mp-tabbar-meta-shell-options
- **状态**: done
- **日期**: 2026-10-11
- **来源**: 「早起挑战」小程序（early-up）接入 ufjs 时的两处 API 形状诉求 +
  接入过程中发现的两个既有 bug（wx 路由字符串 query、mp 模板 v-if 链被
  注释打断）。应用授权直接改框架（会话内口头 spec）。

## 1. 要解决什么

1. **`shell` 选项没有扩展位**：`shell: Shell` 直接传组件，想加变体/插槽
   就得再破坏一次签名。`tabBar: { component }`（specs/210）已经是对象
   形状，shell 应对齐。
2. **mp 原生 tabBar 只能出文字**：`meta.tab` 生成微信原生 tabBar 时
   `iconPath`/`selectedIconPath` 没有来源，个人开发者拿到的 tabBar 视觉
   不完整；选中色也被写死 `#007aff`，与品牌色打架。
3. **既有 bug ×2**（接入早期多页面时暴露）：
   - wx 路由 `toLocation('/result?ok=1&t=math')` 不解析字符串里的
     query → `mpUrl()` 的 path→mpPage 映射被 query 污染
     （`redirectTo:fail page "pages/result?ok=1&t=math&dur=7%2Fresult"`）。
   - mp 模板编译器收集 v-if 链时被兄弟位置的 HTML 注释打断，链上后续
     分支被静默丢弃（连带投影名单缺名，页面整段不渲染、无报错）。

## 2. 不做什么（Non-goals）

- **不做 mp 端 custom-tab-bar**（微信 `"custom": true` 编译管线）——
  specs/210 的 non-goal 维持，原生 tabBar 图标走声明式配置即可。
- 不做 shell 的插槽/变体——本 spec 只留 `{ component }` 的扩展位。
- 不改 web/App 端 tabBar 组件行为（specs/210/212 照旧）。

## 3. 用户可见的行为

```ts
createFjsApp({
  shell: { component: Shell },   // 对象形式（规范）；直接传组件仍兼容
});
```

```vue
<!-- 页面 <route> 块：mp 原生 tabBar 图标（81×81 PNG ≤40KB，不支持
     SVG / 网络图；public/ 下的图片落在小程序根目录） -->
<route>
{"title": "首页", "tab": 0, "icon": "/images/tab/home.png", "activeIcon": "/images/tab/home-active.png"}
</route>
```

```jsonc
// package.json —— fjs.mp.tabBar 覆盖原生条配色
{ "fjs": { "mp": { "tabBar": { "selectedColor": "#f97316" } } } }
```

## 4. 落地

- `router/types.ts`：`ShellOptions = Component | { component }` +
  `shellComponentOf()` 归一化；`RouteMeta` 增 `icon` / `activeIcon`。
- `router/flutter.ts` / `app/web.ts` / `app/web-vapor.ts`：4 处消费点走
  归一化；`VaporWebAppOptions.shell` 从 `unknown` 收紧为 `ShellOptions`。
- `mp/project.ts` `appJson()`：tabBar list 读取 meta 图标；
  `fjs.mp.tabBar`（`project/config.ts` 新字段）浅合并覆盖默认配色。
- 顺手修复：`wx/router.ts` 字符串 query 解析（对齐 web 端 vue-router
  行为）；`mp/wxml.ts` 链遍历跳过 COMMENT 节点。

## 5. 已知差异

- `'component' in shell` 探针对「带 `component` 键的函数组件」误判——
  实际不存在这种形状，登记即可。
- meta 图标路径不校验存在性：写错时微信开发者工具会在编译期报缺图。
