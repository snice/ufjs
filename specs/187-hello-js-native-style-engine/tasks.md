# Tasks: 187-hello-js-native-style-engine

- [x] 1. `fjs-runtime/src/index.ts`：导出 `NativeStyleEngine`、`host`、`registerPreFlush`
- [x] 2. `examples/hello-js/src/flat4050.ts`：引擎选择（native attach → TS fallback）+ pre-flush
- [x] 3. `examples/hello-js/src/theme-bench.ts`：同上
- [x] 4. `pnpm --filter hello-js run build` + 离线 fjsrun 冒烟（fallback 路径先行验证 ✓）
- [x] 5. 真机 profile 复测：样式 flush ≈0、主题切换正常、记录新账目

# 结果（iPhone 15 Pro，profile，specs/186 的同一组动作）

仪器修好后（`[flat-4050] engine native`），与修之前（实为未 attach 的 TS 引擎）对读：

| 动作 | JS（修前 TS） | JS（修后 native） | 上屏（修前） | 上屏（修后） |
|---|---:|---:|---:|---:|
| show 挂载 | 103–107 ms（flush 25–27） | **62–73 ms（flush 0.6–0.7）** | 180–218 ms | **152–199 ms** |
| hide | 13–24 ms | 14–17 ms | 38–70 ms | 45–53 ms |
| 改 1 格 | 0.2–0.3 ms | 0.2–0.5 ms | 49–54 ms | 47–53 ms |
| 改 200 格 | 3.1–4.3 ms | 2.7–4.4 ms | 44–69 ms | 65–70 ms |
| 改 2000 格 | 25–31 ms | 20–22 ms | 115–135 ms | 102–119 ms |

- 样式 flush 26 → 0.6 ms；帧体积 167 → 113 KB（native 引擎的样式驻留复用）。
- 最慢帧恒 16.8–17.4 ms（无掉帧）；raster 最长 19.7 ms（挂载帧首次光栅）。

# 过程中发现并修掉的一个 instrumentation bug

`mountFlat4050(host: Element)` 的**参数 `host`（tab 壳 stage 元素，形状正是
`{id, tag}`）遮蔽了 `import { host } from 'fjs'`**，导致第一版引擎选择永远走
TS fallback。两个压测屏的导入一律用 `host as nativeHost` 别名规避。

# 遗留

- docs/performance.md 的数字更新与下一步优化（element 层模板克隆对照、
  repaint boundary）记入下一个 spec。
