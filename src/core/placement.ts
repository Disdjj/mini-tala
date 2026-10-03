// 节点放置：网格上的温度抖动局部搜索。
// 对照 TALA：internal/placement/node_placement.go:245（placeNodesOrthogonally）
//         internal/placement/sizeless_optimizer.go
// TALA 源码注释："heavily based on ... Graph Compact Orthogonal Layout by Freivalds and Glagolevs"
//
// 算法：
//   初始化：BFS 序贪心，每个节点放到已放邻居中位数附近最便宜的空格。
//   迭代 numIt = 90·√N 轮，温度 temp 从 2·√N 几何衰减到 0.2：
//     1. 打乱节点顺序
//     2. 目标点 = 邻居坐标中位数 + U(-temp, temp) 抖动
//     3. 在目标点附近的曼哈顿菱形内找空格，移到代价最低的那个
//        （注意：即使比当前位置差也会移，这是它跳出局部最优的方式）
//     4. 每 9 轮压缩一次：删掉空行/空列，让图更紧凑
//   最后 temp = 0 做几轮纯贪心（必须严格变好才接受），直到收敛。

import type { Cell, EdgeSpec, GraphSpec } from "./types";
import { createRng, type Rng } from "./random";
import { buildOccupancy, cellKey, nodeCost, totalCost, type CellMap, type Occupancy } from "./cost";

export const ITERATIONS_PER_SQRT_N = 90;
export const COMPACTION_EVERY = 9;
export const GREEDY_ROUNDS = 10;

/** 动画用的一帧：某一轮结束时的完整状态 */
export interface PlacementFrame {
  iteration: number;
  temperature: number;
  cells: CellMap;
  cost: number;
  /** 本轮最后一个移动的节点及其抖动后的目标点，用于可视化"往哪里跳" */
  focus?: { nodeId: string; target: { x: number; y: number } };
  note: string;
}

