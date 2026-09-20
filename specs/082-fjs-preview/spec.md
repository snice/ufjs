# Spec: fjs preview——静态服务 release web 产物

- **ID**: 082-fjs-preview
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

roadmap 近期计划:验证 release web 产物要靠 `npx vite preview` 或手工起
`python -m http.server`——前者不知道 fjs 的产物结构,后者没有 SPA 兜底。
`fjs dev --web` 能看,但它构建 + 注入 reload 脚本,不是产物本身。

## 2. 不做什么(Non-goals)

- 不构建(`fjs build --web` 的事)、不注入 reload 片段、无 /ws。
- 不服务 dist/app(bundle 产物需要 dev server 协议语义,不是静态站点)。
- 不加缓存策略调优(沿用 no-store,避免验证时看旧产物)。

## 3. 用户可见的行为

```
fjs preview                 # 服务 dist/web,默认 4173
fjs preview --out build --port 5000 --host 0.0.0.0
```

dist/web 不存在时明确报错提示先 `fjs build --web`。

## 4. 两端约定(宪法 I)

不涉及;纯工具链。与 `fjs dev --web` 的 URL 语义必须逐字节一致——
抽出 `dev/static.ts` 共享(MIME 表 + SPA 兜底 + 穿越防护 + 诚实 404),
dev 行为不变。

## 5. 契约变更(宪法 II)

- [x] 都不涉及。

## 6. 验收标准

1. `resolveStaticFile` vitest 6 条(/ → index、存在资源、无扩展名兜底、
   带扩展名缺失 404、穿越拒绝、查询串剥离)全过。
2. demo 实跑:`/` 200 html、`/example/canvas` 200(SPA 兜底)、
   `/images/nope.png` 404。
3. `pnpm --filter @ufjs/cli test` 全绿(299 条)。

## 7. 待澄清

- 无。
