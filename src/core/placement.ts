// 单层放置：在一个容器内部的整数网格上做温度抖动局部搜索。
// 对照 TALA：internal/placement/node_placement.go:245（placeNodesOrthogonally）
//         internal/placement/sizeless_optimizer.go
// TALA 源码注释："heavily based on ... Graph Compact Orthogonal Layout by Freivalds and Glagolevs"
//
//   初始化：BFS 序贪心，每个节点放到已放邻居中位数附近最便宜的空格。
//   迭代 90·√N 轮，温度从 2·√N 几何衰减到 0.2：
//     1. 打乱节点顺序
//     2. 目标点 = 邻居坐标中位数 + U(-temp, temp) 抖动
//     3. 在目标点附近的曼哈顿菱形内找空格，移到代价最低的那个（即使比当前差也移）
//     4. 每 9 轮删一次空行/空列（压缩）
//   最后 temp = 0 做几轮纯贪心（必须严格变好才接受）。

import type { Cell } from "./types";
import type { Rng } from "./random";
import { buildOccupancy, cellKey, itemCost, levelCost, type CellMap, type LevelProblem, type Occupancy } from "./cost";

export const ITERATIONS_PER_SQRT_N = 90;
export const COMPACTION_EVERY = 9;
export const GREEDY_ROUNDS = 10;

export interface PlacementFrame {
  level: string;
  iteration: number;
  totalIterations: number;
  temperature: number;
  cells: CellMap;
  cost: number;
  focus?: { item: string; target: { x: number; y: number } };
  note: string;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function neighborsOf(item: string, problem: LevelProblem): string[] {
  const out: string[] = [];
  for (const e of problem.edges) {
    if (e.from === item) out.push(e.to);
    else if (e.to === item) out.push(e.from);
  }
  return out;
}

function freeCellsInDiamond(cx: number, cy: number, radius: number, occ: Occupancy, self: string): Cell[] {
  const out: Cell[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    const rest = radius - Math.abs(dx);
    for (let dy = -rest; dy <= rest; dy++) {
      const hit = occ.get(cellKey(cx + dx, cy + dy));
      if (!hit || hit === self) out.push({ gx: cx + dx, gy: cy + dy });
    }
  }
  return out;
}

function distanceToNearestFree(cx: number, cy: number, occ: Occupancy, self: string): number {
  for (let r = 0; r < 100; r++) if (freeCellsInDiamond(cx, cy, r, occ, self).length > 0) return r;
  return 100;
}

const cloneCells = (cells: CellMap): CellMap => new Map([...cells].map(([id, c]) => [id, { ...c }]));

/** 删除某一轴上完全空的行或列 */
export function compact(cells: CellMap, axis: "x" | "y"): void {
  const key = axis === "x" ? "gx" : "gy";
  const used = [...new Set([...cells.values()].map((c) => c[key]))].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, used[0] + i]));
  for (const c of cells.values()) c[key] = remap.get(c[key])!;
}

/** 平移到从 (0,0) 开始，返回平移量（动画里的目标点要同步平移） */
export function normalize(cells: CellMap): { dx: number; dy: number } {
  const minX = Math.min(...[...cells.values()].map((c) => c.gx));
  const minY = Math.min(...[...cells.values()].map((c) => c.gy));
  for (const c of cells.values()) {
    c.gx -= minX;
    c.gy -= minY;
  }
  return { dx: -minX, dy: -minY };
}

