// 边标签放置。
// 对照 TALA：internal/labeling/placement.go（Place）
//
// 做法（极简版）：
//   - 多段边先放，短的先放；每放好一个标签，它就成为后面标签的障碍
//   - 候选位置：
//       普通边：沿每一段的 1/2、1/4、3/4 处，放在线的两侧
//       分叉边：放在"支线的高度、汇合线的外侧"——和真实 TALA 一样，
//              4 个 Dispatch Task 依次排在汇合线左侧，各自对着自己的支线
//   - 打分 = 2 × 与节点的重叠面积比 + 10 × 与其他标签重叠 + 2 × 与边重叠 + 0.3 × 压容器边框
//     （前三项是 TALA 的权重）
//   - 分数为 0 立即停止；否则取分数最低的候选

import type { PlacedLabel, Point, Rect, RoutedEdge } from "./types";
import { rectsOverlap, inflate } from "./geometry";

export const LABEL_FONT = 20;
const CHAR_W = 0.6 * LABEL_FONT;
const LABEL_H = LABEL_FONT + 10;
const OFFSET = 6;

export function labelSize(text: string): { w: number; h: number } {
  return { w: Math.round(text.length * CHAR_W + 12), h: LABEL_H };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function segmentRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, w: Math.abs(a.x - b.x) + 2, h: Math.abs(a.y - b.y) + 2 };
}

/** 沿线段的常规候选：1/2、1/4、3/4 处，线的两侧 */
function alongSegments(points: Point[], size: { w: number; h: number }): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (len < 40 || (a.y === b.y && len < size.w * 0.8)) continue;
    for (const t of [0.5, 0.25, 0.75]) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (a.y === b.y) {
        out.push({ x: x - size.w / 2, y: y - size.h - OFFSET, ...size });
        out.push({ x: x - size.w / 2, y: y + OFFSET, ...size });
      } else {
        out.push({ x: x + OFFSET, y: y - size.h / 2, ...size });
        out.push({ x: x - size.w - OFFSET, y: y - size.h / 2, ...size });
      }
    }
  }
  return out;
}

/** 分叉边的候选：在支线的高度、汇合线外侧（主干那一侧） */
function atBranch(points: Point[], size: { w: number; h: number }): Rect[] {
  if (points.length < 4) return [];
  const bend = points[points.length - 2];
  const end = points[points.length - 1];
  if (bend.y !== end.y) return [];
  const goesRight = end.x > bend.x;
  const x = goesRight ? bend.x - size.w - OFFSET : bend.x + OFFSET;
  return [
    // 先放在支线正对面；被占了就往离主干远的方向挪（外侧的支线有更多空间）
    { x, y: end.y - size.h / 2, ...size },
    { x, y: end.y < points[0].y ? end.y - size.h - OFFSET : end.y + OFFSET, ...size },
    { x, y: end.y < points[0].y ? end.y + OFFSET : end.y - size.h - OFFSET, ...size },
  ];
}

export interface LabelInput {
  edgeIndex: number;
  text: string;
  route: RoutedEdge;
  /** 是否是分叉边（簇边） */
  forked?: boolean;
}

/** 返回每个标签的最终位置；同时返回每个标签被评估过的候选，供动画展示 */
export function placeLabels(
  inputs: LabelInput[],
  nodeRects: Rect[],
  routes: RoutedEdge[],
  /** 容器的四条边框：标签压在边框上也难看 */
  containerRects: Rect[] = [],
): { placed: PlacedLabel[]; tried: Map<number, { rect: Rect; score: number }[]> } {
  const borders = containerRects.flatMap((c) => [
    { x: c.x, y: c.y - 1, w: c.w, h: 2 },
    { x: c.x, y: c.y + c.h - 1, w: c.w, h: 2 },
    { x: c.x - 1, y: c.y, w: 2, h: c.h },
    { x: c.x + c.w - 1, y: c.y, w: 2, h: c.h },
  ]);
  const order = [...inputs].sort(
    (a, b) => b.route.points.length - a.route.points.length || pathLength(a.route.points) - pathLength(b.route.points),
  );

  // 线段去重：分叉边共用的主干只算一次，并记下由哪几条边共享
  const segMap = new Map<string, { edges: Set<number>; rect: Rect }>();
  for (const r of routes) {
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      const k = [a.x, a.y, b.x, b.y].join(",");
      const hit = segMap.get(k) ?? segMap.get([b.x, b.y, a.x, a.y].join(","));
      if (hit) hit.edges.add(r.edgeIndex);
      else segMap.set(k, { edges: new Set([r.edgeIndex]), rect: segmentRect(a, b) });
    }
  }
  const segments = [...segMap.values()];

  const placed: PlacedLabel[] = [];
  const tried = new Map<number, { rect: Rect; score: number }[]>();
  for (const input of order) {
    const size = labelSize(input.text);
    const branch = input.forked ? atBranch(input.route.points, size) : [];
    const cands = [...branch, ...alongSegments(input.route.points, size)];
    const scored: { rect: Rect; score: number }[] = [];
    let best: { rect: Rect; score: number } | undefined;
    for (const rect of cands) {
      const area = rect.w * rect.h;
      let score = 0;
      for (const n of nodeRects) score += (2 * overlapArea(rect, inflate(n, 4))) / area;
      for (const l of placed) if (rectsOverlap(rect, l.rect, 4)) score += 10;
      for (const s of segments) if (!s.edges.has(input.edgeIndex) && rectsOverlap(rect, s.rect, 2)) score += 2;
      // 压到容器边框只是轻微难看（真实 TALA 也常这样），权重远低于压线
      for (const b of borders) if (rectsOverlap(rect, b, 2)) score += 0.3;
      scored.push({ rect, score });
      if (!best || score < best.score) best = { rect, score };
      if (score === 0) break;
      // 分叉候选看完了，只要最优的不太差（< 1，没压到标签/节点）就不再看沿线候选
      if (scored.length === branch.length && best.score < 1) break;
    }
    // 分叉边：分叉候选优先，只有它们全都很差（压到标签或节点）才退回到沿线候选
    tried.set(input.edgeIndex, scored);
    if (best) placed.push({ kind: "edge", owner: String(input.edgeIndex), text: input.text, rect: best.rect, score: best.score });
  }
  return { placed, tried };
}

function pathLength(points: Point[]): number {
  let s = 0;
  for (let i = 0; i + 1 < points.length; i++) s += Math.abs(points[i].x - points[i + 1].x) + Math.abs(points[i].y - points[i + 1].y);
  return s;
}
