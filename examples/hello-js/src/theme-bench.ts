// 主题切换压测 —— 同一件事，不经过 Vue。
//
// `examples/hello-fjs` 的 `example/theme` 页量的是「Vue + 样式引擎 + 桥 +
// Flutter」这一整条链路，量出来真机上一次 4000 节点的切换要 1000–1800ms，而
// 同一份工作在 fjsrun 里只要 19ms（见 docs/performance.md）。中间差了 11 倍，
// 一直没有归因到人。
//
// 这一页存在的理由就是把那条链路拆成两半：它用**底层 element API + StyleEngine**
// 搭出和那一页同构的树——同样的 CSS、同样的节点数、同样的 12 个自定义属性、
// 同样的 `:active`——但没有 Vue，没有 vnode，没有 patch，没有路由，也没有 24 个
// 页面 chunk。两页放在同一台设备上对着读：
//
//   JS 耗时两边接近          → Vue 不是主因，成本在样式引擎 / GC
//   JS 耗时这边显著更低      → 差额就是 Vue 的 vnode 重建与 diff
//   过桥+应用、最慢帧接近    → Flutter 侧与框架无关（预期如此，桥已经是 0ms）
//
// 「堆压载」那一栏是给第三种可能准备的：hello-fjs 的堆是 16.8MB / 6 万个活对象，
// 这一页干净的时候只有几千个。QuickJS 是全堆标记清扫，回收一次的代价跟活对象
// 总数走，跟这一帧分配了多少无关。压载开着的时候只有堆变大，工作量一个字节都
// 没变——如果耗时跟着跳，那么 docs/performance.md 里那个「没解释掉的 11 倍」
// 就是它。
import {
  create,
  flush,
  hasNativeHost,
  host as nativeHost,
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

// 取值逐条抄自 hello-fjs 的 theme.vue / ThemeRows.vue，只是去掉了 scoped。
// 抄而不是共享：两个 example 之间没有依赖关系，而这份 CSS 正是被测对象，
// 悄悄漂移会让两边的数字失去可比性。改动其中一边时，另一边也要跟。
const SHEET = `
.page {
  /* theme.vue 里没有这一行：那一页是路由的根，宿主替它撑满。这里页面挂在
     tab 壳的下半屏里，得自己声明要占满剩下的高度。 */
  flex-grow: 1;
  background-color: var(--fjs-page);
}
.rows {
  /* 面板固定在上面，行占掉剩下的高度并在自己内部滚动——两种容器
     （scroll-view / list-view）都挂这一个 class，读数那一栏就不会被滚走。 */
  flex-grow: 1;
  padding-bottom: 24px;
}
.panel {
  background-color: var(--fjs-card);
  border-radius: 10px;
  margin: 12px;
  padding: 16px;
  gap: 14px;
}
.row-controls {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.label {
  width: 48px;
  font-size: 13px;
  color: var(--fjs-muted);
}
.segs {
  flex-grow: 1;
  flex-direction: row;
  gap: 8px;
}
.seg {
  flex-grow: 1;
  align-items: center;
  padding: 7px 0;
  border-radius: 7px;
  border-color: var(--fjs-border);
  background-color: var(--fjs-page);
}
.seg.on {
  background-color: var(--fjs-primary);
  border-color: var(--fjs-primary);
}
.seg-text {
  font-size: 13px;
  color: var(--fjs-text);
}
.seg.on .seg-text {
  color: #ffffff;
}
.toggle {
  align-items: center;
  padding: 12px 0;
  border-radius: 8px;
  background-color: var(--fjs-primary);
}
.toggle:active {
  opacity: 0.7;
}
.toggle-text {
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
}
.stats {
  flex-direction: row;
  gap: 8px;
}
.stat {
  flex-grow: 1;
  align-items: center;
  gap: 4px;
  padding: 10px 0;
  border-radius: 8px;
  background-color: var(--fjs-page);
}
.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--fjs-title);
}
.stat-value.bad {
  color: var(--fjs-danger);
}
.stat-label {
  font-size: 11px;
  color: var(--fjs-muted);
}
.engine {
  padding: 8px 10px;
  border-radius: 6px;
  background-color: var(--fjs-page);
}
.engine-text {
  font-size: 10px;
  font-family: Menlo;
  color: var(--fjs-muted);
  line-height: 1.5;
}
.hint {
  font-size: 11px;
  color: var(--fjs-faint);
  line-height: 1.5;
}
.item {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin: 0 12px 6px 12px;
  padding: 12px 16px;
  border-radius: 8px;
  border-color: var(--fjs-border);
  background-color: var(--fjs-card);
}
.item:active {
  background-color: var(--fjs-card-active);
}
.item.hot {
  /* 连续压测每帧翻的就是这一个 class：一次 setClasses 只脏一个元素，
     所以「每帧改 N 个」量出来的是每帧 N 个节点的真实吞吐，不是整树重排。 */
  background-color: var(--fjs-primary);
}
.item-title {
  flex-grow: 1;
  font-size: 15px;
  color: var(--fjs-title);
}
.item-meta {
  font-size: 12px;
  color: var(--fjs-muted);
}
.badge {
  align-items: center;
  border-radius: 4px;
  padding: 2px 6px;
  background-color: var(--fjs-primary);
}
.badge-text {
  font-size: 10px;
  color: #ffffff;
}
`;

/** 和 hello-fjs 的 theme.ts 同一组语义键、同一批取值：切换要走的自定义属性
 * 是 12 个，不是示意性的 3 个——每个都要重新解析一遍 var()。 */
const LIGHT: Record<string, string> = {
  '--fjs-primary': '#007AFF',
  '--fjs-success': '#4CD964',
  '--fjs-warn': '#F0AD4E',
  '--fjs-danger': '#DD524D',
  '--fjs-page': '#F4F5F7',
  '--fjs-card': '#FFFFFF',
  '--fjs-card-active': '#ECECEF',
  '--fjs-border': '#E5E5E5',
  '--fjs-title': '#1A1A1A',
  '--fjs-text': '#333333',
  '--fjs-muted': '#999999',
  '--fjs-faint': '#B0B0B0',
};

const DARK: Record<string, string> = {
  '--fjs-primary': '#0A84FF',
  '--fjs-success': '#32D74B',
  '--fjs-warn': '#FF9F0A',
  '--fjs-danger': '#FF453A',
  '--fjs-page': '#000000',
  '--fjs-card': '#1C1C1E',
  '--fjs-card-active': '#2C2C2E',
  '--fjs-border': '#38383A',
  '--fjs-title': '#F2F2F7',
  '--fjs-text': '#D8D8DC',
  '--fjs-muted': '#8E8E93',
  '--fjs-faint': '#636366',
};

const ROW_CHOICES = [200, 1000, 2000];

// registerPreFlush 没有反注册，每次挂载都注册一个闭包会无限累积——模块级只挂
// 一个，挂载时把当前引擎换进来（同 flat4050.ts 的注释）。
let activeEngine: StyleEngine | NativeStyleEngine | null = null;
let preFlushWired = false;
function wireEnginePreFlush(): void {
  if (preFlushWired) return;
  preFlushWired = true;
  registerPreFlush(() => activeEngine?.flushPending());
}

/** 一个活对象大约由「对象 + 数组 + 字符串」三份组成，所以 20000 轮 ≈ 6 万个
 * 活对象，正好是 hello-fjs 主题页的量级。必须**留着**引用：被回收掉的压载
 * 不会被标记扫描走到，也就压不了任何东西。 */
let ballast: unknown[] | null = null;

function setBallast(on: boolean): void {
  if (!on) {
    ballast = null;
    return;
  }
  const out = new Array(20000);
  for (let i = 0; i < out.length; i++) {
    out[i] = { id: i, key: 'ballast-' + i, tags: [i & 7, i & 3] };
  }
  ballast = out;
}

export function mountThemeBench(host: Element): () => void {
  // ---- 引擎与影子树 ---------------------------------------------------------
  // 这一段是 vue/renderer.ts 在 StyleEngine 周围做的事，手写一遍：父子映射、
  // 元素表、以及一个走同一条 setStyle 快路的 applyStyle。样式驻留（同一份
  // computed style 每帧只过一次桥）就在这条路上，所以两边过桥的字节数才可比。
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  const elements = new Map<number, Element>();
  /** 原生侧正握着 `:active` 样式的元素——和渲染器同样的记账，`.item:active`
   * 才会走到真实的（绕过 memo 的）序列化路径上。 */
  const hadActiveStyle = new Set<number>();

  // 引擎选择与 vue/host-ops.ts 同一条（specs/187）：Flutter 宿主带 libfjs-style
  // 时逐元素工作全在 native，TS 引擎只在 web / fjsrun / --ts-style 上兜底。
  // 之前这里直接实例化未 attach 的 TS 引擎，真机上量的是
  // 被 specs/150/172 淘汰的路径（flat4050 屏实测样式 flush ~26ms/次挂载）。recomputeSubtree 照旧调——native 下是 no-op，
  // libfjs-style 自己读 Insert / Remove op。
  const applyStyle = (id: number, style: Record<string, unknown>, activeStyle: Record<string, unknown> | null): void => {
    const el = elements.get(id);
    if (!el) return;
    if (activeStyle === null && !hadActiveStyle.has(id)) return setStyle(el, style);
    if (activeStyle) hadActiveStyle.add(id);
    else hadActiveStyle.delete(id);
    setStyle(el, style, activeStyle);
  };

  function makeFallbackEngine(): StyleEngine {
    return new StyleEngine(parentOf, childrenOf, applyStyle);
  }

  let engine: StyleEngine | NativeStyleEngine;
  // 本函数参数也叫 host（tab 壳的 stage 元素）——导入用别名，同 flat4050.ts
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

  /** 卸下一棵子树：原生侧一条 Remove 就够（Dart 的 `_removeDeep` 会递归），
   * JS 侧的引擎状态则要自己走一遍——留着的话，下一次重排还会把它们算进去。 */
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
      hadActiveStyle.delete(id);
    }
    remove(node);
  }

  // ---- 树 -------------------------------------------------------------------
  const page = el('view', 'page', null);
  insert(host, page);
  // 主题以内联自定义属性挂在页面根上，和 theme.vue 的「CSS 变量」写法一致
  engine.setInlineCustomProps(page.id, LIGHT);

  const panel = el('view', 'panel', page);

  /** 一栏分段选择器：左边一个标签，右边若干个互斥的格子。 */
  function segRow(
    label: string,
    options: string[],
    initial: number,
    onPick: (index: number) => void,
  ): void {
    const row = el('view', 'row-controls', panel);
    text('label', row, label);
    const segs = el('view', 'segs', row);
    const cells: Element[] = [];
    let current = initial;
    const paint = () => {
      for (let i = 0; i < cells.length; i++) {
        engine.setClasses(cells[i].id, i === current ? 'seg on' : 'seg');
      }
    };
    options.forEach((option, i) => {
      const cell = el('view', 'seg', segs);
      setProps(cell, {
        onTap: () => {
          if (current === i) return;
          current = i;
          paint();
          onPick(i);
        },
      });
      text('seg-text', cell, option);
      cells.push(cell);
    });
    paint();
  }

  let rows = ROW_CHOICES[0];
  segRow('节点数', ROW_CHOICES.map((n) => String(n * 4)), 0, (i) => {
    rows = ROW_CHOICES[i];
    buildRows();
    resetReadouts();
  });

  segRow('堆压载', ['无', '6 万对象'], 0, (i) => {
    setBallast(i === 1);
    resetReadouts();
  });

  // 行装在哪种容器里。两边的 JS 侧完全一样——样式引擎照样重算 3323 个元素，
  // 帧照样是 42 KB——差别整个在 Dart 那一侧：`scroll-view` 把 1000 行全部
  // build / layout / paint，`list-view` 走 ListView.builder，只碰屏上那十几行。
  // 这一栏就是用来量「Dart 侧到底值多少钱」的。
  const CONTAINERS = ['scroll-view', 'list-view'] as const;
  let container: (typeof CONTAINERS)[number] = 'scroll-view';
  segRow('容器', ['scroll-view', 'list-view'], 0, (i) => {
    container = CONTAINERS[i];
    buildRows();
    resetReadouts();
  });

  const toggleButton = el('view', 'toggle', panel);
  const toggleText = text('toggle-text', toggleButton, '切到暗色');
  setProps(toggleButton, { onTap: () => void toggle() });

  const stressButton = el('view', 'toggle', panel);
  const stressText = text('toggle-text', stressButton, '找并发上限');
  setProps(stressButton, { onTap: () => void sweep() });

  const statsBox = el('view', 'stats', panel);
  function stat(label: string): Element {
    const box = el('view', 'stat', statsBox);
    const value = text('stat-value', box, '—');
    text('stat-label', box, label);
    return value;
  }
  const kbValue = stat('帧大小');
  const jsValue = stat('JS 重算 + 编码');
  const bridgeValue = stat('过桥 + 应用');
  // 主题切换那条路上是「最慢帧」，扫描那条路上是「上限」。同一格两种含义，
  // 因为它们回答的是同一个问题：这一下卡不卡。
  const worstValue = stat('最慢帧 / 上限');

  const engineBox = el('view', 'engine', panel);
  const engineText = text('engine-text', engineBox, '—');

  text(
    'hint',
    panel,
    '同一件事，不经过 Vue：底层 element API + StyleEngine，没有 vnode、没有 patch。' +
      '和 hello-fjs 的 example/theme 对着读——JS 那一格的差额就是 Vue 这一层的价钱。' +
      '「堆压载」和「容器」都不改 JS 的**工作量**：recompute、applied、帧字节三样' +
      '一个不差。但耗时会跟着动——堆大了自动回收就够不着，Dart 侧的树小了 JS 也快' +
      '一截。工作量看引擎那一行，成本看四格。',
  );

  let rowsBox: Element | null = null;
  /** 行的元素 id，连续压测按它挑每帧要改的那 N 个。 */
  const itemIds: number[] = [];

  function buildRows(): void {
    if (rowsBox) destroy(rowsBox);
    rowsBox = el(container, 'rows', page);
    itemIds.length = 0;
    for (let i = 0; i < rows; i++) {
      const item = el('view', 'item', rowsBox);
      itemIds.push(item.id);
      text('item-title', item, `第 ${i + 1} 行`);
      text('item-meta', item, `#${String(i + 1).padStart(4, '0')}`);
      // 和 ThemeRows 的 `v-if="item.badge"` 同样的疏密：七行一个。Vue 那边
      // 剩下六行各留一个注释锚点，这边没有——那正是要量出来的差别之一。
      if (i % 7 === 0) {
        const badge = el('view', 'badge', item);
        text('badge-text', badge, 'NEW');
      }
    }
  }
  buildRows();

  // ---- 量 -------------------------------------------------------------------
  let dark = false;
  let sampling = false;
  let frameBytes: number | null = null;
  /** 上一次 toggle 的空跑分布，写在引擎那一行里。 */
  let jsSpread = '';
  let lastStatsLine = '';

  function paintEngine(): void {
    setText(engineText, lastStatsLine + (jsSpread === '' ? '' : `\n${jsSpread}`));
  }

  function resetReadouts(): void {
    frameBytes = null;
    setText(kbValue, '—');
    setText(jsValue, '—');
    setText(bridgeValue, '—');
    setText(worstValue, '—');
  }

  /** 让样式引擎的微任务重算跑完，再把它排的 op 冲出去。两跳：一跳给引擎的
   * flush，一跳给 op 的 flush。`flush()` 是同步的——所以 deliver 为 true 时，
   * Dart 侧的 applyFrame 就发生在这次调用里，被计时窗口罩住。 */
  async function drain(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    flush();
  }

  /** 跑一次切换，返回耗时。`deliver` 为 false 时帧被丢掉，不过桥。 */
  async function timeSwitch(deliver: boolean): Promise<number> {
    // 计时前不手动 gc()：它只能用于调试，示例里不允许调用。QuickJS 在分配越过
    // 阈值的地方收，忙帧里就是在工作中间，所以回收可能落进某一趟——这正是空跑
    // 要报六趟 min/med/max 的原因，看 min。堆有多大看性能面板的 heap 行（不触发
    // 回收）；「堆压载」开关照样能用，它改变的是回收落进来的频率。
    let bytes = 0;
    const forward = setOpSink((frame) => {
      bytes += frame.length;
      if (deliver) forward(frame);
    });
    engine.resetStats();
    const t0 = nowMs();
    dark = !dark;
    engine.setInlineCustomProps(page.id, dark ? DARK : LIGHT);
    await drain();
    const dt = nowMs() - t0;
    setOpSink(forward);

    // `markMs` 和 `flushMs` 是要先分开看的两半，而且后者不含前者：标脏遍历
    // 发生在框架的 patch 期间。`computeMiss` 是第二个要看的，它应该接近 0。
    const st = engine.stats;
    lastStatsLine =
        `mark ${st.markMs.toFixed(0)}ms/${st.markVisited}  ` +
        `flush ${st.flushMs.toFixed(0)}ms/${st.recompute}  ` +
        `miss ${st.computeMiss}  applied ${st.applied}\n` +
        `${st.elements} elements  ${st.rules} rules`;
    paintEngine();
    console.log('[style-stats]', JSON.stringify(st));
    if (deliver) frameBytes = bytes;
    return dt;
  }

  /** 空跑的趟数。必须是偶数：每一趟都翻一次主题，成对才净效果为零。
   *
   * 为什么不是一趟：**这条路上的单次读数不可信**。同一份工作、计数器分毫不差，
   * 耗时能在 13ms 和 85ms 之间跳——GC 落在窗口里的那一趟付全部账单。所以这里
   * 报 min（那一趟没有回收，描述的是代码），med/max 写进引擎那一行；min 和 max
   * 拉得很大的时候，故事就是 GC，盯着单次看没有用。docs/performance.md 里离线
   * 基准是同一套方法。 */
  const DRY_PASSES = 6;

  async function toggle(): Promise<void> {
    if (sampling) return;

    // 空跑：帧丢掉，量到的就是纯 JS（重算 + 编码）。丢帧这一步必要——uiOps 是
    // 同步调用，不拆的话 Dart 侧的 applyFrame 会被算进「JS」里。
    const dry: number[] = [];
    for (let i = 0; i < DRY_PASSES; i++) dry.push(await timeSwitch(false));
    // 上面这些趟发出的 DEFINE_STYLE 原生侧没收到，所以要让 writer 忘掉它的 id
    // 目录，下一帧重新发全量定义——否则真正那一趟会引用对端不认识的 id
    (globalThis as { __fjsForgetStyles?: () => void }).__fjsForgetStyles?.();

    const total = await timeSwitch(true);
    const sorted = dry.slice().sort((a, b) => a - b);
    const jsOnly = sorted[0];
    jsSpread = `js ${sorted[0].toFixed(0)}/${sorted[sorted.length >> 1].toFixed(0)}/${
      sorted[sorted.length - 1].toFixed(0)}ms min/med/max`;
    paintEngine();
    setText(toggleText, dark ? '切到亮色' : '切到暗色');
    setText(jsValue, jsOnly.toFixed(2) + ' ms');
    // 桥 = 真跑那一趟减掉紧挨着它的那一趟空跑，不是减 min：两者要挨在一起，
    // 才不会把一次落在其中一边的回收算成过桥的钱
    setText(bridgeValue, Math.max(total - dry[dry.length - 1], 0).toFixed(2) + ' ms');
    // web 上没有桥，字节数这一格没有意义——写 0 会让人以为过桥是免费的
    setText(
      kbValue,
      !hasNativeHost ? 'web 无桥' : frameBytes == null ? '—' : (frameBytes / 1024).toFixed(1) + ' KB',
    );
    sampleFrames();
  }

  /** 一轮：每帧改 N 个节点的 class，连做 [frames] 帧，返回帧间隔的 p50。
   *
   * 改动发生在 rAF 回调里，也就是 Flutter 一帧的 transient 阶段；微任务在 build
   * 之前排空，所以这一帧就把 op 应用并重建完（见 docs/threading-model.md）。帧
   * 间隔取 rAF 自己的时间戳，不是 nowMs()。 */
  async function stressRound(
    perFrame: number,
    frames: number,
  ): Promise<{ p50: number; max: number; jsAvg: number; bytes: number }> {
    const targets = itemIds.slice(0, perFrame);
    const intervals: number[] = [];
    const jsMs: number[] = [];
    let bytes = 0;
    let hot = false;
    let last = -1;

    const forward = setOpSink((frame) => {
      bytes += frame.length;
      forward(frame);
    });
    for (let i = 0; i < frames; i++) {
      const stamp = await nextFrame();
      if (last >= 0) intervals.push(stamp - last);
      last = stamp;
      hot = !hot;
      const t0 = nowMs();
      for (let k = 0; k < targets.length; k++) {
        engine.setClasses(targets[k], hot ? 'item hot' : 'item');
      }
      await drain();
      jsMs.push(nowMs() - t0);
    }
    setOpSink(forward);

    intervals.sort((a, b) => a - b);
    return {
      p50: intervals[intervals.length >> 1] ?? 0,
      max: intervals[intervals.length - 1] ?? 0,
      jsAvg: jsMs.reduce((a, b) => a + b, 0) / Math.max(jsMs.length, 1),
      bytes: bytes / frames,
    };
  }

  /** 并发上限：每帧能改多少个节点还守得住 60fps。
   *
   * 这条管线上**没有并发**——JS、过桥、Dart 的 build/layout/paint 全排在同一根
   * UI 线程上（docs/threading-model.md），所以上限就是这三段的和跨过 16.7ms 的
   * 那一点。逐档加倍地压，报最后一个 p50 ≤ 17ms 的档。
   *
   * 注意其中一段**和 N 无关**：容器把多少个节点放进了 widget 树。`scroll-view`
   * 里 1000 行会被整个重画，改 10 个和改 1000 个一样贵，上限直接塌到 0。 */
  const SWEEP = [10, 25, 50, 100, 200, 400, 800, 1600];
  const BUDGET_MS = 17;

  async function sweep(): Promise<void> {
    if (sampling) return;
    sampling = true;
    resetReadouts();

    let ceiling = 0;
    let lastRound = { p50: 0, max: 0, jsAvg: 0, bytes: 0 };
    const line: string[] = [];
    for (const n of SWEEP) {
      if (n > itemIds.length) break;
      setText(stressText, `压 ${n}/帧…`);
      const r = await stressRound(n, 40);
      lastRound = r;
      line.push(`${n}:${r.p50.toFixed(0)}`);
      if (r.p50 <= BUDGET_MS) ceiling = n;
      // 已经掉到 60fps 的四分之一，再往上加没有信息量了
      if (r.p50 > BUDGET_MS * 4) break;
    }

    setText(kbValue, lastRound.bytes.toFixed(0) + ' B');
    setText(jsValue, lastRound.jsAvg.toFixed(2) + ' ms');
    setText(bridgeValue, '含在左格');
    engine.setClasses(worstValue.id, ceiling === 0 ? 'stat-value bad' : 'stat-value');
    setText(worstValue, ceiling === 0 ? '< 10' : String(ceiling));
    lastStatsLine =
      `并发上限 ${ceiling === 0 ? '< 10' : ceiling} 个节点/帧 @60fps  ` +
      `（${container}）\n每档的帧间隔 p50(ms)  ${line.join('  ')}`;
    jsSpread = '';
    paintEngine();
    setText(stressText, '找并发上限');
    sampling = false;
  }

  /** 下一帧的时间戳（rAF 自己的，单位 ms）。 */
  function nextFrame(): Promise<number> {
    return new Promise<number>((resolve) => {
      if (typeof requestAnimationFrame !== 'function') {
        resolve(nowMs());
        return;
      }
      requestAnimationFrame((t) => resolve(typeof t === 'number' ? t : nowMs()));
    });
  }

  /** 切换之后连采 30 帧，报最长的一帧——掉帧看的是最坏值，不是平均值。 */
  function sampleFrames(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    sampling = true;
    setText(worstValue, '采样中');
    let worst = 0;
    let last = nowMs();
    let left = 30;
    const step = () => {
      const now = nowMs();
      const dt = now - last;
      last = now;
      if (dt > worst) worst = dt;
      if (--left > 0) {
        requestAnimationFrame(step);
        return;
      }
      // 16.7ms 是一帧的预算；超了就是肉眼可见的卡顿。
      engine.setClasses(worstValue.id, worst > 17 ? 'stat-value bad' : 'stat-value');
      setText(worstValue, worst.toFixed(1) + ' ms');
      sampling = false;
    };
    requestAnimationFrame(step);
  }

  // 一个脚本手柄，给**离线**跑用的：把 dist/bundle.js 和一段驱动代码拼在一起
  // 交给 fjsrun，就能不点屏幕跑出同一组数字。
  //
  //   __themeBench.setRows(1000); await __themeBench.run(7);
  //   __themeBench.setBallast(true)       只把堆撑大，工作量不变
  //
  // 不要指望 `fjs eval`：dev server 会把表达式推给 app，但答案回不来（本轮实测
  // 每次都超时），所以设备上还是点屏幕。
  //
  // `run` 返回每一趟的纯 JS 耗时（帧丢掉、不过桥），和屏上「JS 重算 + 编码」
  // 那一格同义；趟数取偶数，主题才回到原样。
  (globalThis as Record<string, unknown>).__themeBench = {
    toggle: () => toggle(),
    setRows: (n: number) => {
      rows = n;
      buildRows();
      resetReadouts();
    },
    setBallast,
    async run(times = 7): Promise<string> {
      const out: number[] = [];
      for (let i = 0; i <= times; i++) {
        const dt = await timeSwitch(false);
        if (i > 0) out.push(+dt.toFixed(2)); // 第一趟预热
      }
      (globalThis as { __fjsForgetStyles?: () => void }).__fjsForgetStyles?.();
      const sorted = out.slice().sort((a, b) => a - b);
      const line = JSON.stringify({
        rows,
        ballast: ballast !== null,
        elements: engine.stats.elements,
        min: sorted[0],
        med: sorted[sorted.length >> 1],
        max: sorted[sorted.length - 1],
        all: out,
      });
      console.log('[theme-bench]', line);
      return line;
    },
  };

  return () => {
    // destroy 里那一条 Remove 就把整棵子树从镜像树上摘掉了（Dart 侧
    // `_removeDeep` 递归到底并自己脱钩），不需要再补一条 removeChild
    destroy(page);
    activeEngine = null;
    delete (globalThis as Record<string, unknown>).__themeBench;
    ballast = null;
  };
}