/** BFS 序贪心初始化。对照 TALA：internal/placement/initialize.go */
function initialize(problem: LevelProblem): CellMap {
  const cells: CellMap = new Map();
  const degree = (id: string) => neighborsOf(id, problem).length;
  const order: string[] = [];
  const seen = new Set<string>();
  for (const start of [...problem.items].sort((a, b) => degree(b) - degree(a))) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const nb of neighborsOf(id, problem)) {
        if (!seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
  }

  for (const id of order) {
    const occ = buildOccupancy(cells);
    const placed = neighborsOf(id, problem).filter((nb) => cells.has(nb));
    let cx = 0;
    let cy = 0;
    if (placed.length > 0) {
      cx = Math.round(median(placed.map((nb) => cells.get(nb)!.gx)));
      cy = Math.round(median(placed.map((nb) => cells.get(nb)!.gy)));
    } else if (cells.size > 0) {
      cx = Math.max(...[...cells.values()].map((c) => c.gx)) + 2;
    }
    const d = distanceToNearestFree(cx, cy, occ, id);
    let best: Cell = { gx: cx, gy: cy };
    let bestCost = Infinity;
    for (const c of freeCellsInDiamond(cx, cy, d + 2, occ, id)) {
      const cost = itemCost(id, c, cells, occ, problem);
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    cells.set(id, best);
  }
  return cells;
}

/** 一轮优化。temp > 0 时总是移到候选里最好的格子；temp = 0 时只接受严格改进 */
function optimizeRound(cells: CellMap, problem: LevelProblem, temp: number, rng: Rng): PlacementFrame["focus"] {
  let focus: PlacementFrame["focus"];
  for (const id of rng.shuffle([...problem.items])) {
    const nbs = neighborsOf(id, problem).filter((nb) => cells.has(nb));
    const hasPull = problem.pulls.some((p) => p.item === id);
    if (nbs.length === 0 && !hasPull) continue;

    const current = cells.get(id)!;
    const baseX = nbs.length ? median(nbs.map((nb) => cells.get(nb)!.gx)) : current.gx;
    const baseY = nbs.length ? median(nbs.map((nb) => cells.get(nb)!.gy)) : current.gy;
    const tx = baseX + rng.jitter(temp);
    const ty = baseY + rng.jitter(temp);

    const occ = buildOccupancy(cells);
    const cx = Math.round(tx);
    const cy = Math.round(ty);
    const d = distanceToNearestFree(cx, cy, occ, id);
    const candidates = rng.shuffle(freeCellsInDiamond(cx, cy, d + 1, occ, id));
    // 牵引项需要和"留在原地"比较，否则节点永远看不到外侧更好的格子
    candidates.push(...freeCellsInDiamond(current.gx, current.gy, 1, occ, id));

    occ.delete(cellKey(current.gx, current.gy));
    const currentCost = itemCost(id, current, cells, occ, problem);
    let best = current;
    let bestCost = temp > 0 ? Infinity : currentCost;
    for (const c of candidates) {
      const cost = itemCost(id, c, cells, occ, problem);
      const isCurrent = c.gx === current.gx && c.gy === current.gy;
      if (cost < bestCost || (cost === bestCost && isCurrent)) {
        bestCost = cost;
        best = c;
      }
    }
    if (best.gx !== current.gx || best.gy !== current.gy) {
      cells.set(id, { gx: best.gx, gy: best.gy });
      focus = { item: id, target: { x: tx, y: ty } };
    }
  }
  return focus;
}

const shift = (f: PlacementFrame["focus"], d: { dx: number; dy: number }): PlacementFrame["focus"] =>
  f && { item: f.item, target: { x: f.target.x + d.dx, y: f.target.y + d.dy } };

/** 放置一层。返回最终网格坐标和每轮快照 */
export function placeLevel(problem: LevelProblem, rng: Rng): { cells: CellMap; frames: PlacementFrame[] } {
  const cells = initialize(problem);
  normalize(cells);
  const n = problem.items.length;
  const numIt = n <= 1 ? 0 : Math.round(ITERATIONS_PER_SQRT_N * Math.sqrt(n));
  const total = numIt + GREEDY_ROUNDS;
  const frames: PlacementFrame[] = [];
  const snap = (iteration: number, temperature: number, note: string, focus?: PlacementFrame["focus"]) =>
    frames.push({
      level: problem.level,
      iteration,
      totalIterations: total,
      temperature,
      cells: cloneCells(cells),
      cost: levelCost(cells, problem),
      focus,
      note,
    });
  snap(0, 0, "初始化：BFS 序贪心放置");
  if (numIt === 0) return { cells, frames };

  let temp = 2 * Math.sqrt(n);
  const cooling = Math.pow(0.2 / temp, 1 / numIt);
  let axis: "x" | "y" = "x";
  for (let i = 1; i <= numIt; i++) {
    const focus = optimizeRound(cells, problem, temp, rng);
    let note = `退火：温度 ${temp.toFixed(2)}`;
    if (i % COMPACTION_EVERY === 0) {
      compact(cells, axis);
      note += `，压缩 ${axis} 轴`;
      axis = axis === "x" ? "y" : "x";
    }
    snap(i, temp, note, shift(focus, normalize(cells)));
    temp *= cooling;
  }

  for (let r = 0; r < GREEDY_ROUNDS; r++) {
    const before = JSON.stringify([...cells]);
    const focus = optimizeRound(cells, problem, 0, rng);
    compact(cells, "x");
    compact(cells, "y");
    snap(numIt + r + 1, 0, "贪心收尾：只接受严格改进", shift(focus, normalize(cells)));
    if (JSON.stringify([...cells]) === before) break;
  }
  return { cells, frames };
}
