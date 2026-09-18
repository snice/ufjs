import { defineConfig } from 'vitepress';

const repo = 'https://github.com/snice/ufjs';
// Cloudflare (Workers static assets) serves the site at the domain root; set DOCS_BASE only
// when hosting under a sub-path (e.g. /ufjs/)
const base = process.env.DOCS_BASE ?? '/';

export default defineConfig({
  lang: 'zh-CN',
  title: 'ufjs',
  description: '用 Vue 3 / TypeScript 写界面，一套源码编译到 Flutter、Web 和微信小程序',
  base,
  // README.md documents building/deploying this site; it is not a page
  srcExclude: ['README.md'],
  cleanUrls: true,
  lastUpdated: true,
  // head links are not base-prefixed by VitePress, unlike themeConfig.logo
  head: [['link', { rel: 'icon', href: `${base}logo.svg` }]],

  markdown: {
    lineNumbers: false,
  },

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '指南', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: '原理', link: '/advanced/overview', activeMatch: '/advanced/' },
      { text: '源码导读', link: '/source/', activeMatch: '/source/' },
      { text: '参考', link: '/reference/cli', activeMatch: '/reference/' },
      {
        text: '更多',
        items: [
          { text: '技术文档（仓库 docs/）', link: `${repo}/tree/main/docs` },
          { text: '更新日志', link: `${repo}/blob/main/packages/fjs/CHANGELOG.md` },
          { text: 'fjs go 下载', link: `${repo}/releases/latest` },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: 'ufjs 是什么', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '读懂项目结构', link: '/guide/project-structure' },
            { text: '写第一个页面', link: '/guide/first-page' },
          ],
        },
        {
          text: '基础',
          items: [
            { text: '页面与路由', link: '/guide/routing' },
            { text: '内置组件', link: '/guide/components' },
            { text: '样式', link: '/guide/styling' },
            { text: '事件、网络与状态', link: '/guide/events-and-data' },
            { text: '静态资源', link: '/guide/assets' },
            { text: '多端差异', link: '/guide/platforms' },
          ],
        },
        {
          text: '扩展',
          items: [
            { text: '添加插件与三方库', link: '/guide/plugins' },
            { text: '创建模块', link: '/guide/modules' },
            { text: 'Flutter 宿主与原生配置', link: '/guide/flutter-host' },
          ],
        },
        {
          text: '调试与发布',
          items: [
            { text: '调试', link: '/guide/debugging' },
            { text: '构建与发布', link: '/guide/build-and-release' },
            { text: '常见问题', link: '/guide/faq' },
          ],
        },
      ],
      '/advanced/': [
        {
          text: '原理',
          items: [
            { text: '总览：五个基本决策', link: '/advanced/overview' },
            { text: '渲染管线', link: '/advanced/rendering' },
            { text: '线程模型与一次点击', link: '/advanced/threading' },
            { text: 'JS 与原生通信', link: '/advanced/native-bridge' },
            { text: '分包、字节码与热更新', link: '/advanced/bundling' },
            { text: 'Web 与小程序是怎么成立的', link: '/advanced/web-and-mp' },
          ],
        },
      ],
      '/source/': [
        {
          text: '源码导读',
          items: [
            { text: '仓库地图', link: '/source/' },
            { text: '沿一次点击读源码', link: '/source/reading-path' },
            { text: '本地开发与调试 ufjs', link: '/source/contributing' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: 'CLI 命令', link: '/reference/cli' },
            { text: '配置', link: '/reference/config' },
            { text: '运行时 API', link: '/reference/runtime-api' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: repo }],

    editLink: {
      pattern: `${repo}/edit/main/website/:path`,
      text: '在 GitHub 上编辑此页',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',

    footer: {
      message: '基于 MIT 协议发布',
      copyright: 'Copyright © ufjs contributors',
    },
  },
});
