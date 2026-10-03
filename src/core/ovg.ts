// 正交可见性图（Orthogonal Visibility Graph, OVG）。
// 对照 TALA：internal/routing/ovg.go:130-231（buildOVGFromGraphWithGuard）
//
// 构建方法（极简版）：
//   1. 收集"有意义"的 x 坐标与 y 坐标：所有端口 stub 的坐标 + 网格通道的中线
//   2. 取笛卡尔积得到候选点，丢掉落在节点内部的点
//   3. 每一行、每一列按坐标排序，只把相邻两点连起来（扫描线），
//      连线穿过节点的跳过
// 得到的图上任意路径都是水平/竖直线段组成的，天然就是正交路由。

import type { Point, Port, Rect } from "./types";
import { CELL_H, CELL_W, MARGIN, segmentHitsRect } from "./geometry";

export interface OvgEdge {
  to: number;
  length: number;
  /** 0 = 水平，1 = 竖直 */
  axis: 0 | 1;
}

export interface Ovg {
  points: Point[];
  adj: OvgEdge[][];
  /** "x,y" -> 点下标 */
  index: Map<string, number>;
}

const key = (p: Point): string => `${p.x},${p.y}`;

function insideAnyRect(p: Point, rects: Rect[], clearance: number): boolean {
  for (const r of rects) {
    if (
      p.x > r.x - clearance &&
      p.x < r.x + r.w + clearance &&
      p.y > r.y - clearance &&
      p.y < r.y + r.h + clearance
    ) {
      return true;
    }
  }
  return false;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function buildOvg(rects: Rect[], ports: Port[], cols: number, rows: number): Ovg {
  // 1. 有意义的坐标：端口 stub + 单元格之间的通道中线（也就是格线本身）
  const xs = uniqueSorted([
    ...ports.map((p) => p.stub.x),
    ...Array.from({ length: cols + 1 }, (_, i) => MARGIN + i * CELL_W),
  ]);
  const ys = uniqueSorted([
    ...ports.map((p) => p.stub.y),
    ...Array.from({ length: rows + 1 }, (_, i) => MARGIN + i * CELL_H),
  ]);

  // 2. 笛卡尔积 + 过滤
  const points: Point[] = [];
  const index = new Map<string, number>();
  for (const x of xs) {
    for (const y of ys) {
      const p = { x, y };
      if (insideAnyRect(p, rects, 2)) continue;
      index.set(key(p), points.length);
      points.push(p);
    }
  }
  const adj: OvgEdge[][] = points.map(() => []);

  // 3. 扫描线：同一行/列中相邻的点相连
  const connect = (line: number[], axis: 0 | 1) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = points[line[i]];
      const b = points[line[i + 1]];
      if (rects.some((r) => segmentHitsRect(a, b, r))) continue;
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      adj[line[i]].push({ to: line[i + 1], length, axis });
      adj[line[i + 1]].push({ to: line[i], length, axis });
    }
  };
  for (const y of ys) {
    const row = xs.map((x) => index.get(`${x},${y}`)).filter((i): i is number => i !== undefined);
    connect(row, 0);
  }
  for (const x of xs) {
    const col = ys.map((y) => index.get(`${x},${y}`)).filter((i): i is number => i !== undefined);
    connect(col, 1);
  }

  return { points, adj, index };
}

export function ovgPointIndex(ovg: Ovg, p: Point): number | undefined {
  return ovg.index.get(key(p));
}
