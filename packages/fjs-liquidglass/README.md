# @ufjs/liquidglass

Liquid Glass for fjs: one `<glass-surface />` tag plus switchable tab bar styles.
Flutter paints it with the [`liquid_glass_widgets`](https://github.com/sdegenaar/liquid_glass_widgets)
shader; the browser uses `backdrop-filter` and, on Chromium, an SVG displacement
map for refraction (the technique from [gentpan/liquidglass](https://github.com/gentpan/liquidglass),
reimplemented in ~80 lines — no dependency on it).

```bash
pnpm add @ufjs/liquidglass
```

## `<glass-surface />`

A **leaf** glass layer: it draws one piece of glass and lays nothing out. Position it
absolutely to fill its container and draw the content as its siblings on top.

```vue
<view class="capsule">  <!-- flex-direction: row; border-radius: 26px -->
  <glass-surface class="fill" :radius="26" :blur="20" :refraction="0.6" />
  <view class="item">…</view>
</view>
```

| prop | default | |
|---|---|---|
| `radius` | 0 | corner radius in px — **write the same number as the element's CSS `border-radius`** |
| `blur` | 20 | backdrop blur radius |
| `tint` | the iOS 27 material's own (light `#F8F8F8` 53% / dark white 12%) | glass color |
| `refraction` | 0 | 0–1; 0 is plain frosted glass |
| `dark` | false | light / dark appearance |
| `pressed` | false | pressed state |

Degradation: `refraction` needs Impeller on the app and Chromium on the web; elsewhere
you get frosted glass (the web warns once). Not available in mini programs.

## Tab bar styles

```ts
import { registerTabBarStyle, getTabBarStyle } from '@ufjs/liquidglass';
registerTabBarStyle('mine', MyTabBar);   // 'liquid-glass' is built in
```

A style is a Vue component with props `{ tabs, active, dark?, accent? }`, the event
`select(path)` and a named slot `item`. The app dispatches (see hello-fjs `TabBar.vue`);
the global `tabBar` option of `createFjsApp` (specs/210) is unchanged. An unknown style
name warns once and falls back to `liquid-glass`.

## Requirements

- Flutter ≥ 3.41 (a dependency of `liquid_glass_widgets`).
- **iOS deployment target ≥ 15** in the host: uncomment `platform :ios, '15.0'` in
  `.fjs/flutter/ios/Podfile` and set `IPHONEOS_DEPLOYMENT_TARGET = 15.0` in the Runner
  project, then `pod install`. (Auto-bumping from the manifest is a follow-up.)
- Android and ohos are not verified.
