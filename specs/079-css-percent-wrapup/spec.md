# Spec: 百分比收尾——gap / border-radius / font-size 的 %

- **ID**: 079-css-percent-wrapup
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

css-compat 单位节的登记:`gap` / `border-radius` / `font-size` 按语义是
百分比,但此前读不出来——`gap: 5%`、`border-radius: 50%`(自适应盒)、
`font-size: 50%` 在 App 端静默失效,web(真 CSS)正常:

1. `gap`:App 端只认绝对值;`gap: 10%` 整条丢,布局塌到 0 间距。
2. `border-radius: 50%`:确定 px 盒(van-radio 圆)已支持;**相对尺寸**
   (`width: 50%` 的胶囊/圆)仍方角。
3. `font-size: 50%`:App 端落到 14px 默认(web 原生效),还要算清与
   em 解析的先后。

## 2. 不做什么(Non-goals)

- `border-radius: a / b` 椭圆写法(维持不支持,解析期整条 null)。
- 内容盒(content-sized)上的 % 圆角——参照是盒子**画出来的**尺寸,布局
  前不可知;约束参照会把 `border-radius: 10%` 放大成 pill。维持方角并登记
  (50% 圆等例外,用户可给盒子声明尺寸)。
- `calc(50% + 8px)` 的 font-size(引擎只改写裸 %,calc 维持现状,登记)。
- 自绘/覆盖路径(paintedOver 的 dashed/分边、foregroundDecoration)上的
  % 圆角——painter 在尺寸 LayoutBuilder 之外,组合罕见,保持方形 +
  `warnOnce` 一次(宪法 V)。

## 3. 用户可见的行为

```vue
<style scoped>
.tabs { display: flex; gap: 5%; }          /* App 上有真实间距 */
.avatar { width: 20%; height: 88px; border-radius: 50%; } /* 圆 */
.hint { font-size: 50%; }                  /* 相对父级字号 */
</style>
```

## 4. 两端约定(宪法 I)

| | Flutter(App) | Web |
|---|---|---|
| gap % | flex LayoutBuilder 内按容器自身轴尺寸解析(主轴 gap 参照主轴、交叉 gap 参照交叉轴),无界参照退化 0 | 真 CSS |
| border-radius % | 相对尺寸盒在尺寸 LayoutBuilder 内按解析后尺寸解析;内容盒方形(登记) | 真 CSS |
| font-size % | 引擎把裸 % 按父计算字号改写成 px 下发(根元素按 CSS 初始 16px);Dart 零改动 | 改写后的 px 与原生 % 同值 |

## 5. 契约变更(宪法 II)

- [x] 都不涉及——纯属性解析与消费,op / natives / 事件零改动。

## 6. 验收标准

1. `flutter test` 新增 `gap_percent_test.dart` 4 条全过:row 主轴 % gap、
   wrap 的 % spacing、绝对 gap 不回归、相对尺寸盒的 % 圆角。
2. `pnpm test` 的 css.test.ts 新增 4 条:父子链解析、孙级链式、根按 16px、
   父字号变化后子级重算。
3. `pnpm run typecheck` 全绿;hello-fjs「百分比间距与圆角」示例页通过
   vue-tsc。
4. css-compat.md 单位节与 roadmap 登记。

## 7. 待澄清

- 无。