export interface PlacementResult {
  cells: CellMap;
  frames: PlacementFrame[];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function buildIncidence(graph: GraphSpec): Map<string, EdgeSpec[]> {
  const inc = new Map<string, EdgeSpec[]>();
  for (const n of graph.nodes) inc.set(n.id, []);
  for (const e of graph.edges) {
    inc.get(e.from)?.push(e);
    if (e.to !== e.from) inc.get(e.to)?.push(e);
  }
  return inc;
}

function neighbors(nodeId: string, incident: EdgeSpec[]): string[] {
  const out: string[] = [];
  for (const e of incident) {
    if (e.from === e.to) continue;
    out.push(e.from === nodeId ? e.to : e.from);
  }
  return out;
}

/** 曼哈顿距离 ≤ radius 的菱形内的所有空格（含 self 当前位置，视为可用） */
function freeCellsInDiamond(cx: number, cy: number, radius: number, occ: Occupancy, self: string): Cell[] {
  const out: Cell[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    const rest = radius - Math.abs(dx);
    for (let dy = -rest; dy <= rest; dy++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const hit = occ.get(cellKey(gx, gy));
      if (!hit || hit === self) out.push({ gx, gy });
    }
  }
  return out;
}

/** 从 (cx, cy) 向外一圈圈找，返回最近空格的曼哈顿距离 */
function distanceToNearestFree(cx: number, cy: number, occ: Occupancy, self: string): number {
  for (let r = 0; r < 100; r++) {
    if (freeCellsInDiamond(cx, cy, r, occ, self).length > 0) return r;
  }
  return 100;
}

function cloneCells(cells: CellMap): CellMap {
  const out: CellMap = new Map();
  for (const [id, c] of cells) out.set(id, { gx: c.gx, gy: c.gy });
  return out;
}

/**
 * 初始化：BFS 序逐个放置。第一个节点放在原点；之后每个节点
 * 放到「已放邻居中位数」附近、代价最低的空格上。
 * 对照 TALA：internal/placement/initialize.go
 */
export function initialize(graph: GraphSpec, inc: Map<string, EdgeSpec[]>): CellMap {
  const cells: CellMap = new Map();
  const order: string[] = [];
  const seen = new Set<string>();

  // 按度数从高到低选 BFS 起点，覆盖所有连通分量
  const byDegree = [...graph.nodes].sort(
    (a, b) => (inc.get(b.id)?.length ?? 0) - (inc.get(a.id)?.length ?? 0),
  );
  for (const start of byDegree) {
    if (seen.has(start.id)) continue;
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const nb of neighbors(id, inc.get(id) ?? [])) {
        if (!seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
  }

  for (const id of order) {
    const occ = buildOccupancy(cells);
    const placed = neighbors(id, inc.get(id) ?? []).filter((nb) => cells.has(nb));
    let cx = 0;
    let cy = 0;
    if (placed.length > 0) {
      cx = Math.round(median(placed.map((nb) => cells.get(nb)!.gx)));
      cy = Math.round(median(placed.map((nb) => cells.get(nb)!.gy)));
    } else if (cells.size > 0) {
      // 新连通分量：放到已有内容的右侧，避免和前面的分量挤在一起
      cx = Math.max(...[...cells.values()].map((c) => c.gx)) + 2;
    }
    const d = distanceToNearestFree(cx, cy, occ, id);
    let best: Cell = { gx: cx, gy: cy };
    let bestCost = Infinity;
    for (const c of freeCellsInDiamond(cx, cy, d + 2, occ, id)) {
      const cost = nodeCost(id, c, cells, occ, inc.get(id) ?? []);
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    cells.set(id, best);
  }
  return cells;
}

/**
 * 压缩：删掉某一轴上的空行（或空列），让节点向一起靠拢。
 * TALA 的 compaction 会按 factor 缩放坐标；极简版只删除完全空的行列。
 */
export function compact(cells: CellMap, axis: "x" | "y"): void {
  const key = axis === "x" ? "gx" : "gy";
  const used = [...new Set([...cells.values()].map((c) => c[key]))].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  used.forEach((v, i) => remap.set(v, used[0] + i));
  for (const c of cells.values()) c[key] = remap.get(c[key])!;
}

/** 把坐标平移到从 (0,0) 开始，返回平移量 */
export function normalize(cells: CellMap): { dx: number; dy: number } {
  const minX = Math.min(...[...cells.values()].map((c) => c.gx));
  const minY = Math.min(...[...cells.values()].map((c) => c.gy));
  for (const c of cells.values()) {
    c.gx -= minX;
    c.gy -= minY;
  }
  return { dx: -minX, dy: -minY };
}

/** 平移/压缩之后，把记录下的抖动目标点映射到同一坐标系，保证动画里十字与网格对齐 */
function shiftFocus(focus: PlacementFrame["focus"], d: { dx: number; dy: number }): PlacementFrame["focus"] {
  return focus && { nodeId: focus.nodeId, target: { x: focus.target.x + d.dx, y: focus.target.y + d.dy } };
}

/**
 * 一轮优化：每个节点按随机顺序尝试移动一次。
 * temp > 0 时总是移到候选中最好的格子（可能比当前差）；
 * temp = 0 时只接受严格改进（纯贪心收尾）。
 * 返回本轮是否有节点移动，以及最后一个移动节点的目标点（给动画用）。
 */
function optimizeRound(
  graph: GraphSpec,
  cells: CellMap,
  inc: Map<string, EdgeSpec[]>,
  temp: number,
  rng: Rng,
): { moved: boolean; focus?: PlacementFrame["focus"] } {
  const order = rng.shuffle(graph.nodes.map((n) => n.id));
  let moved = false;
  let focus: PlacementFrame["focus"];

  for (const id of order) {
    const edges = inc.get(id) ?? [];
    const nbs = neighbors(id, edges);
    if (nbs.length === 0) continue;

    const occ = buildOccupancy(cells);
    const current = cells.get(id)!;
    const tx = median(nbs.map((nb) => cells.get(nb)!.gx)) + rng.jitter(temp);
    const ty = median(nbs.map((nb) => cells.get(nb)!.gy)) + rng.jitter(temp);
    const cx = Math.round(tx);
    const cy = Math.round(ty);

    const d = distanceToNearestFree(cx, cy, occ, id);
    const candidates = rng.shuffle(freeCellsInDiamond(cx, cy, d + 1, occ, id));

    // 先把自己从占用表移走，避免"自己挡自己"的遮挡判定
    occ.delete(cellKey(current.gx, current.gy));
    const currentCost = nodeCost(id, current, cells, occ, edges);
    let best = current;
    let bestCost = temp > 0 ? Infinity : currentCost;
    for (const c of candidates) {
      const cost = nodeCost(id, c, cells, occ, edges);
      // 平局偏向当前位置，减少无意义抖动
      const isCurrent = c.gx === current.gx && c.gy === current.gy;
      if (cost < bestCost || (cost === bestCost && isCurrent)) {
        bestCost = cost;
        best = c;
      }
    }
    if (best.gx !== current.gx || best.gy !== current.gy) {
      cells.set(id, { gx: best.gx, gy: best.gy });
      moved = true;
      focus = { nodeId: id, target: { x: tx, y: ty } };
    }
  }
  return { moved, focus };
}

/**
 * 节点放置主入口。
 * 返回最终网格坐标，以及每轮的快照（frames），供浏览器动画回放。
 */
export function place(graph: GraphSpec, seed: number): PlacementResult {
  const rng = createRng(seed);
  const inc = buildIncidence(graph);
  const cells = initialize(graph, inc);
  normalize(cells);

  const frames: PlacementFrame[] = [];
  const snap = (iteration: number, temperature: number, note: string, focus?: PlacementFrame["focus"]) =>
    frames.push({
      iteration,
      temperature,
      cells: cloneCells(cells),
      cost: totalCost(cells, graph.edges),
      focus,
      note,
    });
  snap(0, 0, "初始化：BFS 序贪心放置");

  const n = graph.nodes.length;
  const numIt = Math.max(1, Math.round(ITERATIONS_PER_SQRT_N * Math.sqrt(n)));
  let temp = 2 * Math.sqrt(n);
  const cooling = Math.pow(0.2 / temp, 1 / numIt);
  let axis: "x" | "y" = "x";

  for (let i = 1; i <= numIt; i++) {
    const { focus } = optimizeRound(graph, cells, inc, temp, rng);
    let note = `退火迭代：温度 ${temp.toFixed(2)}`;
    if (i % COMPACTION_EVERY === 0) {
      compact(cells, axis);
      note += `，压缩 ${axis} 轴`;
      axis = axis === "x" ? "y" : "x";
    }
    snap(i, temp, note, shiftFocus(focus, normalize(cells)));
    temp *= cooling;
  }

  for (let r = 0; r < GREEDY_ROUNDS; r++) {
    const { moved, focus } = optimizeRound(graph, cells, inc, 0, rng);
    compact(cells, "x");
    compact(cells, "y");
    snap(numIt + r + 1, 0, "贪心收尾：只接受严格改进", shiftFocus(focus, normalize(cells)));
    if (!moved) break;
  }

  return { cells, frames };
}
