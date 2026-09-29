# Tasks: 挂载路径瘦身

对应 plan：`./plan.md`

## 0. 基线
- [x] T0 `examples/bench/native/floor.ts`：element 9.5 / renderer 19.2 / styled 26.3 ms；creates 9.6 vs 裸 create 3.8；native:on 43.2

## 阶段 A
- [x] A1 createElement 按 tag 描述缓存；去掉预写 parentOf：creates 9.6 → 8.5，renderer 19.2 → 17.9
- [x] A2 insert 快路径：renderer 17.9 → 16.6
- [x] A3 样式输入合并：待写元素槽 + 词流（Uint32 缓冲随帧 `fjsStyle`，C++ `fjs_style_process_words`）；样式输入 7.1 → 3.2，styled 26.3 → 19.8，native:on 43.2 → 38.2
- [x] A4 渲染器直调后端 → **不做**：specs/150 已试同一改法（bind 到后端），差异在噪声内
- [x] A5 验收：typecheck / pnpm test / 两 flavor fjs-test、fjs-style-test / flutter test / verify 对拍全 0 不一致 / bench:mount 不回退 / 预编译产物重新生成

## 阶段 B
- [x] B1 模板克隆 floor 级实验（已还原）：格子子树 19.8 → 5.5（带记账 7.3）ms，样式一致；结论与全量待解决项见 spec §8
