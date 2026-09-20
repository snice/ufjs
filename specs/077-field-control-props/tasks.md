# Tasks: Field 控件属性对齐 DOM

对应 spec：`./spec.md`。实现与验证同步完成，存档如下。

## 契约层（先做，后面都依赖它）

- [x] T001 三张契约表零变更（spec 第 5 节）。

## 实现

- [x] T010 `widgets/input.dart`：TextField 增 `readOnly` / `enabled`
      （读 `readonly` / `disabled` prop）；`InputDecoration.filled: false`
      显式关掉宿主主题填充；多行默认行数读 `rows`。
- [x] T011 `widgets/control_scope.dart`：`FjsControlHandle` 增 `blur`；
      全局 `controlsByNode` 表（node id → handle，随挂载/卸载维护）与
      `fjsControlFocus` / `fjsControlBlur`。
- [x] T012 `engine.dart`：注册 `fjs.control.focus` / `fjs.control.blur`
      host 模块。
- [x] T013 `ui/element.ts`：Element 增 `focus()` / `blur()`（经 invokeHost，
      web 端原生 DOM 自带无需实现）。
- [x] T014 `vue/renderer.ts`：裸 `h('textarea')` 默认 `autoHeight: true`
      （vant autosize 在 App 上无 scrollHeight 可量，改为 Dart 原生长高；
      `<textarea>` 组件路径契约不变）。

## 两端对齐

- [x] T020 Web 端：readonly/disabled/focus/blur 是 DOM 原生能力，无需改；
      裸 textarea 在 web 由 vant 自己的 resizeTextarea 驱动（有真
      scrollHeight），行为一致。既有 textarea/input 测试原样全过。

## 测试

- [x] T030 新增 `flutter_fjs/test/input_control_test.dart`：8 条全过
      （见 spec 验收 1）。
- [x] T031 `flutter test` 全量 455+ 全过；`pnpm test` 591/287/30/36 全绿；
      typecheck / dart analyze 干净（唯一 warning 为预存）。

## 文档

- [x] T040 `docs/ui-api.md`：input 行补 `readonly` / `disabled` / `rows`；
      元素 DOM 形状 API 补 `focus()` / `blur()`；textarea 节补裸
      `h('textarea')` 默认 auto-height 的说明。

## 验收

- [x] T050 spec 第 6 节逐条核对：1 ✓（8/8 + 全量绿）、2 ✓、3 ✓
      （模拟器实测：0 TypeError、禁用灰字、备注 1→3 行长高）、
      4 ✓（单测钉住 filled:false；fjs go 需重编取新 Dart）。

## 遗留（已挂账，改天解决）

- [ ] T060 **多行输入（vant Field textarea）在 App 端不随内容长高**：
  超过约两行的内容被 cell 裁掉，行 3 底部裁半行。两轮重跑复现，诊断
  已到约束层：
  - peer 的 auto-height 语义成立：TextField 收到 `maxLines: null` +
    无界高度，内容 6 行时自身布局到 120pt（LayoutBuilder 帧内打印证实）；
    hello-fjs 的 textarea 案例同样成立——不是 widget 层的问题。
  - 裁剪层在外层：祖先链约束打印显示 `.van-field` 一级收到
    **TIGHT 40..40**（= cell 行高 24 + padding 16）把 ~100pt 子树钳住，
    `.van-cell` 的 `overflow: hidden` 完成裁剪。外层 FjsFlex 自身入参
    无界（h=0..inf），40 是它自己算出来的——fjs flex 的行交叉高度模型
    没把自增长控件的实际高度算进 cell 行高。vant 结构特有（wrap +
    嵌套行 + width:100%）；裸 `<textarea>` 场景未见。
  - 已试并回退（都不解决）：① input.dart 的 LayoutBuilder 外包
    intrinsic 应答（干跑 TextPainter）——外层行高不走 intrinsic；
    ② linechange 载荷回写 `el.style.height`（注意 DOM listener 收到
    的是 `{detail}` 包装，payload 要读 `.detail` 再 parse）——样式高度
    同样进不了行高模型。
  - 下一步：读 `render/flex.dart`（1431 行）的行交叉高度计算，让
    「自增长叶子控件」的实测高度参与父行高，或对含 auto-height 控件的
    行做两段式布局。引擎布局改动，按规矩单独立项。
