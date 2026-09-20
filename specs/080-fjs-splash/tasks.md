# Tasks: 080-fjs-splash

对应 spec:`./spec.md`。按顺序做,做完一条勾一条。

## 实现

- [x] T001 `commands/icon.ts`:findResizer / readPng / Resizer / Png 导出
  (splash 复用,注释说明归属)
- [x] T002 `commands/splash.ts`:Android——drawable-<dpi> 五档 launch_image +
  launch_background layer-list(drawable 与 drawable-v21)+
  values/colors.xml 合并 + values-v31/styles.xml(缺则建全文件,有则
  patch windowSplashScreen* 两项,已指向目标则不动)
- [x] T003 `commands/splash.ts`:iOS——LaunchImage.imageset 1x/2x/3x
  (Contents.json 不动)+ storyboard backgroundColor 改写(仅当模板
  恰好一行)
- [x] T004 cli.ts:import + case + usage 文本 + 头部注释;`--color/--size/
  --platform` 缺值显式报错

## 验证

- [x] T010 dry-run 列 12 个目标文件;实写后 layer-list / colors.xml /
  values-v31 / storyboard 颜色逐个核对
- [x] T011 幂等:连跑两次第二只改有差异的文件
- [x] T012 iOS 模拟器(iPhone 17)冷启动截图:深蓝 #0a1a2f 背景 + 居中
  logo(/tmp/sp5.png);Android 侧以生成文件核对(未起模拟器)
- [x] T013 `pnpm --filter @ufjs/cli run build` + `pnpm run typecheck` +
  `pnpm test` 全绿

## 文档

- [x] T020 docs/roadmap.md 打勾(收尾统一)
