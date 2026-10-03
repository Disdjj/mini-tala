// 放置阶段的代价函数。
// 对照 TALA：internal/placementcost/edge_length.go（NodeEdgeLength）
//
// 只保留五项最核心的代价：
//   1. 距离：边两端的欧氏距离
//   2. 对角惩罚：两端不在同一行/列时，正交路由必须拐弯，加 TURN_COST
//   3. 遮挡惩罚：同行/列但中间夹着别的节点，直线走不通，加 2 × TURN_COST
//   4. 方向：逆着容器的 direction 走的边按偏离量加罚
//      （TALA：显式 direction 在 sizeless 阶段系数 1.5，默认偏向右下系数 0.3）
//   5. 外部牵引：子节点和容器外的节点相连时，希望自己站在网格外圈
//      （TALA 的 herd / near 简化版：task01..03 都连着容器外的 user，所以都该贴边）
//   6. 方位提示：外层的边连到已排好的容器内部时，按内部端点的方位拉向那一侧

import type { Cell, Direction } from "./types";

export const TURN_COST = 1.0;
export const EXPLICIT_DIRECTION_FACTOR = 1.5;
export const DEFAULT_DIRECTION_FACTOR = 0.3;
export const PULL_FACTOR = 1.0;

export type CellMap = Map<string, Cell>;
/** 网格占用表：`"gx,gy" -> itemId` */
export type Occupancy = Map<string, string>;

export const cellKey = (gx: number, gy: number): string => `${gx},${gy}`;

export interface LevelEdge {
  from: string;
  to: string;
  /**
   * 方位提示：to 是已经排好的容器、真实端点贴在它的某一侧时，
   * 希望 from 也站在那一侧（向量指向 from 应该在的方向）。fromHint 同理。
   * 这样外层节点就能"看见"容器内部的布局，避免连线绕到背面。
   */
  fromHint?: { x: number; y: number };
  toHint?: { x: number; y: number };
}

export const HINT_COST = 2 * TURN_COST;

/**
 * v 是从容器指向另一端的格子向量，hint 是真实端点在容器内的偏移方向。
 * 用余弦相似度：同向 0 分，垂直 HINT_COST，反向 2 × HINT_COST。
 */
function hintCost(v: { x: number; y: number }, hint?: { x: number; y: number }): number {
  if (!hint) return 0;
  const lv = Math.hypot(v.x, v.y);
  const lh = Math.hypot(hint.x, hint.y);
  if (lv === 0 || lh === 0) return 0;
  const cos = (v.x * hint.x + v.y * hint.y) / (lv * lh);
  return HINT_COST * (1 - cos);
}

/**
 * 外部牵引：item 和容器外面的节点相连，希望站在本层网格的外圈（任意一侧）。
 * 外面那个节点在哪一侧，要等上一层放置时才知道；上一层会读取方位提示，自动跟过来。
 */
export interface Pull {
  item: string;
}

/** 一层（一个容器内部）的放置问题 */
export interface LevelProblem {
  level: string;
  items: string[];
  edges: LevelEdge[];
  pulls: Pull[];
  direction?: Direction;
  /** 物件的格子跨度（尺寸大的物件比如容器，在网格上看起来离邻居更远） */
  span?: Map<string, { w: number; h: number }>;
}

export function buildOccupancy(cells: CellMap): Occupancy {
  const occ: Occupancy = new Map();
  for (const [id, c] of cells) occ.set(cellKey(c.gx, c.gy), id);
  return occ;
}

function isBlocked(a: Cell, b: Cell, occ: Occupancy, self: string, other: string): boolean {
  const between = (k: string) => {
    const hit = occ.get(k);
    return hit !== undefined && hit !== self && hit !== other;
  };
  if (a.gx === b.gx) {
    for (let y = Math.min(a.gy, b.gy) + 1; y < Math.max(a.gy, b.gy); y++) if (between(cellKey(a.gx, y))) return true;
  } else if (a.gy === b.gy) {
    for (let x = Math.min(a.gx, b.gx) + 1; x < Math.max(a.gx, b.gx); x++) if (between(cellKey(x, a.gy))) return true;
  }
  return false;
}

