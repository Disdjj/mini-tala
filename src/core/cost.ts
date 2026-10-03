// 放置阶段的代价函数（极简版）。
// 对照 TALA：internal/placementcost/edge_length.go（NodeEdgeLength）
//
// TALA 真实的代价有十几项（簇排列、near、herd、对称奖励……），这里只保留四项最核心的：
//   1. 距离：边两端的欧氏距离
//   2. 对角惩罚：两端不在同一行/列时，正交路由必须拐弯，加一个 TURN_COST
//   3. 遮挡惩罚：同行/列但中间夹着别的节点，直线走不通，加 2 × TURN_COST
//   4. 方向偏好：默认偏向「向下 / 向右」，逆向的边按偏离量加罚（TALA 默认系数 0.3）

import type { Cell, EdgeSpec } from "./types";

export const TURN_COST = 1.0;
export const DIRECTION_FACTOR = 0.3;

export type CellMap = Map<string, Cell>;

/** 网格占用表：`"gx,gy" -> nodeId`，用于 O(1) 判断格子是否为空 */
export type Occupancy = Map<string, string>;

export const cellKey = (gx: number, gy: number): string => `${gx},${gy}`;

export function buildOccupancy(cells: CellMap): Occupancy {
  const occ: Occupancy = new Map();
  for (const [id, c] of cells) occ.set(cellKey(c.gx, c.gy), id);
  return occ;
}

/** 同一行或同一列的两个格子之间，是否夹着其他节点 */
function isBlocked(a: Cell, b: Cell, occ: Occupancy, self: string, other: string): boolean {
  if (a.gx === b.gx) {
    const [lo, hi] = a.gy < b.gy ? [a.gy, b.gy] : [b.gy, a.gy];
    for (let y = lo + 1; y < hi; y++) {
      const hit = occ.get(cellKey(a.gx, y));
      if (hit && hit !== self && hit !== other) return true;
    }
  } else if (a.gy === b.gy) {
    const [lo, hi] = a.gx < b.gx ? [a.gx, b.gx] : [b.gx, a.gx];
    for (let x = lo + 1; x < hi; x++) {
      const hit = occ.get(cellKey(x, a.gy));
      if (hit && hit !== self && hit !== other) return true;
    }
  }
  return false;
}

/** 一条边的代价。from 在 a，to 在 b */
export function edgeCost(a: Cell, b: Cell, occ: Occupancy, fromId: string, toId: string): number {
  const dx = b.gx - a.gx;
  const dy = b.gy - a.gy;
  let cost = Math.hypot(dx, dy);

  if (dx !== 0 && dy !== 0) {
    cost += TURN_COST;
  } else if (isBlocked(a, b, occ, fromId, toId)) {
    cost += 2 * TURN_COST;
  }

  // 方向偏好：期望 to 在 from 的右下方，往左或往上走都算逆向
  const backwards = Math.max(0, -dx) + Math.max(0, -dy);
  cost += DIRECTION_FACTOR * backwards;

  return cost;
}

/**
 * 把节点 nodeId 假设放在 at 处时，它所有入射边的代价之和。
 * 优化器用它比较候选格子。
 */
export function nodeCost(
  nodeId: string,
  at: Cell,
  cells: CellMap,
  occ: Occupancy,
  incident: EdgeSpec[],
): number {
  let sum = 0;
  for (const e of incident) {
    if (e.from === e.to) continue;
    if (e.from === nodeId) {
      const other = cells.get(e.to);
      if (other) sum += edgeCost(at, other, occ, nodeId, e.to);
    } else {
      const other = cells.get(e.from);
      if (other) sum += edgeCost(other, at, occ, e.from, nodeId);
    }
  }
  return sum;
}

/** 全图放置代价，供动画面板显示收敛曲线 */
export function totalCost(cells: CellMap, edges: EdgeSpec[]): number {
  const occ = buildOccupancy(cells);
  let sum = 0;
  for (const e of edges) {
    const a = cells.get(e.from);
    const b = cells.get(e.to);
    if (a && b && e.from !== e.to) sum += edgeCost(a, b, occ, e.from, e.to);
  }
  return sum;
}
