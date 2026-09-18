# fjs go · App Store 上架材料

```
store/
  README.md              ← 本清单
  metadata.zh-Hans.md    名称 / 副标题 / 描述 / 关键词 / 网址（主语言）
  metadata.en-US.md      英文元数据（可选）
  review-notes.md        审核备注（英文，直接粘贴）+ 可能的追问
  privacy/index.html     隐私政策页（中英双语，部署后填网址）
  screenshots/
    iphone-6.9/01-05.png 1320×2868，上传到「iPhone 6.9 英寸显示屏」
    ipad-13/01-04.png    2064×2752，上传到「iPad 13 英寸显示屏」
    raw/                 模拟器原图（重新生成用）
  make_screenshots.py    原图 → 带标题的商店图
```

## 1. 审核风险（2.5.2）现在到哪了

App 内已经做好的部分：首页「在线演示」无需电脑就能完整走一遍，演示站在 manifest 带 hash
后二次打开几乎只剩一个请求；连演示站的探测放宽到 12 秒并自动重试一次，审核员首次冷启动
不会因为网络慢直接看到「连接失败」。

还差的只是**在 App Store Connect 里把用途说清楚**：`review-notes.md` 的英文备注直接粘贴，
描述里也已写明「开发调试工具」「运行的是你自己的工程」。风险降低了，但不是零——第一次
提交被追问 2.5.2 或 4.7（示例里的小游戏）都算正常，回复要点见 `review-notes.md` 末尾。

## 2. 上传前

- [ ] **隐私政策上线**：把 `privacy/index.html` 部署出去，例如随演示站一起放到
      `https://fjs-showcase.zhuzhe.dev/privacy.html`，再把网址填进 App 信息
- [ ] **显示名**：`ios/Runner/Info.plist` 的 `CFBundleDisplayName` 是 `Fjs Go`，
      建议改成和商店、App 内一致的 `fjs go`
- [ ] **版本号**：`pubspec.yaml` 的 `version: 1.0.0+1`，每次上传构建号（`+N`）都要递增
- [x] 出口合规：已在 Info.plist 声明 `ITSAppUsesNonExemptEncryption = false`
      （只用系统 HTTPS），上传后不会再逐版询问加密问题
- [x] 1024 图标无透明通道
- [ ] **隐私清单**：App 目标里还没有 `PrivacyInfo.xcprivacy`。Flutter 引擎和各插件自带清单；
      如果上传后收到 ITMS-91053（缺少 required reason API 声明）邮件，在 Xcode 里给 Runner
      新建一个 App Privacy 文件，声明 `NSPrivacyTracking = false`、不收集数据，按邮件列出的
      API 补上原因
- [ ] **打包**：`flutter build ipa --release`，用 Transporter 或 Xcode Organizer 上传

## 3. App Store Connect 填写

| 位置 | 填什么 |
|------|--------|
| App 信息 → 名称 / 副标题 / 类别 | `metadata.zh-Hans.md` |
| App 信息 → 隐私政策网址 | 部署后的 privacy 页 |
| 版本页 → 截图 | `screenshots/iphone-6.9/`、`screenshots/ipad-13/`，按文件名顺序拖入 |
| 版本页 → 推广文本 / 描述 / 关键词 / 技术支持网址 | `metadata.zh-Hans.md` |
| 版本页 → App 审核信息 | `review-notes.md` |
| App 隐私 → 数据收集 | 选 **「否，我们不从此 App 中收集数据」** |
| 年龄分级 | 各项内容都选「无」；「不受限制的网页访问」选 **否**（App 不提供浏览器，只运行开发者自己的工程） |
| 定价与销售范围 | 免费；地区按需 |

截图只需要最大尺寸那一组：6.9 英寸 iPhone 会自动缩放给其他 iPhone，13 英寸 iPad 同理。
因为 App 声明支持 iPad（`TARGETED_DEVICE_FAMILY = 1,2`），iPad 截图是必填的；若不想维护
iPad，可改成仅 iPhone 再上传。

## 4. 重新生成截图

```bash
# 1) 模拟器状态栏统一成 9:41、满格满电
xcrun simctl status_bar <设备> override --time 9:41 --dataNetwork wifi --wifiBars 3 \
  --cellularBars 4 --batteryState charged --batteryLevel 100

# 2) 拍原图，文件名对应 make_screenshots.py 里的 SHOTS
xcrun simctl io <设备> screenshot store/screenshots/raw/iphone-1-connect.png

# 3) 合成（需要 Pillow）
python3 -m venv /tmp/fjsgo-venv && /tmp/fjsgo-venv/bin/pip install pillow
/tmp/fjsgo-venv/bin/python store/make_screenshots.py
```

iPhone 用 iPhone 17 Pro Max 模拟器（1320×2868），iPad 用 iPad Pro 13-inch（2064×2752），
原图尺寸即商店要求尺寸。标题文案在 `make_screenshots.py` 顶部的 `SHOTS`。
