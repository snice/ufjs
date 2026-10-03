// flat-4050 压测 —— 同一棵 4050 元素的树，不经过 Vue。
//
// `examples/hello-fjs` 的 `example/interaction/flat-4050` 页对标 uni-app x 的
// vapor benchmark：上面常驻 5×10 格，点按钮在下面挂 50×40 格（每格 view +
// text，加上行 view，正好 4050 个元素）。那一页量到的「JS」里混着 Vue 的
// vnode 重建与 diff——它的拆账把过桥和样式引擎拆出去了，「其余」仍是
// Vue + element 层的合计。要优化 element API 本身，就得有一个没有 Vue 的
// 对照组：同样的树、同样的样式数值、同样的量法，直接用 create / insert /
// setText + StyleEngine 搭出来。两页放同一台设备上对着读：
//
//   两边「JS」接近            → Vue 不是主因，成本在样式引擎 / element 层
//   这边显著更低              → 差额就是 Vue 这一层的价钱
//   过桥、上屏、最慢帧接近    → Flutter 侧与框架无关（预期如此）
//
// 三段读数的含义与那一页逐字相同：
//
//   JS      tap 到 drain：样式重算 + op 编码 + 同步过桥 applyFrame
//   上屏    tap 到挂载后第二个 rAF：中间那一帧是 widget build + layout +
//           paint，第二个 rAF 回调触发时它已经上屏——对应 uni-app x 的总耗时
//   最慢帧  挂载后 30 帧里最长的一帧
//
// 没有 VDOM / Vapor 模式切换：那是那一页的职责，本屏只有 element 一条路。
// 量法照抄 flat-4050.vue 的 measure()，样式数值逐条抄自它和 GridVapor.vue
// （抄而不是共享：这份 CSS 正是被测对象，悄悄漂移会让两边的数字失去可比性）。
import {
  adoptElement,
  allocIds,
  create,
  flush,
  host as nativeHost,
  invokeHost,
  insert,
  NativeStyleEngine,
  nowMs,
  registerPreFlush,
  remove,
  setOpSink,
  setProps,
  setStyle,
  setText,
  StyleEngine,
  type Element,
} from 'fjs';

// rAF 是运行时装到 globalThis 上的全局（raf.ts），不是 fjs 的导出——同
// theme-bench 的用法，带上 typeof 守卫，web/无宿主环境也不炸。
declare const requestAnimationFrame: unknown;

function nextRaf(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      resolve();
      return;
    }
    (requestAnimationFrame as (cb: () => void) => void)(() => resolve());
  });
}

// 逐条抄自 flat-4050.vue / GridVapor.vue，去掉 scoped 与 .modes（VDOM/Vapor
// 切换不进本屏）。.page 那条 flex-grow 是 hello-js 特有的：屏挂在 tab 壳的
// 下半部分里，得自己声明占满剩余高度。
const SHEET = `
.page {
  flex-grow: 1;
}
.tip {
  margin: 8px 16px 0 16px;
  font-size: 13px;
}
.row {
  flex-direction: row;
}
.cell {
  background-color: #85d8b4;
  margin: 0.5px;
}
.tiny {
  font-size: 5px;
  line-height: 5px;
}
.btn {
  height: 48px;
  margin: 16px;
  background-color: #1677ff;
  border-radius: 8px;
  justify-content: center;
  align-items: center;
}
.btn:active {
  opacity: 0.7;
}
.btn-text {
  color: #ffffff;
}
.modes {
  flex-direction: row;
  margin: 16px 16px 0 16px;
}
.mode {
  flex-grow: 1;
  height: 36px;
  justify-content: center;
  align-items: center;
  border-width: 1px;
  border-color: #1677ff;
}
.mode.on {
  background-color: #1677ff;
}
.mode-text {
  font-size: 14px;
  color: #1677ff;
}
.mode.on .mode-text {
  color: #ffffff;
}
.bumps {
  flex-direction: row;
  margin: 0 16px 12px 16px;
}
.bump {
  flex-grow: 1;
  height: 36px;
  margin: 0 4px;
  border-radius: 6px;
  background-color: #e8f0ff;
  justify-content: center;
  align-items: center;
}
.bump.off {
  opacity: 0.4;
}
.bump-text {
  font-size: 13px;
  color: #1677ff;
}
.stats {
  flex-direction: row;
  justify-content: space-around;
  margin: 0 16px 8px 16px;
}
.stat {
  font-size: 12px;
}
.split {
  margin: 0 16px 8px 16px;
  font-size: 11px;
  color: #888888;
}
`;

