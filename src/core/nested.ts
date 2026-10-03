// 递归容器布局：自底向上，一层一层放置，再把格子换算成像素。
// 对照 TALA：internal/placement/node_placement.go（placeNodes 递归 + FitToGraph）
//
// 流程：
//   for 容器 in 自底向上顺序（最深的先）:
//     1. 这一层的"物件" = 直接子节点；找簇，把簇成员替换成一个 vessel
//     2. 边上提到这一层（edge abduction），外部边变成牵引（pull）
//     3. placeLevel：网格上的温度抖动局部搜索
//     4. 格子 → 像素：每列宽度 = 该列最宽物件 + 间距，每行同理（不同尺寸的节点也能排齐）
//     5. 容器尺寸 = 子内容外包框 + padding；它在上一层就是一个这么大的盒子
//   最后自顶向下把相对坐标累加成绝对坐标。

import type { Direction, GraphSpec, Rect } from "./types";
import type { Rng } from "./random";
import { buildHierarchy, externalEdges, liftTo, ROOT, type Hierarchy } from "./hierarchy";
import { findClusters, CLUSTER_GAP, type Cluster } from "./clusters";
import { placeLevel, type PlacementFrame } from "./placement";
import type { CellMap, LevelEdge, LevelProblem, Pull } from "./cost";

/**
 * 同一层相邻两列 / 两行之间留给连线和标签的空隙。
 * TALA 也会按边标签尺寸撑开间距（CL 0.3.8 "Spacing between nodes ensures that labels will fit"）。
 */
export const GAP_X = 260;
export const GAP_Y = 110;
/** 容器内边距；顶部额外留出标题（含图标）的高度 */
export const PAD = 50;
export const TITLE_H = 70;

export interface LevelLayout {
  level: string;
  problem: LevelProblem;
  cells: CellMap;
  frames: PlacementFrame[];
  /** 物件相对本容器内容区左上角的矩形 */
  local: Map<string, Rect>;
  /** 内容区尺寸（不含 padding） */
  contentW: number;
  contentH: number;
  clusters: Cluster[];
}

export interface LayoutTree {
  hierarchy: Hierarchy;
  levels: LevelLayout[];
  /** 所有真实节点（含容器）的绝对矩形 */
  rects: Map<string, Rect>;
  clusters: Cluster[];
  width: number;
  height: number;
}

const isHorizontal = (d?: Direction) => d === "right" || d === "left" || d === undefined;

/** 容器没写 direction 时沿祖先链继承，最后落到图的全局 direction（D2 的规则） */
function directionOf(h: Hierarchy, graph: GraphSpec, level: string): Direction | undefined {
  let cur = level;
  while (cur !== ROOT) {
    const d = h.nodes.get(cur)?.direction;
    if (d) return d;
    cur = h.parentOf(cur);
  }
  return graph.direction;
}

/** 本层哪些物件连着容器外面的节点 */
function pullsFor(h: Hierarchy, graph: GraphSpec, level: string, itemOf: (id: string) => string | undefined): Pull[] {
  const items = new Set<string>();
  for (const e of externalEdges(h, graph.edges, level)) {
    const insideEnd = h.ancestors(e.from).includes(level) ? e.from : e.to;
    const item = itemOf(insideEnd);
    if (item) items.add(item);
  }
  return [...items].map((item) => ({ item }));
}

function sizeOf(h: Hierarchy, id: string, containerSize: Map<string, { w: number; h: number }>): { w: number; h: number } {
  const own = containerSize.get(id);
  if (own) return own;
  const n = h.nodes.get(id)!;
  return { w: n.width ?? 160, h: n.height ?? 80 };
}

/** 网格 → 像素：每列、每行按其中最大的物件定宽高 */
export function gridToLocal(cells: CellMap, sizes: Map<string, { w: number; h: number }>) {
  const colW = new Map<number, number>();
  const rowH = new Map<number, number>();
  for (const [id, c] of cells) {
    const s = sizes.get(id)!;
    colW.set(c.gx, Math.max(colW.get(c.gx) ?? 0, s.w));
    rowH.set(c.gy, Math.max(rowH.get(c.gy) ?? 0, s.h));
  }
  const cols = [...colW.keys()].sort((a, b) => a - b);
  const rows = [...rowH.keys()].sort((a, b) => a - b);
  const colX = new Map<number, number>();
  const rowY = new Map<number, number>();
  let x = 0;
  for (const c of cols) {
    colX.set(c, x);
    x += colW.get(c)! + GAP_X;
  }
  let y = 0;
  for (const r of rows) {
    rowY.set(r, y);
    y += rowH.get(r)! + GAP_Y;
  }
  const local = new Map<string, Rect>();
  for (const [id, c] of cells) {
    const s = sizes.get(id)!;
    // 在格子里居中，同一行/列的物件中心线对齐
    // 同一行/列的物件共享中心线；坐标取整，保证端口和可见性图的点精确重合
    local.set(id, {
      x: Math.round(colX.get(c.gx)! + colW.get(c.gx)! / 2 - s.w / 2),
      y: Math.round(rowY.get(c.gy)! + rowH.get(c.gy)! / 2 - s.h / 2),
      w: s.w,
      h: s.h,
    });
  }
  return { local, contentW: Math.max(0, x - GAP_X), contentH: Math.max(0, y - GAP_Y) };
}

