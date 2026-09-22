---
layout: home

hero:
  name: ufjs
  text: 一套 Vue 源码，多端运行
  tagline: 用 Vue 3 / TypeScript 写界面，一份源码运行在 Android、iOS、鸿蒙、桌面、浏览器和微信小程序
  image:
    src: /logo.svg
    alt: ufjs
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: ufjs 是什么
      link: /guide/introduction
    - theme: alt
      text: 原理
      link: /advanced/overview

features:
  - icon: 🧩
    title: 标准 Vue 3 + Vite
    details: SFC、&lt;script setup&gt;、scoped style、CSS 变量、pinia 都能用。项目就是一个普通的 Vite 工程，npm 生态照常装。
  - icon: 📱
    title: Flutter 原生渲染
    details: JS 引擎编进 App，JS 直接调 C++ 和 Dart，没有 WebView、没有 JSON 桥。界面是真正的 Flutter Widget。
  - icon: 🌐
    title: 一份源码，多端运行
    details: fjs build 出 Flutter 应用（Android / iOS / 鸿蒙 / 桌面），fjs build --web 出静态站点，fjs build --mp 出微信小程序。
  - icon: ⚡
    title: 装一次就能调试
    details: 手机装上 fjs go，扫码连 dev server，改 Vue 代码热更新直接推送，不用重新打原生包。
  - icon: 📦
    title: 模块即 npm 包
    details: 一个模块同时带 JS API、Vue 组件和 Flutter Widget，npm i 之后自动 autolink 进 Flutter 宿主。
  - icon: 🚀
    title: 字节码发布
    details: release 构建把 JS 编成引擎字节码，按页分包、按需加载，冷启动跳过解析。
---