/** 50 行 × 40 格：50 个行 view + 2000 个 cell view + 2000 个 text。 */
const ROWS = 50;
const COLS = 40;
const CELLS = ROWS * COLS;

/** 一次测量的读数，`__flat4050` 的返回值。 */
type Reading = { js: number; firstFrame: number | null; worst: number | null; split: string };

// registerPreFlush 没有反注册，每次挂载都注册一个闭包会无限累积——模块级只挂
// 一个，挂载时把当前引擎换进来。旧引擎的 flushPending 自己变 no-op：native 的
// commit() 在 pId===0 时直接返回，TS 的 inline 记录随 forget 清空。
let activeEngine: StyleEngine | NativeStyleEngine | null = null;
let preFlushWired = false;
function wireEnginePreFlush(): void {
  if (preFlushWired) return;
  preFlushWired = true;
  registerPreFlush(() => activeEngine?.flushPending());
}

export function mountFlat4050(host: Element): () => void {
  // ---- 引擎与影子树 ---------------------------------------------------------
  // 与 theme-bench.ts 同一段：vue/host-ops.ts 在 StyleEngine 周围做的事，手写
  // 一遍。不抽公共模块——这份样板本身就是测量路径的一部分，每个压测屏自包含，
  // 读数时不用跨文件核对账目。本屏没有 `:active` 之外的激活态样式，省掉
  // theme-bench 的 hadActiveStyle 记账（.btn:active 由原生侧自己处理）。
  // ---- 引擎与影子树 ---------------------------------------------------------
  // 与 theme-bench.ts 同一段：vue/host-ops.ts 在 StyleEngine 周围做的事，手写
  // 一遍。不抽公共模块——这份样板本身就是测量路径的一部分，每个压测屏自包含，
  // 读数时不用跨文件核对账目。本屏没有 `:active` 之外的激活态样式，省掉
  // theme-bench 的 hadActiveStyle 记账（.btn:active 由原生侧自己处理）。
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const elements = new Map<number, Element>();

  // 引擎选择与 vue/host-ops.ts 同一条（specs/187 修仪器）：Flutter 宿主带
  // libfjs-style 时逐元素工作全在 native，TS 引擎只在 web / fjsrun / --ts-style
  // 上兜底。specs/186 真机账目里「样式 flush ~26ms」量的是没 attach 的 TS 引擎，
  // 不是 element API 的账。recomputeSubtree 照旧调——native 下是 no-op，
  // libfjs-style 自己读 Insert / Remove op。
  const applyStyle = (id: number, style: Record<string, unknown>, activeStyle: Record<string, unknown> | null): void => {
    const el = elements.get(id);
    if (!el) return;
    if (activeStyle === null) return setStyle(el, style);
    setStyle(el, style, activeStyle);
  };

  function makeFallbackEngine(): StyleEngine {
    return new StyleEngine(parentOf, childrenOf, applyStyle);
  }

  let engine: StyleEngine | NativeStyleEngine;
  // 注意：本函数的参数名也叫 host（tab 壳的 stage 元素）——导入时必须用别名，
  // 不然这里拿到的是元素 {id, tag}，native 永远挂不上（specs/187 踩过）。
  const fns = nativeHost;
  const native = fns?.styleAttach !== undefined ? new NativeStyleEngine(applyStyle) : null;
  if (native !== null && native.attachNative(fns!)) {
    engine = native;
  } else {
    engine = makeFallbackEngine();
  }
  activeEngine = engine;
  wireEnginePreFlush();
  engine.register(null, SHEET);
  // 修仪器用的对照行：真机上应是 native；flush 那一格的归属以它为准
  console.log(`[flat-4050] engine ${engine === native && native !== null ? 'native' : 'ts-fallback'}`);

  function el(tag: string, cls: string | undefined, parent: Element | null): Element {
    const node = create(tag);
    elements.set(node.id, node);
    engine.ensure(node.id, tag);
    if (cls) engine.setClasses(node.id, cls);
    if (parent) {
      insert(parent, node);
      parentOf.set(node.id, parent.id);
      const list = childrenOf.get(parent.id) ?? [];
      list.push(node.id);
      childrenOf.set(parent.id, list);
      engine.recomputeSubtree(node.id);
    } else {
      parentOf.set(node.id, null);
    }
    return node;
  }

  function text(cls: string, parent: Element, value: string): Element {
    const node = el('text', cls, parent);
    setText(node, value);
    return node;
  }

  /** 卸下一棵子树：原生侧一条 Remove 就够，JS 侧的引擎状态要自己走一遍。 */
  function destroy(node: Element): void {
    const pid = parentOf.get(node.id);
    if (pid != null) {
      const siblings = childrenOf.get(pid);
      const at = siblings ? siblings.indexOf(node.id) : -1;
      if (at >= 0) siblings!.splice(at, 1);
    }
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop()!;
      const kids = childrenOf.get(id);
      if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
      engine.forget(id);
      elements.delete(id);
      parentOf.delete(id);
      childrenOf.delete(id);
    }
    remove(node);
  }

  // ---- 树 -------------------------------------------------------------------
  let disposed = false;
  const page = el('scroll-view', 'page', null);
  insert(host, page);

  text('tip', page, '1帧内显示110个元素。勿使用 debug 方式运行来测试性能');

  // 顶部常驻 5×10 格，和那一页同构
  const top = el('view', undefined, page);
  for (let r = 0; r < 5; r++) {
    const row = el('view', 'row', top);
    for (let i = 0; i < 10; i++) {
      const cell = el('view', 'cell', row);
      text('', cell, String(i));
    }
  }

  const btn = el('view', 'btn', page);
  const btnText = text('btn-text', btn, '同屏显示4050个元素');
  setProps(btn, { onTap: () => void toggle() });

  // 挂载模式：逐个（baseline，每个节点走 create/insert/setText）与克隆
  // （specs/188：模板注册一次，50 份实例一条 CLONE_MANY op 由 libfjs-style
  // 展开）。克隆只在 native 样式引擎上可用（engine.canClone）。
  const modesRow = el('view', 'modes', page);
  let mountMode: 'node' | 'clone' = 'node';
  const modeCells: Element[] = [];
  const paintModes = (): void => {
    for (let i = 0; i < modeCells.length; i++) {
      engine.setClasses(modeCells[i].id, (i === 0) === (mountMode === 'node') ? 'mode on' : 'mode');
    }
  };
  (['node', 'clone'] as const).forEach((m, i) => {
    const cell = el('view', 'mode', modesRow);
    text('mode-text', cell, m === 'node' ? '逐个' : '克隆');
    setProps(cell, {
      onTap: () => {
        if (mountMode === m) return;
        // 切模式先卸网格（hello-fjs 同款）：所有挂载都走 show 按钮的测量
        if (grid) {
          tearGrid();
          setText(btnText, '同屏显示4050个元素');
        }
        mountMode = m;
        paintModes();
      },
    });
    modeCells.push(cell);
  });
  paintModes();

  const bumpsRow = el('view', 'bumps', page);
  const bumpButtons: Element[] = [];
  for (const n of [1, 200, 2000]) {
    const cell = el('view', 'bump off', bumpsRow);
    text('bump-text', cell, `改 ${n} 格`);
    setProps(cell, { onTap: () => void bump(n) });
    bumpButtons.push(cell);
  }

  const statsRow = el('view', 'stats', page);
  const jsStat = text('stat', statsRow, 'JS —');
  const frameStat = text('stat', statsRow, '上屏 —');
  const worstStat = text('stat', statsRow, '最慢帧 —');
  const splitText = text('split', page, '');

  // ---- 网格 -----------------------------------------------------------------
  let grid: Element | null = null;
  /** 每格的 text 元素，bump 按下标直接 setText——没有 vnode，也就没有 diff。 */
  const cellTexts: Element[] = [];
  /** 每格当前显示的数：初始是列号（0..39），bump 后变成 bump 计数。 */
  const vals: number[] = new Array(CELLS);
  let bumps = 0;
  /** 克隆模板（specs/188）：一行 = row + 40×(cell+text)，前序 81 节点。模板
   * 跟着样式会话走（每次挂载重新 attach），所以在挂载闭包里定义一次。 */
  let rowTemplate: number | null = null;
  let warnedNoClone = false;

  function buildGrid(): void {
    grid = el('view', undefined, page);
    cellTexts.length = 0;
    const useClone = mountMode === 'clone' && engine.canClone;
    if (mountMode === 'clone' && !engine.canClone && !warnedNoClone) {
      warnedNoClone = true;
      console.warn('[flat-4050] 克隆挂载需要 native 样式引擎（libfjs-style），已回退逐个');
    }
    if (useClone) {
      if (rowTemplate === null) {
        // 初始内容每行相同（0..39）：静态文本进模板，克隆时无需逐份覆盖。
        // 行节点带 repaintBoundary——specs/188 的 paint 隔离在克隆路径同样生效。
        const specs = [
          {
            parent: -1, styled: true, raw: false, styleTag: 'view', defaults: undefined, scope: null,
            classes: 'row', createTag: 'view', props: '{"repaintBoundary":true}', text: '',
          },
        ];
        for (let j = 0; j < COLS; j++) {
          specs.push({
            parent: 0, styled: true, raw: false, styleTag: 'view', defaults: undefined, scope: null,
            classes: 'cell', createTag: 'view', props: '', text: '',
          });
          specs.push({
            parent: 2 * j + 1, styled: true, raw: false, styleTag: 'text', defaults: undefined, scope: null,
            classes: 'tiny', createTag: 'text', props: '', text: String(j),
          });
        }
        rowTemplate = engine.defineCloneTemplate(specs);
      }
      const NODES = 1 + COLS * 2;
      const first = allocIds(NODES * ROWS);
      engine.cloneMany(rowTemplate, first, ROWS, grid.id, 0, 0xffffffff, null);
      // libfjs-style 在帧末的 deferred op 里展开（行根插到 grid 下）；JS 侧
      // 补句柄与影子树记账——bump 的 setText、切屏的 destroy 都走它们。
      const gridKids = childrenOf.get(grid.id) ?? [];
      for (let r = 0; r < ROWS; r++) {
        const rowId = first + r * NODES;
        elements.set(rowId, adoptElement(rowId, 'view'));
        parentOf.set(rowId, grid.id);
        gridKids.push(rowId);
        const rowKids: number[] = [];
        childrenOf.set(rowId, rowKids);
        for (let j = 0; j < COLS; j++) {
          const cellId = rowId + 1 + j * 2;
          const textId = cellId + 1;
          elements.set(cellId, adoptElement(cellId, 'view'));
          parentOf.set(cellId, rowId);
          rowKids.push(cellId);
          const t = adoptElement(textId, 'text');
          elements.set(textId, t);
          parentOf.set(textId, cellId);
          childrenOf.set(cellId, [textId]);
          cellTexts.push(t);
          vals[r * COLS + j] = j;
        }
      }
      childrenOf.set(grid.id, gridKids);
      return;
    }
    for (let r = 0; r < ROWS; r++) {
      const row = el('view', 'row', grid);
      // 行级 paint 隔离（specs/188）：改行内一格只重录该行的显示列表，
      // 其余 49 行复用层缓存。代价是每行一个 layer。
      setProps(row, { repaintBoundary: true });
      for (let i = 0; i < COLS; i++) {
        const k = r * COLS + i;
        vals[k] = i;
        const cell = el('view', 'cell', row);
        cellTexts.push(text('tiny', cell, String(i)));
      }
    }
  }

  function tearGrid(): void {
    if (!grid) return;
    destroy(grid);
    grid = null;
    cellTexts.length = 0;
  }

  function paintBumps(): void {
    for (const b of bumpButtons) engine.setClasses(b.id, grid ? 'bump' : 'bump off');
  }

  // ---- 量 -------------------------------------------------------------------
  let busy = false;
  const fmt = (v: number | null) => (v == null ? '—' : `${v} ms`);

  /** 让样式引擎的微任务重算跑完，再把它排的 op 冲出去。两跳：一跳给引擎的
   * flush，一跳给 op 的 flush。`flush()` 是同步的——Dart 的 applyFrame 就
   * 发生在这次调用里，被计时窗口罩住。 */
  async function drain(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    flush();
  }

  const raf = nextRaf;

  /** One measured action：act 改树，然后和 hello-fjs 页同样的三段读数。 */
  async function measure(label: string, act: () => void): Promise<Reading> {
    const reading: Reading = { js: 0, firstFrame: null, worst: null, split: '' };
    if (busy) return reading;
    busy = true;
    let bridge = 0;
    let bytes = 0;
    const forward = setOpSink((frame) => {
      bytes += frame.length;
      const tb = nowMs();
      forward(frame);
      bridge += nowMs() - tb;
    });
    engine.resetStats();
    const t0 = nowMs();
    act();
    await drain();
    reading.js = +(nowMs() - t0).toFixed(1);
    setOpSink(forward);
    const st = engine.stats;
    reading.split =
      `过桥 ${bridge.toFixed(1)}ms/${(bytes / 1024).toFixed(0)}KB  ` +
      `样式 flush ${st.flushMs.toFixed(1)} mark ${st.markMs.toFixed(1)}  ` +
      `其余 ${(reading.js - bridge - st.flushMs - st.markMs).toFixed(1)}ms`;
    // The frame after the commit builds, lays out and paints the new subtree;
    // the rAF after that one is the first point where it is on screen.
    await raf();
    await raf();
    if (!disposed) {
      reading.firstFrame = +(nowMs() - t0).toFixed(1);
      let worst = 0;
      let last = nowMs();
      for (let i = 0; i < 30; i++) {
        await raf();
        if (disposed) break;
        const now = nowMs();
        worst = Math.max(worst, now - last);
        last = now;
      }
      reading.worst = +worst.toFixed(1);
    }
    setText(jsStat, `JS ${fmt(reading.js)}`);
    setText(frameStat, `上屏 ${fmt(reading.firstFrame)}`);
    setText(worstStat, `最慢帧 ${fmt(reading.worst)}`);
    setText(splitText, reading.split);
    console.log(
      `[flat-4050] element ${label} js=${reading.js}ms ` +
        `firstFrame=${reading.firstFrame}ms worst=${reading.worst}ms | ${reading.split}`,
    );
    busy = false;
    return reading;
  }

  async function toggle(): Promise<void> {
    const show = grid === null;
    const label = show && mountMode === 'clone' && engine.canClone ? 'show-clone' : show ? 'show' : 'hide';
    await measure(label, () => {
      if (show) buildGrid();
      else tearGrid();
      paintBumps();
    });
    setText(btnText, grid ? '隐藏' : '同屏显示4050个元素');
  }

  /** Bumps `n` cells spread over the grid (every CELLS/n-th one)。 */
  async function bump(n: number): Promise<Reading> {
    if (!grid) return { js: 0, firstFrame: null, worst: null, split: '' };
    bumps++;
    return measure(`update${n}`, () => {
      for (let k = 0; k < CELLS; k += CELLS / n) {
        vals[k] = bumps;
        setText(cellTexts[k], String(bumps));
      }
    });
  }

  // 脚本手柄，给**离线**跑用的：把 dist/bundle.js 和一段驱动代码拼在一起交给
  // fjsrun，就能不点屏幕跑出同一组数字（同 __themeBench 先例）：
  //
  //   __flat4050.setMode('clone'); await __flat4050.show(); await __flat4050.bump(200);
  (globalThis as Record<string, unknown>).__flat4050 = {
    show: () => (grid ? Promise.resolve({} as Reading) : toggle()),
    hide: () => (grid ? toggle() : Promise.resolve({} as Reading)),
    bump,
    // specs/193：开关 Dart 侧的自绘表面（'auto' | 'off' | 'force'），免重编对照开 / 关。
    // 模拟器的语义树一直是开着的，'auto' 在那里会回退，所以测自绘要用 'force'。
    setFlat: (m: 'auto' | 'off' | 'force') => invokeHost('fjs.dev.flat', m),
    // specs/196：Dart 侧「只改文字内容」快路径的开关（'on' | 'off'），免重编 A/B。
    setTextOnly: (m: 'on' | 'off') => invokeHost('fjs.dev.textOnly', m),
    // 自绘引擎计数器（'stats' 读、'reset' 清零）：真机上看重排节点数 / 块数 / 是否反复重新 pack
    flatStats: (m: 'stats' | 'reset' = 'stats') => invokeHost('fjs.dev.flat', m),
    setMode: (m: 'node' | 'clone') => {
      if (grid) {
        tearGrid();
        setText(btnText, '同屏显示4050个元素');
      }
      mountMode = m;
      paintModes();
    },
  };

  return () => {
    disposed = true;
    activeEngine = null;
    tearGrid();
    destroy(page);
    delete (globalThis as Record<string, unknown>).__flat4050;
  };
}
