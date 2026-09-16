// 宝石贴片的共享样式与雨落编排（spec 064）。
//
// pixi 版（match3.vue，WebGL）与 Leafer 版（leafer-match3.vue，canvas 2d）
// 必须取同一组绘制数值与动画节奏 —— 这两个页面的"两端同源"就落在这个模块：
// 调色表、贴片占格比例、五角星顶点、雨落的延迟/时长都从这里出，
// 页面只做各自引擎的绘制调用。

import type { Rng } from './model';

/** 参考图（全民消除星星）的色相基调，保持本仓库原有 6 色难度不变。 */
export const GEM_COLORS = ['#ff5a5f', '#ff9f43', '#feca57', '#1dd1a1', '#54a0ff', '#a55eea'];

export interface TileColors {
  /** 本色：贴片主体 */
  base: string;
  /** 顶部光带 */
  light: string;
  /** 外圈 bevel / 底边 */
  dark: string;
  /** 中央五角星 */
  star: string;
}

function hexMix(hex: string, target: string, t: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(target.slice(1), 16);
  const ch = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** #rrggbb → rgba() 字符串（Leafer 用；透明度写进颜色里，不设 opacity）。 */
export function rgba(hex: string, alpha: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 0xff},${(v >> 8) & 0xff},${v & 0xff},${alpha})`;
}

/** #rrggbb → 0xrrggbb（pixi 用）。 */
export function hexNum(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** 每色程序化派生浅/深/星三色，6 色只需维护一份基色。 */
export const TILES: TileColors[] = GEM_COLORS.map((base) => ({
  base,
  light: hexMix(base, '#ffffff', 0.45),
  dark: hexMix(base, '#000000', 0.3),
  star: hexMix(base, '#ffffff', 0.55),
}));

/** 贴片边长占格子的比例（参考图里贴片近乎满格，留一线缝隙）。 */
export const TILE_FILL = 0.92;

/** 五角星的 10 个顶点（中心在原点，第一点朝上）—— pixi Graphics 用。 */
export function starPoints(outer: number, inner: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  return pts;
}

// ── 开局雨落 ──────────────────────────────────────────────────────────
// 节奏照参考视频：一行一行自下而上落定 —— 每行作为一个整体落进自己的
// 行号，落定时刻按固定节拍推进；上一行还在半空时下一行已经出发，
// 连成一段不间断的"雨"。落差随行号递增，顶部几行因此从盘外出发。
// pixi 版下落中半透明；Leafer 版不沉 alpha（Group opacity < 1 会借
// 离屏画布合成，App 端没有，spec 059 §4 已登记），以下落 + 落定挤压表达。

export const RAIN = {
  /** 行落定节拍：底行先稳，每上一行晚这么多毫秒落稳 */
  rowLandMs: 130,
  /** 底行出发时在自己落点上方多少格 */
  baseDropCells: 1.4,
  /** 每上一行出发位置额外抬高多少格（顶部几行因此高出盘外） */
  rowDropCells: 0.75,
  /** 同一行内每颗的随机落差，让雨有碎感（不破坏行的整体感） */
  dropJitterCells: 0.5,
  /** 每格下落耗时：匀速快落、到点急停，是参考视频的手感 */
  msPerCell: 55,
  /** 落定挤压回弹时长 */
  squashMs: 100,
  /** 下落中的不透明度（pixi 版），落定回到 1 */
  fallingAlpha: 0.45,
};

export interface RainStep {
  /** 出发时刻（已整体前移到 ≥0） */
  startMs: number;
  /** 匀速下落时长 */
  durMs: number;
  /** 出发行号（小数；负数 = 盘外上方），乘 cell 加半格即起点 y */
  fromCellY: number;
}

/**
 * 整盘雨落编排：plan[r][c] 是 (r,c) 这颗宝石的走位（匀速直线，
 * 由 startMs/durMs/fromCellY 唯一确定，页面按已流逝时间取进度）。
 */
export function planRain(rows: number, cols: number, rng: Rng): RainStep[][] {
  const plan: RainStep[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ startMs: 0, durMs: 0, fromCellY: 0 })),
  );
  let minStart = Infinity;
  for (let c = 0; c < cols; c++) {
    for (let r = rows - 1; r >= 0; r--) {
      const step = plan[r][c];
      const land = (rows - 1 - r) * RAIN.rowLandMs;
      const drop =
        RAIN.baseDropCells +
        (rows - 1 - r) * RAIN.rowDropCells +
        rng() * RAIN.dropJitterCells;
      step.fromCellY = r - drop;
      step.durMs = drop * RAIN.msPerCell;
      // 允许为负：动画开始时这颗已经在半空（前几行正在落的样子）
      step.startMs = land - step.durMs;
      if (step.startMs < minStart) minStart = step.startMs;
    }
  }
  // 整体前移，让最早出发的宝石恰好在动画开始时离手
  const lead = minStart < 0 ? -minStart : 0;
  for (const row of plan) {
    for (const step of row) step.startMs += lead;
  }
  return plan;
}