/**
 * 方向罚：边 from(a) -> to(b) 和期望方向差了多少。
 * 显式 direction：逆向按格数罚，侧向（垂直于主方向）按一半罚——TALA 的 dirDelta 也同时惩罚这两种。
 * 默认：只轻微惩罚向上 / 向左。
 */
function backwards(dx: number, dy: number, direction?: Direction): number {
  const along = direction === "right" ? dx : direction === "left" ? -dx : direction === "down" ? dy : direction === "up" ? -dy : 0;
  const across = direction === "right" || direction === "left" ? Math.abs(dy) : Math.abs(dx);
  if (direction) return EXPLICIT_DIRECTION_FACTOR * (Math.max(0, -along) + 0.5 * across * (along > 0 ? 0 : 1));
  return DEFAULT_DIRECTION_FACTOR * (Math.max(0, -dx) + Math.max(0, -dy));
}

export function edgeCost(
  a: Cell,
  b: Cell,
  occ: Occupancy,
  e: LevelEdge,
  direction?: Direction,
): number {
  const dx = b.gx - a.gx;
  const dy = b.gy - a.gy;
  // 曼哈顿距离：正交路由的走线长度就是 |dx| + |dy|，对角放置天然更贵
  let cost = Math.abs(dx) + Math.abs(dy);
  if (dx !== 0 && dy !== 0) cost += TURN_COST;
  else if (isBlocked(a, b, occ, e.from, e.to)) cost += 2 * TURN_COST;
  cost += hintCost({ x: dx, y: dy }, e.fromHint) + hintCost({ x: -dx, y: -dy }, e.toHint);
  // 带方位提示的边由提示决定朝向，不再套用 direction 罚
  return cost + (e.fromHint || e.toHint ? 0 : backwards(dx, dy, direction));
}

/** 牵引代价：item 离本层网格外圈有几格（在外圈上为 0） */
export function pullCost(item: string, at: Cell, cells: CellMap, pulls: Pull[]): number {
  if (!pulls.some((p) => p.item === item)) return 0;
  let minX = at.gx;
  let maxX = at.gx;
  let minY = at.gy;
  let maxY = at.gy;
  for (const [id, c] of cells) {
    if (id === item) continue;
    minX = Math.min(minX, c.gx);
    maxX = Math.max(maxX, c.gx);
    minY = Math.min(minY, c.gy);
    maxY = Math.max(maxY, c.gy);
  }
  return PULL_FACTOR * Math.min(at.gx - minX, maxX - at.gx, at.gy - minY, maxY - at.gy);
}

/** 把 item 假设放在 at 处时的局部代价：所有入射边 + 自己的牵引 */
export function itemCost(item: string, at: Cell, cells: CellMap, occ: Occupancy, problem: LevelProblem): number {
  let sum = 0;
  for (const e of problem.edges) {
    if (e.from === item) {
      const other = cells.get(e.to);
      if (other) sum += edgeCost(at, other, occ, e, problem.direction);
    } else if (e.to === item) {
      const other = cells.get(e.from);
      if (other) sum += edgeCost(other, at, occ, e, problem.direction);
    }
  }
  return sum + pullCost(item, at, cells, problem.pulls);
}

/** 整层的放置代价，用于动画面板的收敛曲线 */
export function levelCost(cells: CellMap, problem: LevelProblem): number {
  const occ = buildOccupancy(cells);
  let sum = 0;
  for (const e of problem.edges) {
    const a = cells.get(e.from);
    const b = cells.get(e.to);
    if (a && b) sum += edgeCost(a, b, occ, e, problem.direction);
  }
  for (const id of problem.items) {
    const c = cells.get(id);
    if (c) sum += pullCost(id, c, cells, problem.pulls);
  }
  return sum;
}
