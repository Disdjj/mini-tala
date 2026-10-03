// 正交可见性图（Orthogonal Visibility Graph, OVG）。
// 对照 TALA：internal/routing/ovg.go:130-231（buildOVGFromGraphWithGuard）
//
// 构建方法：
//   1. 收集"有意义"的 x / y 坐标：
//      - 所有端口 stub 的坐标
//      - 每个障碍物外扩 CLEARANCE 后的四条边（让线能贴着节点绕过去）
//      - 相邻障碍物之间的中线（让线从两个节点正中间穿过）
//   2. 取笛卡尔积得到候选点，丢掉落在障碍物里的点
//   3. 每一行、每一列按坐标排序，只把相邻两点连起来（扫描线），连线穿过障碍物的跳过
//
// 障碍物只有叶子节点。容器不是障碍：线可以穿过容器边框进出（TALA 同样允许端点在容器内的边穿过容器）。

import type { Point, Port, Rect } from "./types";
import { inflate, segmentHitsRect } from "./geometry";

export const CLEARANCE = 30;

export interface OvgEdge {
  to: number;
  length: number;
  /** 0 = 水平，1 = 竖直 */
  axis: 0 | 1;
}

export interface Ovg {
  points: Point[];
  adj: OvgEdge[][];
  index: Map<string, number>;
}

const key = (p: Point): string => `${p.x},${p.y}`;

function insideAny(p: Point, rects: Rect[]): boolean {
  return rects.some((r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((v) => Math.round(v)))].sort((a, b) => a - b);
}

/** 排序后相邻坐标的中点：两个障碍物之间的"通道中线" */
function midlines(edges: number[]): number[] {
  const s = uniqueSorted(edges);
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length; i++) if (s[i + 1] - s[i] > 2 * CLEARANCE) out.push((s[i] + s[i + 1]) / 2);
  return out;
}

export function buildOvg(obstacles: Rect[], ports: Port[], bounds: Rect): Ovg {
  const padded = obstacles.map((r) => inflate(r, CLEARANCE));
  const xs = uniqueSorted([
    ...ports.map((p) => p.stub.x),
    ...padded.flatMap((r) => [r.x, r.x + r.w]),
    ...midlines(obstacles.flatMap((r) => [r.x, r.x + r.w])),
    bounds.x,
    bounds.x + bounds.w,
  ]);
  const ys = uniqueSorted([
    ...ports.map((p) => p.stub.y),
    ...padded.flatMap((r) => [r.y, r.y + r.h]),
    ...midlines(obstacles.flatMap((r) => [r.y, r.y + r.h])),
    bounds.y,
    bounds.y + bounds.h,
  ]);

  const points: Point[] = [];
  const index = new Map<string, number>();
  for (const x of xs) {
    for (const y of ys) {
      const p = { x, y };
      if (insideAny(p, obstacles)) continue;
      index.set(key(p), points.length);
      points.push(p);
    }
  }
  const adj: OvgEdge[][] = points.map(() => []);

  const connect = (line: number[], axis: 0 | 1) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = points[line[i]];
      const b = points[line[i + 1]];
      if (obstacles.some((r) => segmentHitsRect(a, b, r))) continue;
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      adj[line[i]].push({ to: line[i + 1], length, axis });
      adj[line[i + 1]].push({ to: line[i], length, axis });
    }
  };
  for (const y of ys) connect(xs.map((x) => index.get(`${x},${y}`)).filter((i): i is number => i !== undefined), 0);
  for (const x of xs) connect(ys.map((y) => index.get(`${x},${y}`)).filter((i): i is number => i !== undefined), 1);

  return { points, adj, index };
}

export const ovgPointIndex = (ovg: Ovg, p: Point): number | undefined => ovg.index.get(key(p));
