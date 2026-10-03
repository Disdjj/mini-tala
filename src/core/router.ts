// 正交路由：在 OVG 上跑 Dijkstra。
// 对照 TALA：internal/routing/ovg_edge_router.go（search，"Basically Dijkstra's shortest path"）
//         internal/routing/coordinator.go:483（3 种边顺序 flavor，取总代价最低）
//
// 搜索状态 = (OVG 点, 到达方向)。按方向拆状态，是为了能给"拐弯"单独计价。
// 每一步的代价：
//   线段长度
//   + 拐弯           TURN_COST_PX
//   + 穿过别的边      CROSSING_COST_PX（在某点沿另一方向已被占用）
//   + 和别的边共线重叠 SHARE_COST_PX（近似禁止）
// 起止端口额外代价：
//   + 非中心端口      NON_CENTER_PORT_PX（偏好从边的中点出线）
//   + 端口已被别的边用 PORT_REUSE_PX

import type { Point, Port, Rect, RoutedEdge } from "./types";
import { buildOvg, ovgPointIndex, type Ovg } from "./ovg";
import { MinHeap } from "./heap";
import { portsOf } from "./geometry";

export const TURN_COST_PX = 80;
export const CROSSING_COST_PX = 400;
export const SHARE_COST_PX = 5000;
export const NON_CENTER_PORT_PX = 25;
export const PORT_REUSE_PX = 3000;
/** 每条边最多记录多少个被探索的点（仅用于动画） */
const MAX_VISITED_RECORDED = 1500;

const portAxis = (p: Port): 0 | 1 => (p.side === "top" || p.side === "bottom" ? 1 : 0);
const portKey = (p: Port): string => `${p.nodeId}:${p.side}:${p.index}`;
const edgeKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** 已路由边留下的占用信息，影响后续边的代价 */
export interface Occupation {
  /** 点 -> 被哪些方向占用（bit0 水平，bit1 竖直） */
  points: Map<number, number>;
  segments: Set<string>;
  ports: Set<string>;
}

export const emptyOccupation = (): Occupation => ({
  points: new Map(),
  segments: new Set(),
  ports: new Set(),
});

export interface EdgeSearch {
  route: RoutedEdge;
  /** 按出堆顺序记录的探索点，动画里画成"扩散的波纹" */
  visited: Point[];
  ok: boolean;
}

interface State {
  point: number;
  axis: 0 | 1;
}

const stateId = (s: State): number => s.point * 2 + s.axis;

/**
 * 为一条边做多源多汇 Dijkstra：起点是源节点所有端口的 stub，终点是目标节点所有端口的 stub。
 * 端口自身的代价作为起点的初始距离 / 终点的附加距离计入。
 */
export function searchEdge(
  ovg: Ovg,
  fromPorts: Port[],
  toPorts: Port[],
  occ: Occupation,
  edgeIndex: number,
  fromId: string,
  toId: string,
): EdgeSearch {
  const portCost = (p: Port) =>
    (p.isCenter ? 0 : NON_CENTER_PORT_PX) + (occ.ports.has(portKey(p)) ? PORT_REUSE_PX : 0);

  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const startPort = new Map<number, Port>();
  const heap = new MinHeap<State>();

  for (const p of fromPorts) {
    const idx = ovgPointIndex(ovg, p.stub);
    if (idx === undefined) continue;
    const s: State = { point: idx, axis: portAxis(p) };
    const d = portCost(p);
    if (d < (dist.get(stateId(s)) ?? Infinity)) {
      dist.set(stateId(s), d);
      startPort.set(stateId(s), p);
      heap.push(d, s);
    }
  }

  // 终点：stub 点下标 -> 可用端口列表
  const goals = new Map<number, Port[]>();
  for (const p of toPorts) {
    const idx = ovgPointIndex(ovg, p.stub);
    if (idx === undefined) continue;
    goals.set(idx, [...(goals.get(idx) ?? []), p]);
  }

  const visited: Point[] = [];
  let best = Infinity;
  let bestState: State | undefined;
  let bestGoal: Port | undefined;

  while (heap.size > 0) {
    const { pri, value: s } = heap.pop()!;
    const sid = stateId(s);
    if (pri > (dist.get(sid) ?? Infinity)) continue; // 过期项
    if (pri >= best) break; // 剩下的都不可能更好
    if (visited.length < MAX_VISITED_RECORDED) visited.push(ovg.points[s.point]);

    const goalPorts = goals.get(s.point);
    if (goalPorts) {
      for (const g of goalPorts) {
        // 进入终点端口：必须沿端口轴向进入，否则补一个拐弯
        const total = pri + portCost(g) + (s.axis === portAxis(g) ? 0 : TURN_COST_PX);
        if (total < best) {
          best = total;
          bestState = s;
          bestGoal = g;
        }
      }
    }

    for (const e of ovg.adj[s.point]) {
      let step = e.length;
      if (e.axis !== s.axis) step += TURN_COST_PX;
      if (occ.segments.has(edgeKey(s.point, e.to))) step += SHARE_COST_PX;
      // 到达的点已被另一方向的线占用 → 视为一次交叉
      const used = occ.points.get(e.to) ?? 0;
      const otherAxisBit = e.axis === 0 ? 2 : 1;
      if (used & otherAxisBit) step += CROSSING_COST_PX;

      const ns: State = { point: e.to, axis: e.axis };
      const nid = stateId(ns);
      const nd = pri + step;
      if (nd < (dist.get(nid) ?? Infinity)) {
        dist.set(nid, nd);
        prev.set(nid, sid);
        heap.push(nd, ns);
      }
    }
  }

  if (!bestState || !bestGoal) {
    return { route: { edgeIndex, from: fromId, to: toId, points: [], cost: Infinity }, visited, ok: false };
  }

  // 回溯路径
  const chain: number[] = [];
  let cur: number | undefined = stateId(bestState);
  let first = cur;
  while (cur !== undefined) {
    chain.push(cur >> 1);
    first = cur;
    cur = prev.get(cur);
  }
  chain.reverse();
  const src = startPort.get(first)!;
  const pts = [src.at, ...chain.map((i) => ovg.points[i]), bestGoal.at];

  return {
    route: { edgeIndex, from: fromId, to: toId, points: simplify(pts), cost: best },
    visited,
    ok: true,
  };
}

