// 评分 + 多 seed 竞速。
// 对照 TALA：internal/quality/scoring.go:35-75（penalty）
//         d2talalayout/layout.go:211（先比 penalty，再比面积；平局取后面的 seed）
//
// penalty = Σ边 (0.5 × 拐点数 + 3 × 斜线段数) + 非共享交叉数
// TALA 还有一项 (1 - labelScore)，极简版没有标签放置，所以省略。

import type { GraphSpec, LayoutResult, Point, RoutedEdge } from "./types";
import { place, type PlacementFrame } from "./placement";
import { nodeRects, MARGIN, CELL_W, CELL_H } from "./geometry";
import { routeAll, type RoutingResult } from "./router";

export const DEFAULT_SEEDS = [1, 2, 3];

/** 两条正交线段是否在内部相交（一横一竖，交点不在端点上） */
function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const aH = a1.y === a2.y;
  const bH = b1.y === b2.y;
  if (aH === bH) return false; // 平行或共线不算交叉（TALA 也只数非平行的交叉）
  const [h1, h2, v1, v2] = aH ? [a1, a2, b1, b2] : [b1, b2, a1, a2];
  const x = v1.x;
  const y = h1.y;
  const hx0 = Math.min(h1.x, h2.x);
  const hx1 = Math.max(h1.x, h2.x);
  const vy0 = Math.min(v1.y, v2.y);
  const vy1 = Math.max(v1.y, v2.y);
  return x > hx0 && x < hx1 && y > vy0 && y < vy1;
}

export function countCrossings(routes: RoutedEdge[]): number {
  let n = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i].points;
      const b = routes[j].points;
      for (let p = 0; p + 1 < a.length; p++) {
        for (let q = 0; q + 1 < b.length; q++) {
          if (segmentsCross(a[p], a[p + 1], b[q], b[q + 1])) n++;
        }
      }
    }
  }
  return n;
}

export function penalty(routes: RoutedEdge[]): number {
  let score = 0;
  for (const r of routes) {
    score += 0.5 * Math.max(0, r.points.length - 2);
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      if (a.x !== b.x && a.y !== b.y) score += 3;
    }
  }
  return score + countCrossings(routes);
}

export interface SeedRun {
  result: LayoutResult;
  frames: PlacementFrame[];
  routing: RoutingResult;
}

/** 跑一个 seed 的完整流水线：放置 → 换算像素 → 路由 → 评分 */
export function runSeed(graph: GraphSpec, seed: number): SeedRun {
  const { cells, frames } = place(graph, seed);
  const rects = nodeRects(graph, cells);
  const cols = Math.max(0, ...[...cells.values()].map((c) => c.gx)) + 1;
  const rows = Math.max(0, ...[...cells.values()].map((c) => c.gy)) + 1;
  const routing = routeAll(graph.edges, rects, cols, rows);
  const routes = routing.best.searches.filter((s) => s.ok).map((s) => s.route);
  const area = (2 * MARGIN + cols * CELL_W) * (2 * MARGIN + rows * CELL_H);
  return {
    result: { seed, cells, rects, routes, penalty: penalty(routes), area },
    frames,
    routing,
  };
}

/** 多 seed 竞速：先比 penalty，再比面积；完全相同时取后面的 seed */
export function layout(graph: GraphSpec, seeds: number[] = DEFAULT_SEEDS): { runs: SeedRun[]; best: SeedRun } {
  const runs = seeds.map((s) => runSeed(graph, s));
  let best = runs[0];
  for (const r of runs.slice(1)) {
    const a = r.result;
    const b = best.result;
    if (a.penalty < b.penalty || (a.penalty === b.penalty && a.area <= b.area)) best = r;
  }
  return { runs, best };
}
