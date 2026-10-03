// 完整流水线 + 多 seed 竞速。
// 对照 TALA：internal/engine/pipeline.go（阶段顺序）
//         internal/quality/scoring.go:35-75（penalty）
//         d2talalayout/layout.go:211（先比 penalty，再比面积；平局取后面的 seed）
//
// 一个 seed 的流水线：
//   ① 结构识别：容器层级 + 簇            （hierarchy.ts / clusters.ts）
//   ② 逐层放置：自底向上，每层网格搜索    （nested.ts / placement.ts）
//      + 轴对齐：相连节点拉到同一中心线   （align.ts）
//   ③ 正交路由：OVG + Dijkstra，3 种顺序  （ovg.ts / router.ts）
//      + 簇分叉：一对多的边共用主干再分叉 （fork.ts）
//   ④ 标签放置：候选位置打分              （labels.ts）
//   ⑤ 评分：penalty = 0.5×拐点 + 3×斜线 + 交叉数 + (1 − labelScore)

import type { GraphSpec, PlacedLabel, Point, Rect, RoutedEdge } from "./types";
import { createRng } from "./random";
import { layoutTree, type LayoutTree } from "./nested";
import { routeAll, type RoutingResult } from "./router";
import { placeLabels } from "./labels";
import { alignAxes, type AlignMove } from "./align";
import { forkClusterEdges, type ForkResult } from "./fork";

export const DEFAULT_SEEDS = [1, 2, 3];
/** 画布四周留白，给容器外侧的标签和走线 */
export const CANVAS_PAD = 80;

function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const aH = a1.y === a2.y;
  const bH = b1.y === b2.y;
  if (aH === bH) return false;
  const [h1, h2, v1, v2] = aH ? [a1, a2, b1, b2] : [b1, b2, a1, a2];
  return (
    v1.x > Math.min(h1.x, h2.x) && v1.x < Math.max(h1.x, h2.x) && h1.y > Math.min(v1.y, v2.y) && h1.y < Math.max(v1.y, v2.y)
  );
}

export function countCrossings(routes: RoutedEdge[]): number {
  let n = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i].points;
      const b = routes[j].points;
      for (let p = 0; p + 1 < a.length; p++) {
        for (let q = 0; q + 1 < b.length; q++) if (segmentsCross(a[p], a[p + 1], b[q], b[q + 1])) n++;
      }
    }
  }
  return n;
}

export function penalty(routes: RoutedEdge[], labels: PlacedLabel[] = []): number {
  let score = 0;
  for (const r of routes) {
    score += 0.5 * Math.max(0, r.points.length - 2);
    for (let i = 0; i + 1 < r.points.length; i++) {
      if (r.points[i].x !== r.points[i + 1].x && r.points[i].y !== r.points[i + 1].y) score += 3;
    }
  }
  const labelTotal = labels.reduce((s, l) => s + l.score, 0);
  return score + countCrossings(routes) + (1 - 1 / (1 + labelTotal));
}

export interface SeedRun {
  seed: number;
  tree: LayoutTree;
  /** 网格放置刚结束、轴对齐之前的矩形（动画用） */
  placedRects: Map<string, Rect>;
  aligned: AlignMove[];
  rects: Map<string, Rect>;
  forks: ForkResult[];
  routing: RoutingResult;
  routes: RoutedEdge[];
  labels: PlacedLabel[];
  labelTrials: ReturnType<typeof placeLabels>["tried"];
  penalty: number;
  area: number;
  width: number;
  height: number;
}

export function runSeed(graph: GraphSpec, seed: number): SeedRun {
  const tree = layoutTree(graph, createRng(seed));

  // 整体平移，给四周留白
  const rects = new Map<string, Rect>();
  for (const [id, r] of tree.rects) rects.set(id, { ...r, x: r.x + CANVAS_PAD, y: r.y + CANVAS_PAD });
  const width = tree.width + 2 * CANVAS_PAD;
  const height = tree.height + 2 * CANVAS_PAD;

  const placedRects = new Map([...rects].map(([id, r]) => [id, { ...r }]));
  const locked = new Set(tree.clusters.flatMap((c) => c.members));
  const aligned = alignAxes(tree.hierarchy, rects, graph.edges, locked);

  const leaves = new Set(graph.nodes.filter((n) => !tree.hierarchy.isContainer(n.id)).map((n) => n.id));
  const routing = routeAll(graph.edges, rects, leaves, { x: 10, y: 10, w: width - 20, h: height - 20 });
  const routes = routing.best.searches
    .filter((s) => s.ok)
    .map((s) => ({ ...s.route, points: [...s.route.points] }))
    .sort((a, b) => a.edgeIndex - b.edgeIndex);
  const obstacles = new Map([...leaves].map((id) => [id, rects.get(id)!]));
  const forks = forkClusterEdges(tree.hierarchy, tree.clusters, rects, routes, obstacles);

  const inputs = routes
    .filter((r) => graph.edges[r.edgeIndex].label)
    .map((r) => ({
      edgeIndex: r.edgeIndex,
      text: graph.edges[r.edgeIndex].label!,
      route: r,
      forked: forks.some((f) => f.edgeIndices.includes(r.edgeIndex)),
    }));
  const containers = graph.nodes.filter((n) => tree.hierarchy.isContainer(n.id)).map((n) => rects.get(n.id)!);
  const { placed, tried } = placeLabels(inputs, [...leaves].map((id) => rects.get(id)!), routes, containers);

  return {
    seed,
    tree,
    placedRects,
    aligned,
    rects,
    forks,
    routing,
    routes,
    labels: placed,
    labelTrials: tried,
    penalty: penalty(routes, placed),
    area: width * height,
    width,
    height,
  };
}

export function layout(graph: GraphSpec, seeds: number[] = DEFAULT_SEEDS): { runs: SeedRun[]; best: SeedRun } {
  const runs = seeds.map((s) => runSeed(graph, s));
  let best = runs[0];
  for (const r of runs.slice(1)) {
    if (r.penalty < best.penalty || (r.penalty === best.penalty && r.area <= best.area)) best = r;
  }
  return { runs, best };
}
