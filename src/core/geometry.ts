// 端口与几何工具。
// 对照 TALA：nodeshape/shape_square.go（每边 3 个端口，25% / 50% / 75%）

import type { Point, Port, Rect, Side } from "./types";

/** 端口向外伸出的距离：路由从 stub 接入可见性图，保证线段垂直离开节点 */
export const STUB = 20;

const FRACTIONS = [0.25, 0.5, 0.75] as const;

export function portsOf(nodeId: string, r: Rect): Port[] {
  const ports: Port[] = [];
  const push = (side: Side, index: 0 | 1 | 2, at: Point, stub: Point) =>
    ports.push({ nodeId, side, index, at, stub, isCenter: index === 1 });
  FRACTIONS.forEach((f, i) => {
    const idx = i as 0 | 1 | 2;
    // 取整：可见性图只用整数坐标
    const x = Math.round(r.x + r.w * f);
    const y = Math.round(r.y + r.h * f);
    push("top", idx, { x, y: r.y }, { x, y: r.y - STUB });
    push("bottom", idx, { x, y: r.y + r.h }, { x, y: r.y + r.h + STUB });
    push("left", idx, { x: r.x, y }, { x: r.x - STUB, y });
    push("right", idx, { x: r.x + r.w, y }, { x: r.x + r.w + STUB, y });
  });
  return ports;
}

/** 轴对齐线段 (a,b) 是否穿过矩形内部（向内收缩 pad，允许贴边） */
export function segmentHitsRect(a: Point, b: Point, r: Rect, pad = 1): boolean {
  const x0 = r.x + pad;
  const x1 = r.x + r.w - pad;
  const y0 = r.y + pad;
  const y1 = r.y + r.h - pad;
  if (a.x === b.x) {
    if (a.x <= x0 || a.x >= x1) return false;
    return Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
  }
  if (a.y === b.y) {
    if (a.y <= y0 || a.y >= y1) return false;
    return Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  }
  return false;
}

export const rectsOverlap = (a: Rect, b: Rect, pad = 0): boolean =>
  a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

export const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
