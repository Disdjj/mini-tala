// 轴对齐：把相连的节点平移到同一条中心线上，让边变成直线。
// 对照 TALA：internal/placement/alignment.go（AlignAxes，流水线里穿插执行了 4 次）
//
// 网格放置只保证"同一行/列"，但不同尺寸、不同层级的节点中心线未必重合
// （比如 task02 和 producer 分属两层，task02 只和 queue 整体对齐）。
// 这一步对每条边：
//   - 判断边大致是横向还是纵向
//   - 优先移动度数小的那一端（叶子更自由），沿垂直方向平移到对方的中心线
//   - 移动后不能和兄弟节点重叠、不能越出自己的容器，否则放弃
// 反复扫几遍，直到没有可移动的为止（user02 会跟着 task02 一起对齐）。

import type { EdgeSpec, Rect } from "./types";
import type { Hierarchy } from "./hierarchy";
import { ROOT } from "./hierarchy";
import { rectsOverlap } from "./geometry";
import { PAD, TITLE_H } from "./nested";

const MIN_GAP = 30;
const MAX_PASSES = 6;

export interface AlignMove {
  id: string;
  from: Rect;
  to: Rect;
  reason: string;
}

// 和 geometry.portsOf 用同样的取整，保证对齐后中间端口坐标完全相同
const cx = (r: Rect) => Math.round(r.x + r.w * 0.5);
const cy = (r: Rect) => Math.round(r.y + r.h * 0.5);

function contentBox(rects: Map<string, Rect>, container: string): Rect | undefined {
  if (container === ROOT) return undefined;
  const c = rects.get(container)!;
  return { x: c.x + PAD, y: c.y + TITLE_H, w: c.w - 2 * PAD, h: c.h - TITLE_H - PAD };
}

function fits(h: Hierarchy, rects: Map<string, Rect>, id: string, r: Rect): boolean {
  const parent = h.parentOf(id);
  const box = contentBox(rects, parent);
  if (box && (r.x < box.x || r.y < box.y || r.x + r.w > box.x + box.w || r.y + r.h > box.y + box.h)) return false;
  for (const sib of h.children.get(parent) ?? []) {
    if (sib !== id && rectsOverlap(r, rects.get(sib)!, MIN_GAP)) return false;
  }
  return true;
}

export function alignAxes(
  h: Hierarchy,
  rects: Map<string, Rect>,
  edges: EdgeSpec[],
  /** 簇成员：由簇统一排列，不单独对齐 */
  locked: Set<string> = new Set(),
): AlignMove[] {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const moves: AlignMove[] = [];
  const movable = (id: string) => !h.isContainer(id) && !locked.has(id);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (const e of edges) {
      const a = rects.get(e.from)!;
      const b = rects.get(e.to)!;
      if (cx(a) === cx(b) || cy(a) === cy(b)) continue; // 已经在同一条中心线上

      // 先试主方向（横向边对齐 y，纵向边对齐 x），不行再试另一个方向；度数小的一端先动
      const horizontal = Math.abs(cx(a) - cx(b)) >= Math.abs(cy(a) - cy(b));
      const order = (degree.get(e.from) ?? 0) <= (degree.get(e.to) ?? 0) ? [e.from, e.to] : [e.to, e.from];
      outer: for (const alignY of [horizontal, !horizontal]) {
        const offset = alignY ? cy(b) - cy(a) : cx(b) - cx(a);
        for (const id of order) {
          if (!movable(id)) continue;
          const r = rects.get(id)!;
          const d = id === e.from ? offset : -offset;
          const next = alignY ? { ...r, y: r.y + d } : { ...r, x: r.x + d };
          if (!fits(h, rects, id, next)) continue;
          moves.push({ id, from: r, to: next, reason: `${e.from.split(".").pop()} ↔ ${e.to.split(".").pop()}` });
          rects.set(id, next);
          moved = true;
          break outer;
        }
      }
    }
    if (!moved) break;
  }
  return moves;
}
