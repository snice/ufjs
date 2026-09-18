# ufjs 文档站

面向使用者的文档站，基于 [VitePress](https://vitepress.dev)，部署在 **Cloudflare Workers**（静态资源模式）。

这份 README 讲怎么在本地写文档、怎么部署。它不会出现在站点里（`config.mts` 的 `srcExclude`）。

## 目录

```text
website/
├─ .vitepress/
│  ├─ config.mts        站点配置：导航、侧边栏、搜索、base
│  └─ theme/            主题（在默认主题上改了品牌色）
├─ index.md             首页
├─ guide/               指南：开始 / 基础 / 扩展 / 调试与发布
├─ advanced/            原理
├─ source/              源码导读
├─ reference/           CLI、配置、运行时 API
├─ public/              原样拷贝的静态文件（logo）
├─ wrangler.jsonc       Cloudflare 部署配置
└─ package.json         workspace 包 ufjs-website
```

新增页面后，记得在 `config.mts` 的 `sidebar` 里登记。

## 本地开发

在仓库根目录：

```bash
pnpm install
pnpm docs:dev      # http://localhost:5173，改 md 即时刷新
pnpm docs:build    # 产物在 website/.vitepress/dist
```

`docs:build` 会检查死链，内部链接写错会直接构建失败。页内锚点（`#xxx`）不在检查范围内，改标题时顺手搜一下引用。

写作注意：

- 正文里不在反引号内的 `<tag>` 会被 Vue 当成组件吞掉，标签一律写在反引号或代码块里
- 行内代码里的 <span v-pre>`{{ }}`</span> 会被 Vue 插值，要用 `<span v-pre>…</span>` 包起来（代码块不受影响）
- 首页 `index.md` 的 frontmatter 会按 HTML 渲染，`<` 要写成 `&lt;`

## 部署到 Cloudflare

站点用 Cloudflare **Workers Builds** 连接 GitHub 仓库：push 到 `main` 后 Cloudflare 自己拉代码、构建、发布，仓库里不需要任何 CI 配置。

### 工作方式

```text
push main ──► Cloudflare 拉取仓库（根目录）
                │  构建命令：安装 website 依赖 → vitepress build
                ▼
          website/.vitepress/dist
                │  部署命令：wrangler deploy -c website/wrangler.jsonc
                ▼
          Worker 静态资源 ──► 自定义域 docs.<你的域名>
```

Workers 的创建表单里**没有「构建输出目录」**，输出目录写在 `wrangler.jsonc` 里：

```jsonc
{
  "name": "ufjs",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "./.vitepress/dist",        // 相对于这个文件
    "not_found_handling": "404-page",        // 未知路径返回 VitePress 生成的 404.html
    "html_handling": "auto-trailing-slash"   // /guide/introduction → guide/introduction.html
  }
}
```

站点开了 `cleanUrls`，链接不带 `.html`，靠 `html_handling` 解析到对应文件，不需要额外的重写规则。没有 Worker 脚本，纯静态资源，不产生 Worker 调用费用。

### 第一次配置

**1. 创建 Worker**

Cloudflare 控制台 → 计算（Workers）→ Workers 和 Pages → 创建 → 导入存储库，选择 `snice/ufjs`。

**2. 填写构建设置**

| 项 | 值 |
|---|---|
| 项目名称 | `ufjs`（要和 `wrangler.jsonc` 的 `name` 一致） |
| 构建命令 | `pnpm install --frozen-lockfile --filter ufjs-website && pnpm --filter ufjs-website run build` |
| 部署命令 | `npx wrangler deploy -c website/wrangler.jsonc` |
| 非生产分支部署命令 | `npx wrangler versions upload -c website/wrangler.jsonc` |
| 根目录（路径） | 留空，即仓库根目录 |

- **根目录必须是仓库根**：`pnpm-lock.yaml` 和 `pnpm-workspace.yaml` 在根上，设成 `website` 会让 `--frozen-lockfile` 找不到锁文件
- **两个部署命令都要带 `-c website/wrangler.jsonc`**：wrangler 默认只在当前目录（仓库根）找配置。非生产分支那条漏写的话，PR 预览构建会失败

**3. 环境变量**

「高级设置 → 构建变量」里加：

| 变量 | 值 |
|---|---|
| `NODE_VERSION` | `22` |
| `PNPM_VERSION` | `10.26.2`（和根 `package.json` 的 `packageManager` 一致） |

**4. 部署**

点「部署」。首次构建一两分钟，成功后会得到一个 `ufjs.<账号>.workers.dev` 地址，先用它确认站点正常。

**5. 绑定自定义域**

Worker → 设置 → 域和路由 → 添加 → **自定义域**，填 `docs.<你的域名>`。域名已经托管在 Cloudflare 时，DNS 记录和证书都会自动创建，几分钟内生效。

用「自定义域」而不是「路由」：路由要求你自己先建好 DNS 记录，自定义域一步到位。

**6.（建议）只在文档改动时构建**

Worker → 设置 → 构建 → 构建监视路径，包含路径填：

```text
website/*
pnpm-lock.yaml
```

否则每次改框架代码都会触发一次文档构建。

### 日常发布

合并到 `main` 就会自动发布，不需要任何手动操作。

- 在 Cloudflare 控制台 → 该 Worker → 部署，可以看到每次构建的日志和版本
- 其它分支和 PR 会上传为预览版本（不影响线上），在部署列表里有预览地址
- 回滚：部署列表里选中旧版本 →「部署」

### 手动部署（可选）

不经过 GitHub，直接从本机发布：

```bash
pnpm docs:build
npx wrangler login                                   # 第一次需要
npx wrangler deploy -c website/wrangler.jsonc
```

发布前可以先演练，不会真的上传：

```bash
npx wrangler deploy -c website/wrangler.jsonc --dry-run
```

## 部署在子路径

站点默认部署在域名根路径（`base: '/'`）。如果要放在子路径（比如 `https://example.com/ufjs/`），构建时设置 `DOCS_BASE`：

```bash
DOCS_BASE=/ufjs/ pnpm docs:build
```

`config.mts` 已经处理好了 favicon 等不会被 VitePress 自动加前缀的链接。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 部署失败：找不到配置 / `Missing entry-point` | 部署命令没带 `-c website/wrangler.jsonc` |
| `ERR_PNPM_NO_LOCKFILE` / lockfile 不匹配 | 根目录设成了 `website`；或改了依赖没提交 `pnpm-lock.yaml` |
| 页面刷新 404，首页正常 | `html_handling` 被改掉了，或站点关掉了 `cleanUrls` 后链接和文件名对不上 |
| 线上没有侧边栏和导航 | `website/.vitepress/` 没进仓库，检查 `.gitignore` |
| 图标 / 资源 404 | 部署在子路径却没设 `DOCS_BASE` |
| 「最后更新」时间都一样 | 构建时拉取的是浅克隆，git 历史不完整；不影响内容 |
