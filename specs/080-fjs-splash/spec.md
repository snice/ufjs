# Spec: fjs splash——一套图生成两端启动屏

- **ID**: 080-fjs-splash
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

roadmap 近期计划:启动屏不是"换几张图"——三套机制三种改法,全要动 XML:

- Android <12:`launch_background.xml` 的 layer-list;
- Android 12+:系统 splash(`windowSplashScreenBackground` /
  `windowSplashScreenAnimatedIcon`,图标被系统裁圆并限制区域);
- iOS:`LaunchScreen.storyboard` 引用的 LaunchImage.imageset。

用户要的是 `fjs icon` 那样的体验:一张源 PNG,进宿主,两端冷启动可见。

## 2. 不做什么(Non-goals)

- 不做启动动画(AnimatedVectorDrawable)、branding 图片(底部文字条)。
- 不改 Android `windowSplashScreenIconBackgroundColor` 圆底色 / iOS
  LaunchImage 以外的 storyboard 布局(模板的居中 imageView 已够用)。
- 不碰 values-night-v31(夜间 v31 组合,登记不做)。
- 不引入图像依赖:缩放仍外调 sips / ImageMagick(与 `fjs icon` 同一套)。

## 3. 用户可见的行为

```
fjs splash logo.png --color #0a1a2f     # 两端
fjs splash logo.png --platform ios      # 单端
fjs splash logo.png --size 160          # 逻辑尺寸(默认 192dp)
fjs splash logo.png --dry-run           # 列出将写的文件
```

App 冷启动:背景色全屏 + 居中 logo。Android 12+ 上图标被系统裁成圆形并
限制在约 2/3 区域(输出里提示一次,这是 OS 策略不是文件可绕的)。

## 4. 两端约定(宪法 I)

| | Android | iOS |
|---|---|---|
| 背景色 | `values/colors.xml` 的 `launch_bg`(--color 时写)+ layer-list 第一项;12+ 走 `windowSplashScreenBackground` | storyboard 的 backgroundColor(仅当模板带该行) |
| 居中图 | `drawable-<dpi>/launch_image.png`(密度 ×1/1.5/2/3/4),layer-list bitmap gravity=center | LaunchImage.imageset 1x/2x/3x(模板 Contents.json 不动) |
| 已知差异 | 12+ 图标裁圆、限 ~2/3 区域;night 模式沿用同一份颜色 | 无 |

## 5. 契约变更(宪法 II)

- [x] 都不涉及——纯宿主资源文件生成,协议/运行时零改动。

## 6. 验收标准

1. `pnpm run typecheck` + `pnpm test`(cli 包)全绿。
2. 对 demo 宿主 `fjs splash --dry-run` 列出两端目标文件;真写后文件内容
   正确(layer-list、colors.xml、values-v31、imageset 三倍图、storyboard
   颜色)。
3. iOS 模拟器冷启动可见启动屏(背景 + 居中图)。
4. icon.ts 行为不变(resizer/readPng 抽出后回归)。

## 7. 待澄清

- 无。