/**
 * 方位提示：container 已经排好，真实端点 inner 在它内部的哪一侧？
 * 取 inner 中心相对容器内容区中心的偏移（按内容区宽高归一化）。
 * 偏离中心不明显（在中间 1/3）时不给提示。
 */
function sideHint(h: Hierarchy, levels: LevelLayout[], container: string, inner: string): { x: number; y: number } | undefined {
  if (container === inner || !h.isContainer(container)) return undefined;
  const lv = levels.find((l) => l.level === container);
  if (!lv) return undefined;
  const item = liftTo(h, inner, container);
  const cluster = lv.clusters.find((c) => item && c.members.includes(item));
  const r = lv.local.get(cluster ? cluster.id : item ?? "");
  if (!r || lv.contentW === 0 || lv.contentH === 0) return undefined;
  const nx = (r.x + r.w / 2 - lv.contentW / 2) / lv.contentW;
  const ny = (r.y + r.h / 2 - lv.contentH / 2) / lv.contentH;
  if (Math.max(Math.abs(nx), Math.abs(ny)) < 1 / 6) return undefined;
  return { x: nx, y: ny };
}

/** 自底向上放置所有容器，再自顶向下算出绝对坐标 */
export function layoutTree(graph: GraphSpec, rng: Rng): LayoutTree {
  const h = buildHierarchy(graph);
  const containerSize = new Map<string, { w: number; h: number }>();
  const levels: LevelLayout[] = [];
  const allClusters: Cluster[] = [];

  for (const level of h.bottomUp) {
    const direction = directionOf(h, graph, level);
    const children = h.children.get(level) ?? [];

    // 1. 找簇：成员 -> vessel
    const clusters = findClusters(h, level, graph.edges, isHorizontal(direction));
    allClusters.push(...clusters);
    const vesselOf = new Map<string, string>();
    for (const c of clusters) for (const m of c.members) vesselOf.set(m, c.id);
    const items = [...new Set(children.map((id) => vesselOf.get(id) ?? id))];

    // 2. 边上提到这一层，再把簇成员映射到 vessel
    const toItem = (id: string) => vesselOf.get(id) ?? id;
    const seen = new Set<string>();
    const edges: LevelEdge[] = [];
    for (const orig of graph.edges) {
      const liftedFrom = liftTo(h, orig.from, level);
      const liftedTo = liftTo(h, orig.to, level);
      if (!liftedFrom || !liftedTo || liftedFrom === liftedTo) continue;
      const from = toItem(liftedFrom);
      const to = toItem(liftedTo);
      const key = `${from}->${to}:${orig.from}->${orig.to}`;
      if (from === to || seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from,
        to,
        fromHint: sideHint(h, levels, liftedFrom, orig.from),
        toHint: sideHint(h, levels, liftedTo, orig.to),
      });
    }
    const itemOf = (id: string) => {
      const lifted = liftTo(h, id, level);
      return lifted && toItem(lifted);
    };
    const problem: LevelProblem = { level, items, edges, pulls: pullsFor(h, graph, level, itemOf), direction };

    // 3. 网格放置
    const { cells, frames } = placeLevel(problem, rng);

    // 4. 格子 → 像素
    const sizes = new Map<string, { w: number; h: number }>();
    for (const id of items) {
      const c = clusters.find((cl) => cl.id === id);
      sizes.set(id, c ? { w: c.width, h: c.height } : sizeOf(h, id, containerSize));
    }
    const { local, contentW, contentH } = gridToLocal(cells, sizes);

    // 5. 容器尺寸
    if (level !== ROOT) containerSize.set(level, { w: contentW + 2 * PAD, h: contentH + PAD + TITLE_H });
    levels.push({ level, problem, cells, frames, local, contentW, contentH, clusters });
  }

  // 自顶向下累加绝对坐标
  const rects = new Map<string, Rect>();
  const origin = new Map<string, { x: number; y: number }>([[ROOT, { x: PAD, y: PAD }]]);
  for (const lv of [...levels].reverse()) {
    const o = origin.get(lv.level)!;
    for (const [item, r] of lv.local) {
      const abs = { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h };
      const cluster = lv.clusters.find((c) => c.id === item);
      if (cluster) {
        // 展开簇：成员沿排列方向依次摆开
        cluster.members.forEach((m, i) => {
          const s = sizeOf(h, m, containerSize);
          rects.set(m, {
            x: cluster.arrangement === "row" ? abs.x + i * (s.w + CLUSTER_GAP) : abs.x + (abs.w - s.w) / 2,
            y: cluster.arrangement === "column" ? abs.y + i * (s.h + CLUSTER_GAP) : abs.y + (abs.h - s.h) / 2,
            w: s.w,
            h: s.h,
          });
        });
      } else {
        rects.set(item, abs);
        if (h.isContainer(item)) origin.set(item, { x: abs.x + PAD, y: abs.y + TITLE_H });
      }
    }
  }

  const root = levels[levels.length - 1];
  return {
    hierarchy: h,
    levels,
    rects,
    clusters: allClusters,
    width: root.contentW + 2 * PAD,
    height: root.contentH + 2 * PAD,
  };
}
