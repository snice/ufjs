# Tasks: autoimport —— pub 包 API 自动绑定

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `fjs-runtime/src/dart-bridge.ts`：导出 `FjsObjectModules` 空接口
      （声明合并点）+ `dartModule` 键名重载；index.ts 导出；既有用法
      回归
- [x] T002 dump JSON 语法落成 fixture：`packages/fjs/test/fixtures/
      mmkv.api.json`（mmkv 形状：MMKV 类 + 静态工厂 + encode/decode +
      Future + null + FjsCallback 参数 + unsupported 成员），本文件是
      fjs_introspect ↔ 生成器的唯一对拍物

## 实现

- [x] T010 `packages/fjs-introspect/`：pubspec.yaml（analyzer 宽约束）+
      lib/fjs_introspect.dart（entry 写入、AnalysisContextCollection、
      exportedNamespace 遍历、§4 类型语法序列化、JSON 落盘与状态输出），
      `dart analyze` 零错
- [x] T011 `packages/fjs/src/project/autoimport.ts`：readAutoimport、
      缓存键（清单+lock 哈希）、pubspec 补丁、entry 写入、dump 调度、
      dartAdapterSource / objectTypesSource 两个纯函数生成器、
      writeIfChanged 落盘
- [x] T012 `run.ts`：宿主流程挂 syncAutoimport；writeHostAutolink 追加
      `fjsRegisterObjects` 调用与 import；构建输出列跳过成员
- [x] T013 `types.ts` + `vite.ts`：d.ts 生成器接入（只读缓存，无缓存
      skipped）；`cli.ts` 加 `fjs autoimport [--force]`

## 两端对齐

- [x] T020 demo 演示：声明合并让 `dartModule('mmkv')` 有类型。**现状**：
      `src/fjs-objects.d.ts` 已是 `fjs autoimport` 生成物（不再手写，
      exerciser 已移除）；手写声明合并的示例改由 specs/159 §11 的
      `src/fjs-playground.d.ts` 承担

## 测试

- [x] T030 `packages/fjs/test/autoimport.test.ts`：fixture dump → 生成物
      golden（dart + d.ts）；空 autoimport → 文件清理；冲突消歧；
      unsupported 清单进构建输出
- [x] T031 `pnpm run typecheck`：声明合并让 `dartModule('mmkv')` 拿到
      fixture 接口（测试文件内造一份临时 augment 验证重载解析）

## 文档

- [x] T040 `docs/modules.md`：autoimport 指南（配置、生成物、troubleshooting：
      analyzer 约束冲突 → dependency_override）
- [x] T041 `docs/roadmap.md` 勾掉「Dart API 自动生成」；`docs/toolchain.md`
      加 `fjs autoimport` 一行

## 验收

- [x] T050 spec.md 第 6 节逐条核对（生成器 golden / dart analyze /
      typecheck / types --check / 文档）
- [x] T051 真实链路验证（临时宿主 + mmkv）：全链路跑通，见 spec §8
