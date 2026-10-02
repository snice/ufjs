# Tasks: 178-vapor-web-page-transition

- [x] T1 web-history：CurrentPage.kind
- [x] T2 web-vapor：fjs-page-entry、data-nav、enter / leave、settled
- [x] T3 单测
- [x] T4 浏览器 true / false 对比
- [x] T5 iOS 两种模式
- [x] T6 文档（vue3.md 里「transitions play no animation」的说法、web.md）

## 结果
- 复现：enableVapor web 下 push 时旧页立即 `display: none`，无类名、无 `data-nav`
- 修复后浏览器（vite dev，`transition: 'fjs-slide'`）50ms 采样：true / false 的类名、`data-nav`、transform 轨迹逐帧一致
  （push：新页 x 315 → 0、旧页向左；pop：镜像），约 300ms 结束，旧页离场后才隐藏
  （唯一结构差异：VDOM 的 KeepAlive 把离开的页移出宿主，vapor 留在原处隐藏，不可见）
- iOS：两种模式由同一个路由把 `transition` 交给原生 Navigator，临时日志确认两者都是 `anim=fjs-fade`（日志已删）
- 单测：vapor-page-transition 4 条（push / pop / 关闭与页面覆盖 / tab），web-vapor-shell 改用 `fjs-page-entry` 与 `transition: false`