/** 合并共线的连续点，只保留拐点 */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length > 0) {
      const last = out[out.length - 1];
      if (last.x === p.x && last.y === p.y) continue;
    }
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** 把一条路由写进占用表，后面的边会为交叉 / 共线 / 复用端口付出代价 */
function occupy(ovg: Ovg, occ: Occupation, points: Point[], fromPorts: Port[], toPorts: Port[]): void {
  // 记录真正用到的首尾端口
  const first = points[0];
  const last = points[points.length - 1];
  for (const p of [...fromPorts, ...toPorts]) {
    if ((p.at.x === first.x && p.at.y === first.y) || (p.at.x === last.x && p.at.y === last.y)) {
      occ.ports.add(portKey(p));
    }
  }
  // 沿每条线段把途经的 OVG 点和相邻点对标记为占用
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const axis = a.y === b.y ? 0 : 1;
    const onSeg: number[] = [];
    ovg.points.forEach((p, idx) => {
      const within =
        axis === 0
          ? p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
          : p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
      if (within) onSeg.push(idx);
    });
    onSeg.sort((u, v) => (axis === 0 ? ovg.points[u].x - ovg.points[v].x : ovg.points[u].y - ovg.points[v].y));
    for (let k = 0; k < onSeg.length; k++) {
      occ.points.set(onSeg[k], (occ.points.get(onSeg[k]) ?? 0) | (axis === 0 ? 1 : 2));
      if (k + 1 < onSeg.length) occ.segments.add(edgeKey(onSeg[k], onSeg[k + 1]));
    }
  }
}

export type Flavor = "shortest-first" | "longest-first" | "declared";
export const FLAVORS: Flavor[] = ["shortest-first", "longest-first", "declared"];

export interface RoutingAttempt {
  flavor: Flavor;
  order: number[];
  searches: EdgeSearch[];
  totalCost: number;
}

export interface RoutingResult {
  ovg: Ovg;
  attempts: RoutingAttempt[];
  best: RoutingAttempt;
}

function manhattanBetween(a: Rect, b: Rect): number {
  return Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) + Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
}

/**
 * 整图路由：按 3 种边顺序各贪心路由一遍（每条边只路由一次，没有 rip-up），
 * 取总代价最低的方案。对照 TALA 的 ShortestToLongest / LongestToShortest / Default。
 */
export function routeAll(
  edges: { from: string; to: string }[],
  rects: Map<string, Rect>,
  cols: number,
  rows: number,
): RoutingResult {
  const portsByNode = new Map<string, Port[]>();
  for (const [id, r] of rects) portsByNode.set(id, portsOf(id, r));
  const allPorts = [...portsByNode.values()].flat();
  const ovg = buildOvg([...rects.values()], allPorts, cols, rows);

  const routable = edges
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.from !== e.to && rects.has(e.from) && rects.has(e.to));
  const len = (e: { from: string; to: string }) => manhattanBetween(rects.get(e.from)!, rects.get(e.to)!);

  const attempts: RoutingAttempt[] = FLAVORS.map((flavor) => {
    const ordered = [...routable];
    if (flavor === "shortest-first") ordered.sort((a, b) => len(a) - len(b) || a.i - b.i);
    if (flavor === "longest-first") ordered.sort((a, b) => len(b) - len(a) || a.i - b.i);

    const occ = emptyOccupation();
    const searches: EdgeSearch[] = [];
    let totalCost = 0;
    for (const e of ordered) {
      const fp = portsByNode.get(e.from)!;
      const tp = portsByNode.get(e.to)!;
      const s = searchEdge(ovg, fp, tp, occ, e.i, e.from, e.to);
      searches.push(s);
      totalCost += s.ok ? s.route.cost : SHARE_COST_PX * 10;
      if (s.ok) occupy(ovg, occ, s.route.points, fp, tp);
    }
    return { flavor, order: ordered.map((e) => e.i), searches, totalCost };
  });

  // 严格更低才替换，平局保留靠前的 flavor（确定性）
  let best = attempts[0];
  for (const a of attempts) if (a.totalCost < best.totalCost) best = a;
  return { ovg, attempts, best };
}
